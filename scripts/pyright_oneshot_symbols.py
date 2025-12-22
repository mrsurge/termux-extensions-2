import json
import os
import argparse
import select
import subprocess
import time
from pathlib import Path


def _send(proc: subprocess.Popen, msg: dict) -> None:
    body = json.dumps(msg).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    assert proc.stdin is not None
    proc.stdin.write(header + body)
    proc.stdin.flush()


class _LspReader:
    def __init__(self, proc: subprocess.Popen):
        self.proc = proc
        self.buf = b""

    def pump(self, timeout: float = 0.2) -> list[tuple[dict, bytes]]:
        assert self.proc.stdout is not None
        r, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not r:
            return []
        chunk = os.read(self.proc.stdout.fileno(), 65536)
        if not chunk:
            return []
        self.buf += chunk

        out: list[tuple[dict, bytes]] = []
        while True:
            sep = self.buf.find(b"\r\n\r\n")
            if sep < 0:
                break
            header = self.buf[:sep].decode("ascii", "replace")
            rest = self.buf[sep + 4 :]

            content_length = None
            for line in header.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    content_length = int(line.split(":", 1)[1].strip())
                    break

            if content_length is None or len(rest) < content_length:
                break

            body = rest[:content_length]
            self.buf = rest[content_length:]
            out.append((json.loads(body.decode("utf-8")), body))
        return out

    def wait_for_id(self, want_id: int, timeout: float) -> tuple[dict, bytes] | None:
        end = time.time() + timeout
        while time.time() < end:
            for msg, raw in self.pump(0.2):
                if isinstance(msg, dict) and msg.get("id") == want_id:
                    return msg, raw
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="One-shot pyright-langserver symbol request.")
    ap.add_argument("--file", default="app/main.py", help="File path to open (relative to repo root)")
    ap.add_argument("--init-out", help="Write initialize response JSON to this file (no extra headers)")
    ap.add_argument("--symbols-out", help="Write documentSymbol response JSON to this file (no extra headers)")
    ap.add_argument("--pretty", action="store_true", help="Pretty-print JSON output (file output only)")
    ap.add_argument("--quiet", action="store_true", help="Suppress status prints; only write output files")
    args = ap.parse_args()

    repo_root = Path.cwd().resolve()
    file_path = (repo_root / args.file).resolve()
    if not file_path.is_file():
        print(f"error: missing file {file_path}")
        return 2

    uri = "file://" + str(file_path)
    root_uri = "file://" + str(repo_root)
    text = file_path.read_text("utf-8")

    proc = subprocess.Popen(
        ["pyright-langserver", "--stdio"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    reader = _LspReader(proc)

    _send(
        proc,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": None,
                "rootUri": root_uri,
                "capabilities": {},
                "workspaceFolders": [{"uri": root_uri, "name": "root"}],
            },
        },
    )
    init_pair = reader.wait_for_id(1, timeout=10.0)
    if not args.quiet:
        print("initialize:", "ok" if init_pair else "NONE")
    if not init_pair:
        _dump_stderr(proc)
        proc.terminate()
        return 3
    init, init_raw = init_pair
    if args.init_out:
        _write_json_file(args.init_out, init, init_raw, pretty=args.pretty)

    _send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})

    _send(
        proc,
        {
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": uri,
                    "languageId": "python",
                    "version": 1,
                    "text": text,
                }
            },
        },
    )

    _send(
        proc,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "textDocument/documentSymbol",
            "params": {"textDocument": {"uri": uri}},
        },
    )

    resp_pair = reader.wait_for_id(2, timeout=10.0)
    if not resp_pair:
        if not args.quiet:
            print("documentSymbol: NONE (timed out)")
        _dump_stderr(proc)
        proc.terminate()
        return 4

    resp, resp_raw = resp_pair
    if args.symbols_out:
        _write_json_file(args.symbols_out, resp, resp_raw, pretty=args.pretty)

    result = resp.get("result") or []
    if not args.quiet:
        print("documentSymbol: ok, symbols:", len(result) if isinstance(result, list) else "non-list")
    _dump_stderr(proc)
    proc.terminate()
    return 0


def _dump_stderr(proc: subprocess.Popen) -> None:
    try:
        assert proc.stderr is not None
        err = os.read(proc.stderr.fileno(), 65536).decode("utf-8", "replace")
        if err.strip():
            print("stderr:\n" + err[:2000])
    except Exception:
        pass


def _write_json_file(path: str, parsed: dict, raw: bytes, *, pretty: bool) -> None:
    # Write a single JSON document, with no headers or extra framing.
    # If pretty=True, re-serialize the parsed object; otherwise write the raw bytes
    # as returned by the server (exact JSON payload).
    out_path = Path(path).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        out_path.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), "utf-8")
    else:
        out_path.write_bytes(raw)


if __name__ == "__main__":
    raise SystemExit(main())
