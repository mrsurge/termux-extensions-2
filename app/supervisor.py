"""Lightweight supervisor for the Termux Extensions framework.

This module is launched via ``scripts/run_framework.sh``. It is responsible for
ensuring a single framework run ID exists, starting the Flask host, and
performing best-effort cleanup of framework shells when the host exits.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
import uuid
import shutil
from pathlib import Path
from typing import List

RUN_ID_FILE = Path(os.path.expanduser("~/.cache/te_framework/run_id"))
LOGS_DIR = Path(os.path.expanduser("~/.cache/te_framework/logs"))
PRESERVE_FLAG = Path(os.path.expanduser("~/.cache/te_framework/preserve_logs.flag"))


def _ensure_run_id() -> str:
    run_id = os.environ.get("TE_RUN_ID")
    if not run_id:
        run_id = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        os.environ["TE_RUN_ID"] = run_id
    return run_id


def _kill_process_group(pid: int, sig: signal.Signals) -> None:
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        return
    except Exception as exc:  # pragma: no cover - best effort
        print(f"[supervisor] Failed to signal group {pid}: {exc}", file=sys.stderr)


def _stop_ipc_server(sig: signal.Signals = signal.SIGTERM) -> None:
    ipc_pid = os.environ.get("TE_IPC_PID")
    if not ipc_pid:
        return
    try:
        os.kill(int(ipc_pid), sig)
        print(f"[supervisor] Sent {sig.name} to IPC server pid {ipc_pid}")
    except ProcessLookupError:
        pass
    except Exception as exc:
        print(f"[supervisor] Failed to stop IPC server {ipc_pid}: {exc}", file=sys.stderr)


def _mark_logs_for_preservation() -> None:
    try:
        PRESERVE_FLAG.parent.mkdir(parents=True, exist_ok=True)
        PRESERVE_FLAG.write_text(str(int(time.time())), encoding="utf-8")
    except Exception as exc:  # pragma: no cover - best effort
        print(f"[supervisor] Failed to mark logs for preservation: {exc}", file=sys.stderr)


def _cleanup_shell_logs() -> None:
    if not LOGS_DIR.exists():
        return
    try:
        for entry in LOGS_DIR.iterdir():
            if entry.is_file() or entry.is_symlink():
                entry.unlink(missing_ok=True)
            else:
                shutil.rmtree(entry, ignore_errors=True)
        if not LOGS_DIR.exists():
            LOGS_DIR.mkdir(parents=True, exist_ok=True)
        if PRESERVE_FLAG.exists():
            PRESERVE_FLAG.unlink(missing_ok=True)
        print("[supervisor] Cleaned framework shell logs")
    except Exception as exc:  # pragma: no cover - best effort
        print(f"[supervisor] Failed to clean framework shell logs: {exc}", file=sys.stderr)


def run(argv: List[str]) -> int:
    run_id = _ensure_run_id()
    os.environ.setdefault("TE_SUPERVISOR_PID", str(os.getpid()))
    print(f"[supervisor] Starting framework run {run_id}")

    try:
        RUN_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
        RUN_ID_FILE.write_text(run_id, encoding="utf-8")
    except Exception as exc:  # pragma: no cover - best effort
        print(f"[supervisor] Failed to write run-id file: {exc}", file=sys.stderr)

    cmd = [sys.executable, "-m", "app.main", *argv]
    try:
        proc = subprocess.Popen(cmd, preexec_fn=os.setsid)
    except OSError as exc:
        print(f"[supervisor] Failed to start Flask host: {exc}", file=sys.stderr)
        return 1

    shutting_down = False
    forced_shutdown = False

    def _schedule_force_kill():
        def _worker():
            nonlocal forced_shutdown
            time.sleep(10.0)
            if proc.poll() is not None:
                return
            print("[supervisor] Graceful shutdown timed out; forcing framework shutdown")
            _mark_logs_for_preservation()
            forced_shutdown = True
            _kill_process_group(proc.pid, signal.SIGKILL)
            _stop_ipc_server(signal.SIGKILL)

        threading.Thread(target=_worker, daemon=True).start()

    def _handle_signal(signum, _frame):
        nonlocal shutting_down
        if shutting_down:
            return
        shutting_down = True
        print(f"[supervisor] Received signal {signum}; shutting down run {run_id}")
        _kill_process_group(proc.pid, signal.SIGTERM)
        if signum == signal.SIGINT:
            _schedule_force_kill()
        else:
            _stop_ipc_server(signal.SIGTERM)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    exit_code = 0
    try:
        exit_code = proc.wait()
    except KeyboardInterrupt:
        _handle_signal(signal.SIGINT, None)
        exit_code = proc.wait()

    if exit_code not in (0, None):
        print(f"[supervisor] Flask host exited with code {exit_code}")

    # Give the host process group a moment to stop gracefully.
    if proc.poll() is None:
        time.sleep(1.0)
        if proc.poll() is None:
            print("[supervisor] Forcing shutdown")
            _mark_logs_for_preservation()
            forced_shutdown = True
            _kill_process_group(proc.pid, signal.SIGKILL)

    if forced_shutdown:
        print("[supervisor] Preserving framework shell logs due to forced shutdown")
    else:
        _cleanup_shell_logs()

    _stop_ipc_server(signal.SIGTERM)

    try:
        if RUN_ID_FILE.exists() and RUN_ID_FILE.read_text(encoding="utf-8").strip() == run_id:
            RUN_ID_FILE.unlink()
    except Exception:  # pragma: no cover - best effort
        pass

    print(f"[supervisor] Run {run_id} stopped")
    return exit_code if exit_code is not None else 0


def main() -> int:
    return run(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
