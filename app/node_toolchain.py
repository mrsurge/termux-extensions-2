from __future__ import annotations

from collections.abc import Mapping
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import cast


class NodeToolchainError(RuntimeError):
    pass


def _absolute_executable(raw: str | Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(str(raw))))


def _is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def _candidate_pair(
    node_raw: str | Path,
    npm_raw: str | Path | None = None,
) -> tuple[Path, Path] | None:
    node = _absolute_executable(node_raw)
    npm = _absolute_executable(npm_raw) if npm_raw else node.parent / "npm"
    if _is_executable(node) and _is_executable(npm):
        return node, npm
    return None


def _login_shell_node_pair(environ: Mapping[str, str]) -> tuple[Path, Path] | None:
    shell_candidates = [
        str(environ.get("SHELL") or "").strip(),
        shutil.which("bash", path=environ.get("PATH")) or "",
        shutil.which("zsh", path=environ.get("PATH")) or "",
        shutil.which("sh", path=environ.get("PATH")) or "",
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
                env=dict(environ),
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


def _python_environment_node_pair() -> tuple[Path, Path] | None:
    return _candidate_pair(Path(sys.executable).parent / "node")


def _nodejs_wheel_root(node_binary: Path) -> Path | None:
    if node_binary.parent != Path(sys.executable).parent:
        return None
    spec = importlib.util.find_spec("nodejs_wheel")
    origin = spec.origin if spec is not None else None
    if not origin:
        return None
    package_root = Path(origin).parent
    if (package_root / "include" / "node" / "node.h").is_file():
        return package_root
    return None


def resolve_node_toolchain(
    *,
    node_override_key: str,
    npm_override_key: str,
    environ: Mapping[str, str] | None = None,
) -> tuple[Path, Path]:
    source = environ if environ is not None else os.environ
    node_override = str(source.get(node_override_key) or "").strip()
    npm_override = str(source.get(npm_override_key) or "").strip()
    if node_override:
        pair = _candidate_pair(node_override, npm_override or None)
        if pair is not None:
            return pair

    python_pair = _python_environment_node_pair()
    if python_pair is not None:
        return python_pair

    path_node = shutil.which("node", path=source.get("PATH"))
    path_npm = shutil.which("npm", path=source.get("PATH"))
    if path_node:
        pair = _candidate_pair(path_node, path_npm)
        if pair is not None:
            return pair

    login_pair = _login_shell_node_pair(source)
    if login_pair is not None:
        return login_pair

    home = Path(str(source.get("HOME") or Path.home())).expanduser()
    nvm_root = Path(str(source.get("NVM_DIR") or home / ".nvm")).expanduser()
    nvm_nodes = list(nvm_root.glob("versions/node/*/bin/node"))
    nvm_nodes.sort(
        key=lambda path: path.stat().st_mtime if path.exists() else 0,
        reverse=True,
    )
    for node in nvm_nodes:
        pair = _candidate_pair(node)
        if pair is not None:
            return pair

    prefix = str(source.get("PREFIX") or "").strip()
    if prefix:
        pair = _candidate_pair(Path(prefix) / "bin" / "node")
        if pair is not None:
            return pair

    raise NodeToolchainError(
        f"Unable to find a usable Node.js/npm toolchain. Set {node_override_key} "
        + f"and {npm_override_key} to explicit executables."
    )


def node_toolchain_env(
    node_binary: Path,
    *,
    environ: Mapping[str, str] | None = None,
) -> dict[str, str]:
    env = dict(environ if environ is not None else os.environ)
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
        _ = env.setdefault("npm_config_nodedir", prefix)
    wheel_root = _nodejs_wheel_root(node_binary)
    if wheel_root is not None:
        _ = env.setdefault("npm_config_nodedir", str(wheel_root))
    return env


def inspect_node_identity(
    node_binary: Path,
    *,
    environ: Mapping[str, str] | None = None,
) -> dict[str, str]:
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
            env=node_toolchain_env(node_binary, environ=environ),
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise NodeToolchainError(f"Unable to inspect Node.js runtime: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise NodeToolchainError(f"Unable to inspect Node.js runtime: {detail}")
    try:
        loaded = cast(object, json.loads(result.stdout))
    except json.JSONDecodeError as exc:
        raise NodeToolchainError("Node.js returned an invalid runtime identity") from exc
    if not isinstance(loaded, dict):
        raise NodeToolchainError("Node.js returned a non-object runtime identity")
    raw = cast(dict[str, object], loaded)
    identity = {
        key: str(raw.get(key) or "")
        for key in ("platform", "arch", "modules", "node")
    }
    if not all(identity.values()):
        raise NodeToolchainError(
            f"Node.js returned an incomplete runtime identity: {identity}"
        )
    return identity
