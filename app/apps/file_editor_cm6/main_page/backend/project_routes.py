# pyright: strict, reportUnusedFunction=false
from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Protocol

from fastapi import APIRouter, Body, HTTPException

from .state_payload import JsonObject


class HistoryStoreLike(Protocol):
    def touch_project(self, path: str) -> None: ...

    def set_active_project(self, path: str) -> None: ...

    def get_active_project(self) -> str | None: ...


@dataclass(frozen=True, slots=True)
class ProjectRoutesDeps:
    history: HistoryStoreLike
    get_project_root: Callable[[], Path]
    set_project_root: Callable[[str], Path]
    invalidate_diff_cache: Callable[[Path], None]
    set_edit_tracker_project_root: Callable[[Path], None]
    close_active_terminal_sockets: Callable[[], Awaitable[None]]
    stop_diagnostics_bridge: Callable[[], None]
    terminate_adapter_shell: Callable[[], Awaitable[bool]]
    clear_change_ledger: Callable[[], None]
    emit_sidebar_cwd_set: Callable[[str], Awaitable[None]]
    build_state_payload: Callable[[], JsonObject]
    create_project: Callable[[str, str], JsonObject]


async def _ignore_async_errors(fn: Callable[[], Awaitable[object]]) -> None:
    try:
        await fn()
    except Exception:
        pass


def _ignore_sync_errors(fn: Callable[[], object]) -> None:
    try:
        fn()
    except Exception:
        pass


def _payload_string(payload: JsonObject, key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


async def _after_project_switch(deps: ProjectRoutesDeps, *, reason: str) -> None:
    await _ignore_async_errors(deps.close_active_terminal_sockets)
    _ignore_sync_errors(deps.stop_diagnostics_bridge)
    await _ignore_async_errors(deps.terminate_adapter_shell)
    _ignore_sync_errors(deps.clear_change_ledger)
    await _ignore_async_errors(lambda: deps.emit_sidebar_cwd_set(reason))


def create_project_router(deps: ProjectRoutesDeps) -> APIRouter:
    router = APIRouter()

    @router.post("/project/open", response_model=None)
    async def project_open(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Open a project directory."""
        path = _payload_string(data, "path") or ""

        try:
            display_path = os.path.abspath(os.path.expanduser(path))
            abs_path = deps.set_project_root(path)
            deps.history.touch_project(display_path)
            deps.history.set_active_project(display_path)
            deps.invalidate_diff_cache(abs_path)
            deps.set_edit_tracker_project_root(abs_path)
            await _after_project_switch(deps, reason="project_open")
            state = deps.build_state_payload()
            return {"ok": True, "data": {"path": str(abs_path), "state": state}}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/project/create", response_model=None)
    async def project_create(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Create a new project directory."""
        parent_path = _payload_string(data, "parent_path")
        name = _payload_string(data, "name")
        if not parent_path or not name:
            raise HTTPException(status_code=400, detail="parent_path and name are required")

        try:
            result = deps.create_project(parent_path, name)
            new_project_path_raw = result.get("path")
            if not isinstance(new_project_path_raw, str):
                raise ValueError("create_project returned invalid path")
            new_project_path = new_project_path_raw
            deps.history.touch_project(new_project_path)
            deps.history.set_active_project(new_project_path)
            await _after_project_switch(deps, reason="project_create")
            return {"ok": True, "data": result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/project/current", response_model=None)
    def project_current() -> JsonObject:
        """Get the current project root."""
        root = deps.history.get_active_project() or str(deps.get_project_root())
        return {"ok": True, "data": {"path": str(root)}}

    return router
