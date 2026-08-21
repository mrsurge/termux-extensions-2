#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
import tracemalloc
from pathlib import Path
from typing import Any


_ROLLUP_KEYS = {
    "Rss": "rssKb",
    "Pss": "pssKb",
    "Private_Clean": "privateCleanKb",
    "Private_Dirty": "privateDirtyKb",
    "Anonymous": "anonymousKb",
    "Swap": "swapKb",
    "SwapPss": "swapPssKb",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="te2-memory-profile",
        description="Sample a TE2 process tree or request explicit Python/Node heap snapshots.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    sample_parser = subparsers.add_parser("sample", help="Write bounded /proc process-tree samples as JSONL")
    sample_parser.add_argument("--root-pid", type=int, required=True)
    sample_parser.add_argument("--output", type=Path, required=True)
    sample_parser.add_argument("--interval", type=float, default=1.0)
    sample_parser.add_argument("--duration", type=float, default=0.0, help="Seconds; zero samples until interrupted")
    sample_parser.add_argument("--once", action="store_true")

    snapshot_parser = subparsers.add_parser(
        "snapshot",
        help="Send SIGUSR2 to exact opt-in Python/Node process IDs",
    )
    snapshot_parser.add_argument("pids", type=int, nargs="+")

    compare_parser = subparsers.add_parser(
        "compare-python",
        help="Compare two tracemalloc snapshots and print retained allocation deltas",
    )
    compare_parser.add_argument("before", type=Path)
    compare_parser.add_argument("after", type=Path)
    compare_parser.add_argument("--limit", type=int, default=50)

    args = parser.parse_args(argv)
    if args.command == "snapshot":
        return _request_snapshots(args.pids)
    if args.command == "compare-python":
        return _compare_python_snapshots(args.before, args.after, args.limit)
    return _sample_process_tree(
        root_pid=args.root_pid,
        output=args.output,
        interval=args.interval,
        duration=args.duration,
        once=args.once,
    )


def _sample_process_tree(
    *,
    root_pid: int,
    output: Path,
    interval: float,
    duration: float,
    once: bool,
) -> int:
    if interval <= 0:
        raise SystemExit("--interval must be positive")
    if duration < 0:
        raise SystemExit("--duration cannot be negative")
    if not Path(f"/proc/{root_pid}").is_dir():
        raise SystemExit(f"root process does not exist: {root_pid}")

    destination = output.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    sequence = 0
    try:
        with destination.open("a", encoding="utf-8") as output_file:
            while True:
                sample_started = time.monotonic()
                sequence += 1
                payload = _process_tree_sample(root_pid, sequence)
                output_file.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
                output_file.flush()
                if once or (duration and time.monotonic() - started >= duration):
                    return 0
                remaining = interval - (time.monotonic() - sample_started)
                if remaining > 0:
                    time.sleep(remaining)
    except KeyboardInterrupt:
        return 130


def _process_tree_sample(root_pid: int, sequence: int) -> dict[str, Any]:
    processes = _process_inventory()
    children: dict[int, list[int]] = {}
    for pid, process in processes.items():
        children.setdefault(process["ppid"], []).append(pid)

    descendants: list[int] = []
    pending = [root_pid]
    seen: set[int] = set()
    while pending:
        pid = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        if pid in processes:
            descendants.append(pid)
        pending.extend(children.get(pid, ()))

    records: list[dict[str, Any]] = []
    totals = {value: 0 for value in _ROLLUP_KEYS.values()}
    for pid in sorted(descendants):
        process = processes[pid]
        memory = _read_smaps_rollup(pid)
        for key in totals:
            totals[key] += memory.get(key, 0)
        records.append({**process, **memory})

    return {
        "schemaVersion": 1,
        "sequence": sequence,
        "capturedAtNs": time.time_ns(),
        "rootPid": root_pid,
        "processCount": len(records),
        "totals": totals,
        "processes": records,
    }


def _process_inventory() -> dict[int, dict[str, Any]]:
    inventory: dict[int, dict[str, Any]] = {}
    for proc_path in Path("/proc").iterdir():
        if not proc_path.name.isdigit():
            continue
        pid = int(proc_path.name)
        try:
            raw_stat = (proc_path / "stat").read_text(encoding="utf-8")
            _, stat_remainder = raw_stat.rsplit(") ", 1)
            stat_fields = stat_remainder.split()
            ppid = int(stat_fields[1])
            start_ticks = int(stat_fields[19])
            cmdline = (proc_path / "cmdline").read_bytes().replace(b"\0", b" ").decode(
                "utf-8", "replace"
            ).strip()
            comm = (proc_path / "comm").read_text(encoding="utf-8").strip()
        except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError, IndexError):
            continue
        inventory[pid] = {
            "pid": pid,
            "ppid": ppid,
            "startTicks": start_ticks,
            "role": _classify_process(cmdline, comm),
            "comm": comm,
            "cmdline": cmdline,
        }
    return inventory


def _read_smaps_rollup(pid: int) -> dict[str, int]:
    values: dict[str, int] = {}
    try:
        raw_lines = Path(f"/proc/{pid}/smaps_rollup").read_text(encoding="utf-8").splitlines()
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        return values
    for raw_line in raw_lines:
        key, separator, raw_value = raw_line.partition(":")
        output_key = _ROLLUP_KEYS.get(key)
        if not separator or output_key is None:
            continue
        try:
            values[output_key] = int(raw_value.strip().split(maxsplit=1)[0])
        except (ValueError, IndexError):
            continue
    return values


def _classify_process(cmdline: str, comm: str) -> str:
    lowered = cmdline.lower()
    if "runtime_bridge.py" in lowered:
        return "python-runtime-bridge"
    if "app.libs.app_worker" in lowered:
        return "python-app-worker"
    if "te2-server" in lowered:
        return "rust-server"
    if "extensionhost" in lowered:
        return "node-extension-host"
    if "basedpyright" in lowered:
        return "node-language-server"
    if "node_workbench_adapter" in lowered or "workbench_adapter" in lowered:
        return "node-wba"
    if "code-server" in lowered:
        return "node-code-server"
    if comm in {"node", "bun"}:
        return f"javascript-{comm}"
    if comm.startswith("python"):
        return "python-other"
    return "other"


def _request_snapshots(pids: list[int]) -> int:
    if not hasattr(signal, "SIGUSR2"):
        raise SystemExit("SIGUSR2 is unavailable on this platform")
    failed = False
    for pid in pids:
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(
                "utf-8", "replace"
            ).strip()
            environment = _read_process_environment(pid)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            print(f"process is unavailable: {pid}", file=sys.stderr)
            failed = True
            continue
        if not _is_snapshot_capable(cmdline, environment):
            print(
                f"refusing SIGUSR2 for unrecognized process {pid}: {cmdline}",
                file=sys.stderr,
            )
            failed = True
            continue
        try:
            os.kill(pid, signal.SIGUSR2)
        except (PermissionError, ProcessLookupError) as exc:
            print(f"snapshot signal failed for {pid}: {exc}", file=sys.stderr)
            failed = True
            continue
        print(f"snapshot requested pid={pid} cmd={cmdline}")
    return 1 if failed else 0


def _compare_python_snapshots(before_path: Path, after_path: Path, limit: int) -> int:
    before = tracemalloc.Snapshot.load(str(before_path.expanduser().resolve()))
    after = tracemalloc.Snapshot.load(str(after_path.expanduser().resolve()))
    statistics = after.compare_to(before, "traceback")[: max(1, min(limit, 1000))]
    payload = {
        "schemaVersion": 1,
        "before": str(before_path),
        "after": str(after_path),
        "statistics": [
            {
                "sizeDiffBytes": statistic.size_diff,
                "countDiff": statistic.count_diff,
                "sizeBytes": statistic.size,
                "count": statistic.count,
                "traceback": [str(frame) for frame in statistic.traceback],
            }
            for statistic in statistics
        ],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def _read_process_environment(pid: int) -> dict[str, str]:
    environment: dict[str, str] = {}
    for raw_entry in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        if not raw_entry or b"=" not in raw_entry:
            continue
        raw_key, raw_value = raw_entry.split(b"=", 1)
        environment[raw_key.decode("utf-8", "replace")] = raw_value.decode("utf-8", "replace")
    return environment


def _is_snapshot_capable(cmdline: str, environment: dict[str, str]) -> bool:
    lowered = cmdline.lower()
    if "runtime_bridge.py" in lowered or "app.libs.app_worker" in lowered:
        return bool(environment.get("TE2_MEMORY_PROFILE_DIR"))
    return (
        "node" in lowered or "code-server" in lowered
    ) and "--heapsnapshot-signal=SIGUSR2" in environment.get("NODE_OPTIONS", "")


if __name__ == "__main__":
    raise SystemExit(main())
