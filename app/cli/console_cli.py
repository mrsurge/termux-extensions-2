from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

from app.te2_paths import te2_cache_home

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = "8089"
DEFAULT_TIMEOUT = 20.0
LOG_PATH = te2_cache_home() / "console" / "te2_console_log.jsonl"


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    if not argv:
        print("Usage: te2 console <list-workers|eval|tail|search> [options]", file=sys.stderr)
        return 1

    command = argv[0]
    rest = argv[1:]

    if command == "list-workers":
        return _cmd_list_workers(rest)
    if command == "eval":
        return _cmd_eval(rest)
    if command == "tail":
        return _cmd_tail(rest)
    if command == "search":
        return _cmd_search(rest)

    print(f"Unknown console command: {command}", file=sys.stderr)
    print("Available: list-workers, eval, tail, search", file=sys.stderr)
    return 1


def _framework_url() -> str:
    env_url = os.environ.get("TE_FRAMEWORK_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    host = os.environ.get("TE2_SERVER_HOST", DEFAULT_HOST)
    port = os.environ.get("TE2_SERVER_PORT", os.environ.get("TE_PORT", DEFAULT_PORT))
    return f"http://{host}:{port}"


def _cmd_list_workers(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="te2 console list-workers")
    parser.add_argument("--url", default=None, help="Framework URL (default: TE_FRAMEWORK_URL or http://host:port)")
    args = parser.parse_args(argv)
    url = args.url or _framework_url()

    import socketio

    workers: list[str] = []
    sio = socketio.Client()

    @sio.on("console:workers", namespace="/te2_console")
    def on_workers(data):
        nonlocal workers
        workers = data if isinstance(data, list) else []

    try:
        sio.connect(
            url,
            namespaces=["/te2_console"],
            socketio_path="/te2_console_ws/socket.io",
            transports=["websocket"],
            wait_timeout=5,
        )
    except Exception as exc:
        print(f"Failed to connect to {url}: {exc}", file=sys.stderr)
        return 1

    sio.emit("console:register", {"role": "drawer", "tail_lines": 0}, namespace="/te2_console")
    time.sleep(0.5)

    if not workers:
        _try_log_workers()

    sio.disconnect()

    if workers:
        for w in workers:
            print(w)
        return 0

    print("No live console workers registered.", file=sys.stderr)
    _try_log_workers()
    return 1


def _try_log_workers() -> None:
    if not LOG_PATH.exists():
        return
    seen: set[str] = set()
    with LOG_PATH.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            wid = entry.get("workerId", "")
            if wid and wid not in seen:
                seen.add(wid)
    if seen:
        print("Workers seen in log history:", file=sys.stderr)
        for w in sorted(seen):
            print(f"  {w}", file=sys.stderr)


def _cmd_eval(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="te2 console eval")
    parser.add_argument("--worker", "-w", required=True, help="Target worker ID")
    parser.add_argument("--url", default=None, help="Framework URL")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Eval timeout in seconds")
    parser.add_argument("--code", default=None, help="Code to eval (if omitted, reads from stdin)")
    args = parser.parse_args(argv)

    code = args.code
    if code is None:
        code = sys.stdin.read()
    if not code.strip():
        print("No code provided. Use --code or pipe via stdin.", file=sys.stderr)
        return 1

    url = args.url or _framework_url()

    import socketio

    import uuid

    req_id = str(uuid.uuid4())
    result_box: list[dict | None] = [None]
    sio = socketio.Client()

    @sio.on("console:evalResult", namespace="/te2_console")
    def on_result(data):
        if isinstance(data, dict) and data.get("reqId") == req_id:
            result_box[0] = data

    try:
        sio.connect(
            url,
            namespaces=["/te2_console"],
            socketio_path="/te2_console_ws/socket.io",
            transports=["websocket"],
            wait_timeout=5,
        )
    except Exception as exc:
        print(f"Failed to connect to {url}: {exc}", file=sys.stderr)
        return 1

    sio.emit("console:register", {"role": "drawer"}, namespace="/te2_console")
    time.sleep(0.3)

    sio.emit(
        "console:eval",
        {"targetWorkerId": args.worker, "reqId": req_id, "code": code, "timeoutSeconds": args.timeout},
        namespace="/te2_console",
    )

    deadline = time.monotonic() + args.timeout + 5
    while result_box[0] is None and time.monotonic() < deadline:
        time.sleep(0.05)

    sio.disconnect()

    result = result_box[0]
    if result is None:
        print(f"Eval timed out after {args.timeout}s (worker: {args.worker})", file=sys.stderr)
        return 1

    if result.get("ok"):
        value = result.get("value")
        if isinstance(value, str):
            print(value)
        else:
            print(json.dumps(value, indent=2, default=str, ensure_ascii=False))
        return 0

    error = result.get("error", "unknown error")
    error_type = result.get("errorType", "")
    if error_type:
        print(f"[{error_type}] {error}", file=sys.stderr)
    else:
        print(json.dumps(error, default=str, ensure_ascii=False), file=sys.stderr)
    return 1


def _cmd_tail(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="te2 console tail")
    parser.add_argument("--worker", "-w", default=None, help="Filter by worker ID")
    parser.add_argument("--limit", "-n", type=int, default=100, help="Number of entries (default: 100)")
    parser.add_argument("--level", "-l", default=None, help="Filter by level (log, info, warn, error, debug)")
    args = parser.parse_args(argv)

    entries = _read_log_entries(worker_id=args.worker, level=args.level)
    for entry in entries[-args.limit:]:
        _print_entry(entry)
    return 0


def _cmd_search(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="te2 console search")
    parser.add_argument("query", help="Search query (case-insensitive)")
    parser.add_argument("--worker", "-w", default=None, help="Filter by worker ID")
    parser.add_argument("--limit", "-n", type=int, default=100, help="Max results (default: 100)")
    parser.add_argument("--level", "-l", default=None, help="Filter by level")
    args = parser.parse_args(argv)

    q = args.query.strip().lower()
    if not q:
        print("Query is required", file=sys.stderr)
        return 1

    count = 0
    for entry in _read_log_entries(worker_id=args.worker, level=args.level):
        haystack = _entry_text(entry).lower()
        if q in haystack:
            _print_entry(entry)
            count += 1
            if count >= args.limit:
                break
    return 0


def _read_log_entries(*, worker_id: str | None = None, level: str | None = None) -> list[dict[str, Any]]:
    if not LOG_PATH.exists():
        return []
    entries: list[dict[str, Any]] = []
    with LOG_PATH.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if worker_id and entry.get("workerId") != worker_id:
                continue
            if level and entry.get("level") != level:
                continue
            entries.append(entry)
    return entries


def _entry_text(entry: dict[str, Any]) -> str:
    parts: list[str] = [str(entry.get("workerId", "")), str(entry.get("level", ""))]
    for item in entry.get("args", []):
        try:
            parts.append(json.dumps(item, ensure_ascii=False, default=str))
        except Exception:
            parts.append(str(item))
    return " ".join(parts)


def _print_entry(entry: dict[str, Any]) -> None:
    ts = entry.get("ts")
    ts_str = ""
    if isinstance(ts, (int, float)) and ts > 0:
        ts_str = time.strftime("%H:%M:%S", time.localtime(ts / 1000)) + f".{int(ts) % 1000:03d}"
    worker = entry.get("workerId", "")
    level = entry.get("level", "log")
    args = entry.get("args", [])
    args_str = " ".join(
        json.dumps(a, ensure_ascii=False, default=str) if not isinstance(a, str) else a
        for a in args
    )
    print(f"{ts_str} [{level}] {worker}: {args_str}")
