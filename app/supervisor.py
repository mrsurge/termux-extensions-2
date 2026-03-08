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
FRAMEWORK_GRACE_SECONDS = float(os.environ.get("TE_SUPERVISOR_FRAMEWORK_GRACE_SECONDS", "3.0"))
POST_IPC_GRACE_SECONDS = float(os.environ.get("TE_SUPERVISOR_POST_IPC_GRACE_SECONDS", "1.5"))


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


def _framework_base_url() -> str:
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _framework_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    token = str(os.environ.get("TE_FRAMEWORK_SHELL_TOKEN") or "").strip()
    if token:
        headers["X-Framework-Key"] = token
    return headers


def _shutdown_running_apps_via_framework() -> None:
    import requests

    base_url = _framework_base_url()
    headers = _framework_headers()
    try:
        resp = requests.get(f"{base_url}/api/apps/running", headers=headers, timeout=5.0)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        print(f"[supervisor] Failed to list running apps before shutdown: {exc}")
        return

    running = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(running, list):
        print("[supervisor] Unexpected /api/apps/running payload during shutdown")
        return

    seen: set[str] = set()
    app_ids: list[str] = []
    for item in running:
        if not isinstance(item, dict):
            continue
        app_id = str(item.get("app_id") or item.get("id") or "").strip()
        if not app_id or app_id in seen:
            continue
        seen.add(app_id)
        app_ids.append(app_id)

    if not app_ids:
        print("[supervisor] No running apps to shut down before framework termination")
        return

    print(f"[supervisor] Requesting app shutdown for: {', '.join(app_ids)}")
    for app_id in app_ids:
        try:
            resp = requests.post(f"{base_url}/api/apps/{app_id}/quit", headers=headers, timeout=30.0)
            if resp.status_code not in (200, 404):
                print(f"[supervisor] App shutdown returned {resp.status_code} for {app_id}")
            else:
                print(f"[supervisor] App shutdown requested for {app_id}")
        except Exception as exc:
            print(f"[supervisor] App shutdown request failed for {app_id}: {exc}")


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
    shutdown_requested = threading.Event()

    def _perform_shutdown() -> None:
        nonlocal shutting_down
        if shutting_down:
            return
        shutting_down = True
        # Step 1: Ask the live framework to shut down running apps first.
        _shutdown_running_apps_via_framework()

        # Step 2: Send SIGTERM to framework and let it shutdown gracefully.
        print("[supervisor] Sending SIGTERM to framework for graceful shutdown")
        try:
            os.kill(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            print("[supervisor] Framework already exited")
            return
        
        # Step 3: Wait briefly for the framework to exit after app shutdown has been requested.
        try:
            proc.wait(timeout=FRAMEWORK_GRACE_SECONDS)
            print(f"[supervisor] Framework exited gracefully within {FRAMEWORK_GRACE_SECONDS:.1f}s")
            return
        except subprocess.TimeoutExpired:
            print(f"[supervisor] Framework didn't exit after {FRAMEWORK_GRACE_SECONDS:.1f}s, requesting IPC cleanup")
            # Framework is hung - use IPC to force cleanup.
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
            try:
                proc.wait(timeout=POST_IPC_GRACE_SECONDS)
                print(f"[supervisor] Framework exited after IPC cleanup within {POST_IPC_GRACE_SECONDS:.1f}s")
                return
            except subprocess.TimeoutExpired:
                print("[supervisor] Framework still running after IPC cleanup, forcing process group shutdown")
                _kill_process_group(proc.pid, signal.SIGTERM)
                time.sleep(2.0)
                if proc.poll() is None:
                    _kill_process_group(proc.pid, signal.SIGKILL)

    def _handle_signal(_signum, _frame):
        shutdown_requested.set()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    exit_code = 0
    while True:
        polled = proc.poll()
        if polled is not None:
            exit_code = polled
            break
        if shutdown_requested.is_set() and not shutting_down:
            _perform_shutdown()
            continue
        try:
            time.sleep(0.1)
        except KeyboardInterrupt:
            shutdown_requested.set()

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
