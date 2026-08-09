# pyright: strict
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
from importlib import import_module
from pathlib import Path
from typing import Awaitable, Protocol, cast

# Page Preview is a framework-shell service, not a terminal command. The manager
# reuses the fixed-port shell when alive and keeps launch details out of UI code.
JsonObject = dict[str, object]

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "page_preview.yaml#page-preview"
SERVER_ENTRYPOINT = Path(__file__).parent / "page_preview" / "server.cjs"
DEFAULT_PORT = 3000

_spawn_locks: dict[str, asyncio.Lock] = {}


class ShellRecord(Protocol):
    id: str
    label: str | None
    pid: int | None
    status: str


class ShellManager(Protocol):
    def get_shell(self, shell_id: str) -> Awaitable[ShellRecord | None]: ...

    def find_shell_by_label(
        self, label: str, *, status: str | None = None
    ) -> Awaitable[ShellRecord | None]: ...

    def list_shells(self) -> Awaitable[list[ShellRecord]]: ...

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
class PagePreviewShell:
    shell_id: str
    label: str
    url: str
    reused: bool


@dataclass(frozen=True)
class PagePreviewShellState:
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


async def ensure_page_preview_shell(
    *,
    project_root: str,
    profile_id: str,
    entry: str,
    port: int = DEFAULT_PORT,
) -> PagePreviewShell:
    root = str(Path(project_root).expanduser().resolve(strict=False))
    label = _label(root, profile_id)
    lock = _spawn_locks.setdefault(label, asyncio.Lock())
    async with lock:
        mgr = await _framework_get_manager()()
        existing = await mgr.find_shell_by_label(label, status="running")
        if existing is not None and _is_running(existing):
            return PagePreviewShell(
                shell_id=existing.id,
                label=label,
                url=_url(port),
                reused=True,
            )

        conflict = await _find_preview_port_conflict(mgr, label)
        if conflict is not None:
            conflict_label = conflict.label or conflict.id
            raise RuntimeError(
                f"Page Preview already has a running port {port} shell: {conflict_label}"
            )

        orch = _orchestrator_factory()(mgr)
        shell = await orch.start_from_ref(
            SHELLSPEC_REF,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "PROJECT_ROOT": root,
                "PROJECT_HASH": _project_hash(root),
                "PROFILE_ID": profile_id,
                "PROFILE_HASH": _hash_text(profile_id),
                "PAGE_PREVIEW_ENTRYPOINT": str(SERVER_ENTRYPOINT),
                "PAGE_PREVIEW_ENTRY": entry,
                "PAGE_PREVIEW_PORT": str(port),
            },
            label=label,
            record_spec_id=f"service:{APP_ID}:page-preview",
            wait_ready=True,
        )
        return PagePreviewShell(shell_id=shell.id, label=label, url=_url(port), reused=False)


async def page_preview_shell_state(
    *, project_root: str, profile_id: str
) -> PagePreviewShellState:
    root = str(Path(project_root).expanduser().resolve(strict=False))
    label = _label(root, profile_id)
    mgr = await _framework_get_manager()()
    shell = await mgr.find_shell_by_label(label, status="running")
    return PagePreviewShellState(
        shell_id=shell.id if _is_running(shell) else "",
        label=label,
        running=_is_running(shell),
    )


async def stop_page_preview_shell(
    *, project_root: str, profile_id: str
) -> PagePreviewShellState:
    root = str(Path(project_root).expanduser().resolve(strict=False))
    label = _label(root, profile_id)
    lock = _spawn_locks.setdefault(label, asyncio.Lock())
    async with lock:
        mgr = await _framework_get_manager()()
        shell = await mgr.find_shell_by_label(label, status="running")
        if not _is_running(shell):
            return PagePreviewShellState(shell_id="", label=label, running=False)
        shell_id = shell.id
        await mgr.terminate_shell(shell_id, force=True)
        return PagePreviewShellState(shell_id=shell_id, label=label, running=False)


async def _find_preview_port_conflict(
    mgr: ShellManager,
    current_label: str,
) -> ShellRecord | None:
    for record in await mgr.list_shells():
        if not _is_running(record):
            continue
        label = record.label or ""
        if label == current_label:
            continue
        if label.startswith(f"page-preview:{APP_ID}:"):
            return record
    return None


def _label(project_root: str, profile_id: str) -> str:
    return f"page-preview:{APP_ID}:{_project_hash(project_root)}:{_hash_text(profile_id)}"


def _project_hash(project_root: str) -> str:
    return _hash_text(project_root)


def _hash_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]


def _url(port: int) -> str:
    return f"http://127.0.0.1:{port}/"


def _is_running(record: ShellRecord | None) -> bool:
    return bool(record and record.status == "running" and record.pid)
