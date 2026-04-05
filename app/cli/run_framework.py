from __future__ import annotations

import argparse
import atexit
import hashlib
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import app as app_pkg


DEFAULT_FRAMEWORK_PORT = 8089
DEFAULT_IPC_HOST = "127.0.0.1"
DEFAULT_IPC_PORT = 9099
DEFAULT_SLEEP_PORT = 9100
DEFAULT_SHUTDOWN_WAIT_SECONDS = 45.0

_shutdown_in_progress = False


def _package_root() -> Path:
    return Path(app_pkg.__file__).resolve().parents[1]


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TE2 framework launcher")
    parser.add_argument("--port", type=int, default=int(os.environ.get("TE_PORT", str(DEFAULT_FRAMEWORK_PORT))))
    parser.add_argument("--ipc-port", type=int, default=None)
    parser.add_argument("--sleep", action="store_true", help="Start IPC sleep listener only")
    parser.add_argument(
        "--no-fws-autoupdate",
        action="store_true",
        help="Skip the framework-shells remote version check and pip auto-update/install path.",
    )
    parser.add_argument(
        "--broadcast",
        nargs="+",
        metavar="IP_SUBNET_OR_IFACE",
        help='Enable network access. Provide "all", IPs, subnets, or interfaces.',
    )
    parser.add_argument("--list-interfaces", action="store_true", help="Show available interfaces and exit")
    return parser.parse_args(argv)


def _framework_args(args: argparse.Namespace) -> list[str]:
    result: list[str] = []
    if args.broadcast:
        result.append("--broadcast")
        result.extend(args.broadcast)
    if args.list_interfaces:
        result.append("--list-interfaces")
    result.extend(["--port", str(args.port)])
    return result


def _ensure_run_id() -> None:
    if not os.environ.get("TE_RUN_ID"):
        os.environ["TE_RUN_ID"] = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def _compute_repo_fingerprint(root: Path) -> str:
    return hashlib.sha256(str(root.resolve()).encode("utf-8")).hexdigest()[:16]


def _ensure_framework_secret(root: Path) -> None:
    fingerprint = _compute_repo_fingerprint(root)
    secret_dir = Path.home() / ".cache" / "framework_shells" / "runtimes" / fingerprint
    secret_dir.mkdir(parents=True, exist_ok=True)
    secret_file = secret_dir / "secret"
    if secret_file.exists():
        secret = secret_file.read_text(encoding="utf-8").strip()
    else:
        secret = secrets.token_hex(32)
        secret_file.write_text(secret, encoding="utf-8")
        secret_file.chmod(0o600)
    os.environ["FRAMEWORK_SHELLS_SECRET"] = secret
    os.environ["FRAMEWORK_SHELLS_REPO_FINGERPRINT"] = fingerprint
    os.environ["FRAMEWORK_SHELLS_BASE_DIR"] = str(Path.home() / ".cache" / "framework_shells")


def _cleanup_framework_shell_logs() -> None:
    base_dir = Path.home() / ".cache" / "te_framework"
    logs_dir = base_dir / "logs"
    preserved_dir = base_dir / "preserved_logs"
    if logs_dir.exists() and any(logs_dir.iterdir()):
        archive_dir = preserved_dir / f"logs_{int(time.time())}"
        preserved_dir.mkdir(parents=True, exist_ok=True)
        logs_dir.rename(archive_dir)
        print(f"[run_framework] Archived leftover shell logs to {archive_dir}")
        logs_dir.mkdir(parents=True, exist_ok=True)

    if not preserved_dir.exists():
        return
    cutoff = int(time.time()) - 604800
    count = 0
    for entry in preserved_dir.glob("logs_*"):
        if not entry.is_dir():
            continue
        try:
            ts = int(entry.name.removeprefix("logs_"))
        except ValueError:
            continue
        if ts < cutoff:
            shutil.rmtree(entry, ignore_errors=True)
            count += 1
    if count:
        print(f"[run_framework] Cleaned {count} preserved log archives older than 7 days")


def _cleanup_pycache(root: Path) -> None:
    for path in root.rglob("__pycache__"):
        shutil.rmtree(path, ignore_errors=True)


def _supervisor_running() -> bool:
    proc = subprocess.run(
        ["pgrep", "-f", "python -m app.supervisor"],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def _maybe_autoupdate_framework_shells(argv: list[str]) -> None:
    if os.environ.get("TE2_DISABLE_FWS_AUTOUPDATE") == "1":
        return
    if os.environ.get("TE2_FWS_AUTOUPDATED_ONCE") == "1":
        return
    if shutil.which("git") is None:
        print("[run_framework] WARNING: git not found; skipping framework-shells auto-update", file=sys.stderr)
        return

    python_bin = os.environ.get("PYTHON_BIN", sys.executable)
    remote = subprocess.run(
        ["git", "ls-remote", "https://github.com/mrsurge/framework-shells", "main"],
        capture_output=True,
        text=True,
        check=False,
    )
    remote_commit = remote.stdout.split()[0].strip() if remote.returncode == 0 and remote.stdout.strip() else ""
    if not remote_commit:
        print("[run_framework] WARNING: failed to resolve framework-shells remote commit; skipping auto-update", file=sys.stderr)
        return

    installed_commit_proc = subprocess.run(
        [
            python_bin,
            "-c",
            (
                "import json\n"
                "from importlib import metadata\n"
                "try:\n"
                " d=metadata.distribution('framework-shells')\n"
                " t=d.read_text('direct_url.json') or ''\n"
                " j=json.loads(t) if t else {}\n"
                " print(((j.get('vcs_info') or {}).get('commit_id') or '').strip())\n"
                "except Exception:\n"
                " print('')\n"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    installed_commit = installed_commit_proc.stdout.strip()
    if installed_commit and installed_commit == remote_commit:
        return

    print(f"[run_framework] Updating framework-shells (installed={installed_commit or 'none'} remote={remote_commit})")
    subprocess.run(
        [python_bin, "-m", "pip", "install", "-U", "framework-shells @ git+https://github.com/mrsurge/framework-shells@main"],
        check=True,
    )
    os.environ["TE2_FWS_AUTOUPDATED_ONCE"] = "1"
    os.execv(python_bin, [python_bin, "-m", "app.cli.run_framework", *argv])


def _http_post(url: str, timeout: float = 2.0) -> bool:
    request = urllib.request.Request(url, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except Exception:
        return False


def _http_get_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout):
            return True
    except Exception:
        return False


def _start_ipc_server(
    framework_port: int,
    ipc_host: str,
    ipc_port: int,
    sleep_port: int,
    framework_args: list[str],
) -> int:
    pid_file = Path.home() / ".cache" / "te_framework" / "ipc.pid"
    if pid_file.exists():
        try:
            existing_pid = int(pid_file.read_text(encoding="utf-8").strip())
            os.kill(existing_pid, 0)
            os.environ["TE_IPC_PID"] = str(existing_pid)
            print(f"[run_framework] Reusing existing IPC server (pid {existing_pid})")
            return existing_pid
        except Exception:
            pid_file.unlink(missing_ok=True)

    python_bin = os.environ.get("PYTHON_BIN", sys.executable)
    env = os.environ.copy()
    env["TE_FRAMEWORK_ARGS_JSON"] = json.dumps(framework_args)
    env["TE_FRAMEWORK_URL"] = env.get("TE_FRAMEWORK_URL", f"http://127.0.0.1:{framework_port}")
    env["TE_IPC_PERSIST"] = "1"
    env["IPC_LOG_PREFIX"] = "1"

    cmd = [
        python_bin,
        "-m",
        "app.ipc.server",
        "--host",
        ipc_host,
        "--port",
        str(ipc_port),
        "--sleep",
        "--sleep-port",
        str(sleep_port),
    ]
    print(f"[run_framework] Starting IPC server on {ipc_host}:{ipc_port} (sleep listener :{sleep_port})")
    proc = subprocess.Popen(cmd, env=env, start_new_session=True)
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(str(proc.pid), encoding="utf-8")
    os.environ["TE_IPC_PID"] = str(proc.pid)
    print(f"[run_framework] IPC server pid {proc.pid}")
    return proc.pid


def _shutdown_ipc(ipc_host: str, sleep_port: int, ipc_pid: int) -> None:
    global _shutdown_in_progress
    if _shutdown_in_progress:
        return
    _shutdown_in_progress = True
    _http_post(f"http://{ipc_host}:{sleep_port}/actions/exit") or _http_post(f"http://{ipc_host}:{sleep_port}/actions/sleep")
    deadline = time.time() + float(os.environ.get("TE_RUNNER_SHUTDOWN_WAIT_SECONDS", str(DEFAULT_SHUTDOWN_WAIT_SECONDS)))
    while time.time() < deadline:
        supervisor_alive = _supervisor_running()
        try:
            os.kill(ipc_pid, 0)
            ipc_alive = True
        except OSError:
            ipc_alive = False
        if not supervisor_alive and not ipc_alive:
            return
        if not supervisor_alive and ipc_alive:
            time.sleep(0.5)
            try:
                os.kill(ipc_pid, signal.SIGTERM)
            except OSError:
                pass
            return
        time.sleep(0.1)
    try:
        os.kill(ipc_pid, signal.SIGTERM)
    except OSError:
        pass


def _read_ctrl_s(enabled: bool, saved_attrs: list[int] | None) -> bool:
    if not enabled:
        return False
    import select

    ready, _, _ = select.select([sys.stdin], [], [], 0.2)
    if not ready:
        return False
    char = sys.stdin.read(1)
    return char == "\x13"


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    args = _parse_args(argv)

    root = _package_root()
    os.chdir(root)

    _ensure_run_id()
    _ensure_framework_secret(root)
    if args.no_fws_autoupdate:
        os.environ["TE2_DISABLE_FWS_AUTOUPDATE"] = "1"
    _maybe_autoupdate_framework_shells(argv)
    _cleanup_framework_shell_logs()
    _cleanup_pycache(root)

    if _supervisor_running():
        print("[run_framework] Framework already running. Stop it first or use different args.", file=sys.stderr)
        return 1

    ipc_host = os.environ.get("TE_IPC_HOST", DEFAULT_IPC_HOST)
    ipc_port = args.ipc_port or int(os.environ.get("TE_IPC_PORT", str(DEFAULT_IPC_PORT)))
    sleep_port = DEFAULT_SLEEP_PORT

    os.environ["TE_IPC_HOST"] = ipc_host
    os.environ["TE_IPC_PORT"] = str(ipc_port)
    os.environ["TE_PORT"] = str(args.port)

    framework_args = _framework_args(args)
    ipc_pid = _start_ipc_server(args.port, ipc_host, ipc_port, sleep_port, framework_args)

    def _handle_signal(_signum: int, _frame: object) -> None:
        _shutdown_ipc(ipc_host, sleep_port, ipc_pid)
        raise SystemExit(0)

    for _ in range(50):
        if _http_get_ok(f"http://{ipc_host}:{sleep_port}/health"):
            break
        time.sleep(0.1)

    if not args.sleep:
        python_bin = os.environ.get("PYTHON_BIN", sys.executable)
        cmd = [python_bin, "-m", "app.supervisor", *framework_args]
        print("[run_framework] Starting supervisor directly")
        os.execvpe(python_bin, cmd, os.environ.copy())
    else:
        print(f"[run_framework] Sleep mode: framework not started (wake via http://{ipc_host}:{sleep_port}/actions/wake)")

    atexit.register(_shutdown_ipc, ipc_host, sleep_port, ipc_pid)
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    tty_enabled = False
    saved_attrs = None
    if sys.stdin.isatty():
        try:
            import termios
            import tty

            saved_attrs = termios.tcgetattr(sys.stdin.fileno())
            tty.setcbreak(sys.stdin.fileno())
            tty_enabled = True
        except Exception:
            tty_enabled = False

    try:
        while True:
            try:
                os.kill(ipc_pid, 0)
            except OSError:
                break
            if _read_ctrl_s(tty_enabled, saved_attrs):
                print("[run_framework] Ctrl+S -> /actions/sleep")
                _http_post(f"http://{ipc_host}:{sleep_port}/actions/sleep")
            time.sleep(0.05)
    finally:
        if tty_enabled and saved_attrs is not None:
            try:
                import termios

                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, saved_attrs)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
