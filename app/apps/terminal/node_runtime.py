from __future__ import annotations

from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Final, cast
import uuid

from app.node_toolchain import (
    NodeToolchainError,
    inspect_node_identity,
    node_toolchain_env,
    resolve_node_toolchain as resolve_shared_node_toolchain,
)
from app.te2_paths import te2_data_home


APP_ROOT: Final = Path(__file__).resolve().parent
PACKAGE_JSON: Final = APP_ROOT / "package.json"
PACKAGE_LOCK: Final = APP_ROOT / "package-lock.json"
RUNTIME_PACKAGES: Final = (
    "@msgpack/msgpack",
    "node-pty",
    "xterm",
    "xterm-addon-serialize",
    "xterm-headless",
)
LOADABLE_RUNTIME_PACKAGES: Final = tuple(
    package for package in RUNTIME_PACKAGES if package != "xterm"
)
BOOTSTRAP_VERSION: Final = "terminal-node-runtime-v2"


class NodeRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class NodeRuntime:
    node_binary: Path
    npm_binary: Path
    root: Path
    fingerprint: str
    identity: dict[str, str]
    executable_path: str


def terminal_node_runtime_base() -> Path:
    explicit = str(os.environ.get("TE2_TERMINAL_NODE_RUNTIME_DIR") or "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    return (te2_data_home() / "node_runtime" / "terminal").resolve()


def resolve_node_toolchain() -> tuple[Path, Path]:
    try:
        return resolve_shared_node_toolchain(
            node_override_key="TE2_TERMINAL_NODE_BIN",
            npm_override_key="TE2_TERMINAL_NPM_BIN",
        )
    except NodeToolchainError as exc:
        raise NodeRuntimeError(str(exc)) from exc


def _toolchain_env(node_binary: Path) -> dict[str, str]:
    return node_toolchain_env(node_binary)


def _node_identity(node_binary: Path) -> dict[str, str]:
    try:
        return inspect_node_identity(node_binary)
    except NodeToolchainError as exc:
        raise NodeRuntimeError(str(exc)) from exc


def _runtime_fingerprint(identity: dict[str, str]) -> str:
    hasher = hashlib.sha256()
    hasher.update(BOOTSTRAP_VERSION.encode("utf-8"))
    hasher.update(b"\0")
    hasher.update(PACKAGE_JSON.read_bytes())
    hasher.update(b"\0")
    hasher.update(PACKAGE_LOCK.read_bytes())
    hasher.update(b"\0")
    hasher.update(json.dumps(identity, sort_keys=True).encode("utf-8"))
    suffix = hasher.hexdigest()[:20]
    return f"{identity['platform']}-{identity['arch']}-abi{identity['modules']}-{suffix}"


def _marker_payload(fingerprint: str, identity: dict[str, str]) -> dict[str, object]:
    return {
        "bootstrap": BOOTSTRAP_VERSION,
        "fingerprint": fingerprint,
        "identity": identity,
        "packages": list(RUNTIME_PACKAGES),
    }


def _runtime_is_ready(root: Path, expected: dict[str, object]) -> bool:
    marker = root / ".te2-runtime.json"
    try:
        actual = cast(object, json.loads(marker.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return False
    if actual != expected:
        return False
    for package in RUNTIME_PACKAGES:
        package_path = root / "node_modules" / Path(*package.split("/")) / "package.json"
        if not package_path.is_file():
            return False
    return True


def _run_checked(command: list[str], *, env: dict[str, str], cwd: Path, label: str) -> None:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise NodeRuntimeError(f"{label} failed: {exc}") from exc
    if result.returncode == 0:
        return
    lines = result.stdout.strip().splitlines()
    detail = "\n".join(lines[-40:]) or f"exit status {result.returncode}"
    raise NodeRuntimeError(f"{label} failed:\n{detail}")


def _prune_foreign_node_pty_prebuilds(stage: Path, identity: dict[str, str]) -> None:
    prebuilds = stage / "node_modules" / "node-pty" / "prebuilds"
    if not prebuilds.is_dir():
        return
    current = f"{identity['platform']}-{identity['arch']}"
    for child in prebuilds.iterdir():
        if child.name == current:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def _install_runtime(
    stage: Path,
    node_binary: Path,
    npm_binary: Path,
    identity: dict[str, str],
) -> None:
    stage.mkdir(parents=True, exist_ok=False)
    _ = shutil.copy2(PACKAGE_JSON, stage / "package.json")
    _ = shutil.copy2(PACKAGE_LOCK, stage / "package-lock.json")
    env = _toolchain_env(node_binary)
    env["NODE_ENV"] = "production"
    _run_checked(
        [
            str(npm_binary),
            "ci",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
        ],
        env=env,
        cwd=stage,
        label="Terminal Node dependency installation",
    )
    _prune_foreign_node_pty_prebuilds(stage, identity)
    verification = (
        "const {createRequire}=require('node:module');"
        "const path=require('node:path');"
        "if(Object.prototype.hasOwnProperty.call(globalThis,'navigator')) delete globalThis.navigator;"
        "const req=createRequire(path.join(process.argv[1],'package.json'));"
        f"for(const name of {json.dumps(list(LOADABLE_RUNTIME_PACKAGES))}) req(name);"
    )
    _run_checked(
        [str(node_binary), "-e", verification, str(stage)],
        env=env,
        cwd=stage,
        label="Terminal Node dependency verification",
    )


def ensure_terminal_node_runtime() -> NodeRuntime:
    if not PACKAGE_JSON.is_file() or not PACKAGE_LOCK.is_file():
        raise NodeRuntimeError("Terminal package metadata is missing from this TE2 installation")

    node_binary, npm_binary = resolve_node_toolchain()
    identity = _node_identity(node_binary)
    fingerprint = _runtime_fingerprint(identity)
    base = terminal_node_runtime_base()
    target = base / fingerprint
    marker_payload = _marker_payload(fingerprint, identity)
    base.mkdir(parents=True, exist_ok=True)
    lock_path = base / ".bootstrap.lock"

    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        if _runtime_is_ready(target, marker_payload):
            return NodeRuntime(
                node_binary,
                npm_binary,
                target,
                fingerprint,
                identity,
                _toolchain_env(node_binary)["PATH"],
            )

        stage = base / f".{fingerprint}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        try:
            _install_runtime(stage, node_binary, npm_binary, identity)
            _ = (stage / ".te2-runtime.json").write_text(
                json.dumps(marker_payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            if target.exists():
                shutil.rmtree(target)
            os.replace(stage, target)
        finally:
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)

    return NodeRuntime(
        node_binary,
        npm_binary,
        target,
        fingerprint,
        identity,
        _toolchain_env(node_binary)["PATH"],
    )
