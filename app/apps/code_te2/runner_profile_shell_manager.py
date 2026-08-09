# pyright: strict
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
import hashlib
from importlib import import_module
import json
from pathlib import Path
import shlex
import sys
from typing import Awaitable, Protocol, cast

from .runner_profiles import RunProfile


# Runner profile shells are backend-owned runnable profile instances. They are
# labeled by project/profile so Play can reuse or relaunch deterministically.
JsonObject = dict[str, object]

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "runner_profile.yaml#runner-profile"
LAUNCHER_ENTRYPOINT = Path(__file__).parent / "runner_profile" / "launcher.py"

_spawn_locks: dict[str, asyncio.Lock] = {}


class ShellRecord(Protocol):
    id: str
    label: str | None
    pid: int | None
    status: str


class ShellManager(Protocol):
    def find_shell_by_label(
        self, label: str, *, status: str | None = None
    ) -> Awaitable[ShellRecord | None]: ...

    def terminate_shell(self, shell_id: str, *, force: bool = False) -> Awaitable[object]: ...


class OrchestratorInstance(Protocol):
    def start_from_ref(
        self,
        ref: str,
        *,
        base_dir: Path,
        ctx: JsonObject,
        label: str,
        record_spec_id: str,
        wait_ready: bool,
    ) -> Awaitable[ShellRecord]: ...


class OrchestratorFactory(Protocol):
    def __call__(self, manager: ShellManager) -> OrchestratorInstance: ...


class ManagerGetter(Protocol):
    def __call__(self) -> Awaitable[ShellManager]: ...


@dataclass(frozen=True)
class RunnerProfileShell:
    shell_id: str
    label: str
    runner: str
    reused: bool
    command_preview: str


@dataclass(frozen=True)
class RunnerProfileShellState:
    shell_id: str
    label: str
    running: bool


def _framework_get_manager() -> ManagerGetter:
    module = import_module("framework_shells")
    value = cast(object, module.__dict__["get_manager"])
    return cast(ManagerGetter, value)


def _orchestrator_factory() -> OrchestratorFactory:
    module = import_module("framework_shells.orchestrator")
    value = cast(object, module.__dict__["Orchestrator"])
    return cast(OrchestratorFactory, value)


async def ensure_runner_profile_shell(
    *,
    project_root: str,
    profile: RunProfile,
    matched_path: str,
) -> RunnerProfileShell:
    if profile.runner == "pagePreview":
        raise ValueError("pagePreview profiles must use the page preview runner")

    root = Path(project_root).expanduser().resolve(strict=False)
    cwd = _runner_cwd(root, profile)
    argv = _runner_argv(root, cwd, profile)
    command_preview = shlex.join(argv)
    label = _label(str(root), profile.profile_id)
    lock = _spawn_locks.setdefault(label, asyncio.Lock())

    async with lock:
        mgr = await _framework_get_manager()()
        existing = await mgr.find_shell_by_label(label, status="running")
        if existing is not None and _is_running(existing):
            if profile.running_behavior == "just save":
                return RunnerProfileShell(
                    shell_id=existing.id,
                    label=label,
                    runner=profile.runner,
                    reused=True,
                    command_preview=command_preview,
                )
            await mgr.terminate_shell(existing.id, force=True)
            await asyncio.sleep(0.2)

        orch = _orchestrator_factory()(mgr)
        shell = await orch.start_from_ref(
            SHELLSPEC_REF,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "PROJECT_ROOT": str(root),
                "RUN_PROFILE_CWD": str(cwd),
                "PROJECT_HASH": _project_hash(str(root)),
                "PROFILE_ID": profile.profile_id,
                "PROFILE_HASH": _hash_text(profile.profile_id),
                "RUNNER": profile.runner,
                "PYTHON_EXECUTABLE": sys.executable,
                "RUN_PROFILE_LAUNCHER": str(LAUNCHER_ENTRYPOINT),
                "RUN_PROFILE_COMMAND_B64": _command_payload_b64(
                    argv=argv,
                    env=_runner_env(profile, cwd=cwd, matched_path=matched_path),
                ),
            },
            label=label,
            record_spec_id=f"service:{APP_ID}:runner-profile",
            wait_ready=True,
        )
        return RunnerProfileShell(
            shell_id=shell.id,
            label=label,
            runner=profile.runner,
            reused=False,
            command_preview=command_preview,
        )


async def runner_profile_shell_state(
    *, project_root: str, profile_id: str
) -> RunnerProfileShellState:
    root = str(Path(project_root).expanduser().resolve(strict=False))
    label = _label(root, profile_id)
    mgr = await _framework_get_manager()()
    shell = await mgr.find_shell_by_label(label, status="running")
    return RunnerProfileShellState(
        shell_id=shell.id if _is_running(shell) else "",
        label=label,
        running=_is_running(shell),
    )


async def stop_runner_profile_shell(
    *, project_root: str, profile_id: str
) -> RunnerProfileShellState:
    root = str(Path(project_root).expanduser().resolve(strict=False))
    label = _label(root, profile_id)
    lock = _spawn_locks.setdefault(label, asyncio.Lock())
    async with lock:
        mgr = await _framework_get_manager()()
        shell = await mgr.find_shell_by_label(label, status="running")
        if not _is_running(shell):
            return RunnerProfileShellState(shell_id="", label=label, running=False)
        shell_id = shell.id
        await mgr.terminate_shell(shell_id, force=True)
        return RunnerProfileShellState(shell_id=shell_id, label=label, running=False)


def _runner_argv(root: Path, cwd: Path, profile: RunProfile) -> list[str]:
    if profile.runner == "custom":
        return [*_custom_exec_argv(profile), *profile.args]
    if profile.runner == "node":
        return ["node", _project_exec_arg(root, cwd, profile), *profile.args]
    if profile.runner == "python":
        return ["python", _project_exec_arg(root, cwd, profile), *profile.args]
    raise ValueError(f"Run profile '{profile.profile_id}' has unsupported runner '{profile.runner}'")


def _runner_env(profile: RunProfile, *, cwd: Path, matched_path: str) -> dict[str, str]:
    env = dict(profile.env)
    env.setdefault("TE2_RUN_PROFILE_ID", profile.profile_id)
    env.setdefault("TE2_RUN_PROFILE_RUNNER", profile.runner)
    env.setdefault("TE2_RUN_PROFILE_EXEC", profile.exec_command)
    env.setdefault("TE2_RUN_PROFILE_CWD", str(cwd))
    env.setdefault("TE2_RUN_PROFILE_MATCHED_PATH", matched_path)
    return env


def _custom_exec_argv(profile: RunProfile) -> list[str]:
    text = _exec_text(profile)
    try:
        argv = shlex.split(text)
    except ValueError as exc:
        raise ValueError(f"Run profile '{profile.profile_id}' has invalid exec: {exc}") from exc
    if not argv:
        raise ValueError(f"Run profile '{profile.profile_id}' must define exec")
    return argv


def _project_exec_arg(root: Path, cwd: Path, profile: RunProfile) -> str:
    text = _exec_text(profile)
    path = Path(text)
    if path.is_absolute():
        resolved = path.expanduser().resolve(strict=False)
    else:
        resolved = (cwd / text).resolve(strict=False)
    _require_inside_project(resolved, root, what="exec")
    return text.replace("\\", "/") if not path.is_absolute() else str(resolved)


def _runner_cwd(root: Path, profile: RunProfile) -> Path:
    text = profile.cwd.strip()
    if "\x00" in text:
        raise ValueError(f"Run profile '{profile.profile_id}' cwd contains NUL")
    if not text:
        return root
    path = Path(text)
    resolved = (
        path.expanduser().resolve(strict=False)
        if path.is_absolute()
        else (root / text).resolve(strict=False)
    )
    _require_inside_project(resolved, root, what="cwd")
    if not resolved.exists():
        raise ValueError(f"Run profile '{profile.profile_id}' cwd does not exist: {text}")
    if not resolved.is_dir():
        raise ValueError(f"Run profile '{profile.profile_id}' cwd is not a directory: {text}")
    return resolved


def _require_inside_project(path: Path, root: Path, *, what: str) -> None:
    try:
        path.relative_to(root.resolve(strict=False))
    except ValueError:
        raise ValueError(f"Run profile {what} must be inside the active project") from None


def _exec_text(profile: RunProfile) -> str:
    text = profile.exec_command.strip()
    if not text:
        raise ValueError(f"Run profile '{profile.profile_id}' must define exec")
    if "\x00" in text:
        raise ValueError(f"Run profile '{profile.profile_id}' exec contains NUL")
    return text


def _command_payload_b64(*, argv: list[str], env: dict[str, str]) -> str:
    raw = json.dumps({"argv": argv, "env": env}, separators=(",", ":"))
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def _label(project_root: str, profile_id: str) -> str:
    return f"runner-profile:{APP_ID}:{_project_hash(project_root)}:{_hash_text(profile_id)}"


def _project_hash(project_root: str) -> str:
    return _hash_text(project_root)


def _hash_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]


def _is_running(record: ShellRecord | None) -> bool:
    return bool(record and record.status == "running" and record.pid)
