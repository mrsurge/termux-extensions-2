from __future__ import annotations

from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Final
import uuid


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
    data_home = Path(
        os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    ).expanduser()
    return (data_home / "te2" / "node_runtime" / "terminal").resolve()


def _absolute_executable(raw: str | Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(str(raw))))


def _is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def _candidate_pair(node_raw: str | Path, npm_raw: str | Path | None = None) -> tuple[Path, Path] | None:
    node = _absolute_executable(node_raw)
    npm = _absolute_executable(npm_raw) if npm_raw else node.parent / "npm"
    if _is_executable(node) and _is_executable(npm):
        return node, npm
    return None


def _login_shell_node_pair() -> tuple[Path, Path] | None:
    shell_candidates = [
        str(os.environ.get("SHELL") or "").strip(),
        shutil.which("bash") or "",
        shutil.which("zsh") or "",
        shutil.which("sh") or "",
    ]
    command = (
        "printf '__TE2_NODE__%s\\n' \"$(command -v node 2>/dev/null)\"; "
        "printf '__TE2_NPM__%s\\n' \"$(command -v npm 2>/dev/null)\""
    )
    seen: set[str] = set()
    for raw_shell in shell_candidates:
        if not raw_shell:
            continue
        shell = str(_absolute_executable(raw_shell))
        if shell in seen or not _is_executable(Path(shell)):
            continue
        seen.add(shell)
        flag = "-lic" if Path(shell).name in {"bash", "zsh"} else "-lc"
        try:
            result = subprocess.run(
                [shell, flag, command],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        node_value = ""
        npm_value = ""
        for line in result.stdout.splitlines():
            if line.startswith("__TE2_NODE__"):
                node_value = line.removeprefix("__TE2_NODE__").strip()
            elif line.startswith("__TE2_NPM__"):
                npm_value = line.removeprefix("__TE2_NPM__").strip()
        if node_value and npm_value:
            pair = _candidate_pair(node_value, npm_value)
            if pair is not None:
                return pair
    return None


def resolve_node_toolchain() -> tuple[Path, Path]:
    node_override = str(os.environ.get("TE2_TERMINAL_NODE_BIN") or "").strip()
    npm_override = str(os.environ.get("TE2_TERMINAL_NPM_BIN") or "").strip()
    candidates: list[tuple[Path, Path]] = []
    if node_override:
        pair = _candidate_pair(node_override, npm_override or None)
        if pair is not None:
            candidates.append(pair)

    path_node = shutil.which("node")
    path_npm = shutil.which("npm")
    if path_node:
        pair = _candidate_pair(path_node, path_npm)
        if pair is not None:
            candidates.append(pair)

    login_pair = _login_shell_node_pair()
    if login_pair is not None:
        candidates.append(login_pair)

    nvm_root = Path(os.environ.get("NVM_DIR", str(Path.home() / ".nvm"))).expanduser()
    nvm_nodes = list(nvm_root.glob("versions/node/*/bin/node"))
    nvm_nodes.sort(key=lambda path: path.stat().st_mtime if path.exists() else 0, reverse=True)
    for node in nvm_nodes:
        pair = _candidate_pair(node)
        if pair is not None:
            candidates.append(pair)

    prefix = str(os.environ.get("PREFIX") or "").strip()
    if prefix:
        pair = _candidate_pair(Path(prefix) / "bin" / "node")
        if pair is not None:
            candidates.append(pair)

    seen: set[tuple[str, str]] = set()
    for node, npm in candidates:
        key = (str(node), str(npm))
        if key in seen:
            continue
        seen.add(key)
        return node, npm

    detail = "Set TE2_TERMINAL_NODE_BIN and TE2_TERMINAL_NPM_BIN to explicit executables."
    raise NodeRuntimeError(f"Unable to find a usable Node.js/npm toolchain. {detail}")


def _toolchain_env(node_binary: Path) -> dict[str, str]:
    env = os.environ.copy()
    path_parts = [part for part in env.get("PATH", "").split(os.pathsep) if part]
    node_dir = str(node_binary.parent)
    if node_dir in path_parts:
        path_parts.remove(node_dir)
    path_parts.insert(0, node_dir)
    env["PATH"] = os.pathsep.join(path_parts)
    env["npm_config_audit"] = "false"
    env["npm_config_fund"] = "false"
    env["npm_config_update_notifier"] = "false"
    prefix = str(env.get("PREFIX") or "").strip()
    if prefix and (Path(prefix) / "include" / "node" / "node.h").is_file():
        env.setdefault("npm_config_nodedir", prefix)
    return env


def _node_identity(node_binary: Path) -> dict[str, str]:
    expression = (
        "JSON.stringify({platform:process.platform,arch:process.arch,"
        "modules:String(process.versions.modules||''),node:String(process.versions.node||'')})"
    )
    try:
        result = subprocess.run(
            [str(node_binary), "-p", expression],
            capture_output=True,
            text=True,
            timeout=15,
            env=_toolchain_env(node_binary),
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise NodeRuntimeError(f"Unable to inspect Node.js runtime: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise NodeRuntimeError(f"Unable to inspect Node.js runtime: {detail}")
    try:
        raw = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise NodeRuntimeError("Node.js returned an invalid runtime identity") from exc
    identity = {key: str(raw.get(key) or "") for key in ("platform", "arch", "modules", "node")}
    if not all(identity.values()):
        raise NodeRuntimeError(f"Node.js returned an incomplete runtime identity: {identity}")
    return identity


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
        actual = json.loads(marker.read_text(encoding="utf-8"))
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
    shutil.copy2(PACKAGE_JSON, stage / "package.json")
    shutil.copy2(PACKAGE_LOCK, stage / "package-lock.json")
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
            (stage / ".te2-runtime.json").write_text(
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
