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

    def _handle_signal(signum, _frame):
        nonlocal shutting_down
        if shutting_down:
            return
        # Step 1: Send SIGTERM to framework and let it shutdown gracefully
        # The framework's lifespan shutdown will terminate all framework shells
        print("[supervisor] Sending SIGTERM to framework for graceful shutdown")
        try:
            os.kill(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            print("[supervisor] Framework already exited")
            return
        
        # Step 2: Wait for framework to exit (it terminates shells in lifespan)
        max_wait = 10.0
        poll_interval = 0.2
        elapsed = 0.0
        while elapsed < max_wait:
            if proc.poll() is not None:
                print(f"[supervisor] Framework exited gracefully after {elapsed:.1f}s")
                break
            time.sleep(poll_interval)
            elapsed += poll_interval
        
        if proc.poll() is None:
            print(f"[supervisor] Framework didn't exit after {max_wait}s, requesting IPC shutdown")
            # Framework is hung - use IPC to force cleanup
            import requests
            ipc_host = os.environ.get("TE_IPC_HOST", "127.0.0.1")
            ipc_port = os.environ.get("TE_IPC_PORT", "9099")
            ipc_url = f"http://{ipc_host}:{ipc_port}/actions/shutdown"
            try:
                resp = requests.post(ipc_url, timeout=30.0)
                if resp.status_code == 200:
                    print("[supervisor] IPC shutdown completed")
                    data = resp.json()
                    if data.get("ok"):
                        stats = data.get("data", {})
                        if stats.get("force_killed_shells"):
                            print(f"[supervisor] Force-killed shells: {stats['force_killed_shells']}")
                else:
                    print(f"[supervisor] IPC shutdown returned {resp.status_code}")
            except Exception as exc:
                print(f"[supervisor] IPC shutdown request failed: {exc}")
                print("[supervisor] Falling back to direct process group kill")
                _kill_process_group(proc.pid, signal.SIGTERM)
                time.sleep(2.0)
                if proc.poll() is None:
                    _kill_process_group(proc.pid, signal.SIGKILL)

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
            _kill_process_group(proc.pid, signal.SIGKILL)

    # Note: Shell log cleanup handled by startup cycle, not shutdown
    # IPC leaves all logs in place; next startup will archive/clean them
    
    if os.environ.get("TE_IPC_PERSIST") != "1":
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
