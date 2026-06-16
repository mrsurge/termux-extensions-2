from __future__ import annotations

import argparse
import hashlib
import importlib
import os
import secrets
import signal
import subprocess
import sys
from collections.abc import Callable, MutableMapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import FrameType
from typing import cast

APP_ID = "te2-rust-spike"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = "8089"
SERVER_PACKAGE = "te2-rust-spike-server"

SignalHandler = int | signal.Handlers | Callable[[int, FrameType | None], object]


@dataclass(frozen=True)
class BootstrapArgs:
    host: str
    port: str
    server_bin: str | None
    cargo_manifest: str | None
    release: bool
    build_only: bool
    print_command: bool
    no_ferrous_framework: bool
    framework_shells_base_dir: str | None
    framework_shells_secret: str | None
    framework_shells_repo_fingerprint: str | None
    framework_shells_secret_fingerprint: str | None
    framework_shells_fws_socketio_server_pid: str | None
    framework_shells_run_id: str | None


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    env = _build_env(args)
    command = _server_command(args, env)
    if args.print_command:
        print(" ".join(command))
        return 0
    return _run_child(command, env)


def _parse_args(argv: Sequence[str] | None) -> BootstrapArgs:
    parser = argparse.ArgumentParser(
        prog="te2-rust-spike",
        description="Build and launch the TE2 Rust framework spike.",
    )
    parser.add_argument("--host", default=os.environ.get("TE2_RUST_SPIKE_HOST", DEFAULT_HOST))
    parser.add_argument("--port", default=os.environ.get("TE2_RUST_SPIKE_PORT", os.environ.get("TE_PORT", DEFAULT_PORT)))
    parser.add_argument(
        "--server-bin",
        default=os.environ.get("TE2_RUST_SPIKE_SERVER_BIN"),
        help="Path to an already-built Rust server binary. Defaults to cargo run.",
    )
    parser.add_argument(
        "--cargo-manifest",
        default=os.environ.get("TE2_RUST_SPIKE_CARGO_MANIFEST"),
        help="Path to rust/Cargo.toml for development launches.",
    )
    parser.add_argument("--release", action="store_true", default=_env_flag("TE2_RUST_SPIKE_RELEASE"))
    parser.add_argument("--build-only", action="store_true", help="Build the Rust server and exit without launching it.")
    parser.add_argument("--print-command", action="store_true", help="Print the resolved child command and exit.")
    parser.add_argument(
        "--no-ferrous-framework",
        action="store_true",
        default=_env_flag("TE2_RUST_SPIKE_DISABLE_FERROUS_FRAMEWORK"),
        help="Do not enable the PyO3-backed ferrous-framework feature for cargo builds.",
    )
    parser.add_argument("--framework-shells-base-dir", default=os.environ.get("FRAMEWORK_SHELLS_BASE_DIR"))
    parser.add_argument("--framework-shells-secret", default=os.environ.get("FRAMEWORK_SHELLS_SECRET"))
    parser.add_argument(
        "--framework-shells-repo-fingerprint",
        default=os.environ.get("FRAMEWORK_SHELLS_REPO_FINGERPRINT"),
    )
    parser.add_argument(
        "--framework-shells-secret-fingerprint",
        default=os.environ.get("FRAMEWORK_SHELLS_SECRET_FINGERPRINT"),
    )
    parser.add_argument(
        "--framework-shells-fws-socketio-server-pid",
        default=os.environ.get("FRAMEWORK_SHELLS_FWS_SOCKETIO_SERVER_PID"),
    )
    parser.add_argument("--framework-shells-run-id", default=os.environ.get("FRAMEWORK_SHELLS_RUN_ID"))
    raw = parser.parse_args(argv)
    return BootstrapArgs(
        host=cast(str, raw.host),
        port=cast(str, raw.port),
        server_bin=cast(str | None, raw.server_bin),
        cargo_manifest=cast(str | None, raw.cargo_manifest),
        release=cast(bool, raw.release),
        build_only=cast(bool, raw.build_only),
        print_command=cast(bool, raw.print_command),
        no_ferrous_framework=cast(bool, raw.no_ferrous_framework),
        framework_shells_base_dir=cast(str | None, raw.framework_shells_base_dir),
        framework_shells_secret=cast(str | None, raw.framework_shells_secret),
        framework_shells_repo_fingerprint=cast(str | None, raw.framework_shells_repo_fingerprint),
        framework_shells_secret_fingerprint=cast(str | None, raw.framework_shells_secret_fingerprint),
        framework_shells_fws_socketio_server_pid=cast(str | None, raw.framework_shells_fws_socketio_server_pid),
        framework_shells_run_id=cast(str | None, raw.framework_shells_run_id),
    )


def _build_env(args: BootstrapArgs) -> dict[str, str]:
    env = os.environ.copy()
    project_root = _project_root()
    app_roots = [
        project_root / "app" / "apps",
        Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "te2" / "apps",
    ]

    env["TE2_RUST_SPIKE_HOST"] = str(args.host)
    env["TE2_RUST_SPIKE_PORT"] = str(args.port)
    env["TE2_RUST_SPIKE_PROJECT_ROOT"] = str(project_root)
    env["TE2_RUST_SPIKE_APP_ROOTS"] = os.pathsep.join(str(root) for root in app_roots)
    env["TE_PORT"] = str(args.port)
    env["TE_FRAMEWORK_URL"] = f"http://{args.host}:{args.port}"
    env.setdefault("PYTHONPATH", str(project_root))
    if str(project_root) not in env["PYTHONPATH"].split(os.pathsep):
        env["PYTHONPATH"] = f"{project_root}{os.pathsep}{env['PYTHONPATH']}"

    _ensure_framework_shells_env(env, args)
    if _ferrous_framework_enabled(args):
        env.pop("PYO3_CONFIG_FILE", None)
        env["PYO3_PYTHON"] = sys.executable
    return env


def _server_command(args: BootstrapArgs, env: MutableMapping[str, str]) -> list[str]:
    if args.server_bin:
        if args.build_only:
            raise SystemExit("--build-only cannot be used with --server-bin")
        return [str(Path(args.server_bin))]

    manifest = Path(args.cargo_manifest) if args.cargo_manifest else _default_rust_manifest()
    subcommand = "build" if args.build_only else "run"
    command = [
        "cargo",
        subcommand,
        "--manifest-path",
        str(manifest),
        "-p",
        SERVER_PACKAGE,
    ]
    if args.release:
        command.append("--release")
    if _ferrous_framework_enabled(args):
        command.extend(["--features", "ferrous-framework-pyo3"])
    if not args.build_only:
        command.append("--")
    return command


def _ferrous_framework_enabled(args: BootstrapArgs) -> bool:
    return not args.no_ferrous_framework


def _ensure_framework_shells_env(env: dict[str, str], args: BootstrapArgs) -> None:
    _set_if_present(env, "FRAMEWORK_SHELLS_BASE_DIR", args.framework_shells_base_dir)
    _set_if_present(env, "FRAMEWORK_SHELLS_SECRET", args.framework_shells_secret)
    _set_if_present(env, "FRAMEWORK_SHELLS_REPO_FINGERPRINT", args.framework_shells_repo_fingerprint)
    _set_if_present(
        env,
        "FRAMEWORK_SHELLS_SECRET_FINGERPRINT",
        args.framework_shells_secret_fingerprint or args.framework_shells_repo_fingerprint,
    )
    _set_if_present(env, "FRAMEWORK_SHELLS_FWS_SOCKETIO_SERVER_PID", args.framework_shells_fws_socketio_server_pid)
    _set_if_present(env, "FRAMEWORK_SHELLS_RUN_ID", args.framework_shells_run_id)
    env.setdefault("FRAMEWORK_SHELLS_RUN_ID", APP_ID)
    env.setdefault("FRAMEWORK_SHELLS_SIGWINCH_ON_RESIZE", "1")

    if env.get("FRAMEWORK_SHELLS_SECRET"):
        _prime_framework_shells_import(env)
        return

    fingerprint = env.get("FRAMEWORK_SHELLS_REPO_FINGERPRINT") or _framework_shells_fingerprint()
    env["FRAMEWORK_SHELLS_REPO_FINGERPRINT"] = fingerprint
    env.setdefault("FRAMEWORK_SHELLS_SECRET_FINGERPRINT", fingerprint)

    base_dir = Path(env.get("FRAMEWORK_SHELLS_BASE_DIR") or _default_framework_shells_base_dir())
    secret_dir = base_dir / "runtimes" / fingerprint
    secret_file = secret_dir / "secret"
    if secret_file.is_file():
        secret = secret_file.read_text(encoding="utf-8").strip()
    else:
        secret_dir.mkdir(parents=True, exist_ok=True)
        secret = secrets.token_hex(32)
        secret_file.write_text(secret, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except OSError:
            pass

    env["FRAMEWORK_SHELLS_BASE_DIR"] = str(base_dir)
    env["FRAMEWORK_SHELLS_SECRET"] = secret
    _prime_framework_shells_import(env)


def _set_if_present(env: dict[str, str], key: str, value: str | None) -> None:
    if value:
        env[key] = value


def _framework_shells_fingerprint() -> str:
    root = os.environ.get("PWD") or str(_project_root())
    return hashlib.sha256(root.encode("utf-8")).hexdigest()[:16]


def _default_framework_shells_base_dir() -> Path:
    return Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "framework_shells"


def _prime_framework_shells_import(env: dict[str, str]) -> None:
    try:
        framework_shells = importlib.import_module("framework_shells")
    except ImportError:
        return
    get_secret = getattr(framework_shells, "get_secret", None)
    if not callable(get_secret):
        return

    framework_env = {key: value for key, value in env.items() if key.startswith("FRAMEWORK_SHELLS_")}
    previous = {key: os.environ.get(key) for key in framework_env}
    try:
        os.environ.update(framework_env)
        get_secret()
    finally:
        for key, old_value in previous.items():
            if old_value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old_value


def _run_child(command: Sequence[str], env: dict[str, str]) -> int:
    child = subprocess.Popen(command, env=env)
    previous_handlers: dict[signal.Signals, SignalHandler] = {}

    def forward_signal(signum: int, _frame: FrameType | None) -> object:
        if child.poll() is None:
            child.send_signal(signum)

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signum] = cast(SignalHandler, signal.getsignal(signum))
        signal.signal(signum, forward_signal)

    try:
        return child.wait()
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _source_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _project_root() -> Path:
    return _source_root().parent


def _default_rust_manifest() -> Path:
    return _source_root() / "rust" / "Cargo.toml"


if __name__ == "__main__":
    raise SystemExit(main())
