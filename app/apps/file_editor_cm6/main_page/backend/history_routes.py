# pyright: strict, reportUnusedFunction=false
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Protocol

from fastapi import APIRouter, Body, HTTPException, Query

from .state_payload import JsonObject


class ProjectSidecarLike(Protocol):
    @property
    def session_count(self) -> int: ...

    @property
    def last_boot_at(self) -> str | None: ...

    def get_draft_count(self) -> int: ...

    def clear_session_cache(self) -> None: ...

    def clear_tracked_jobs(self) -> None: ...

    def set_diff_base(self, ref: str | None) -> str: ...

    def save(self) -> None: ...

    def dump_raw(self) -> JsonObject: ...


class HistoryStoreLike(Protocol):
    def list_projects(self) -> list[JsonObject]: ...

    def get_active_project(self) -> str | None: ...

    def reset_project_history(self, project_path: str) -> bool: ...

    def remove_project(self, project_path: str) -> bool: ...

    def list_files(self, project_path: str) -> list[JsonObject]: ...

    def dump_raw(self) -> JsonObject: ...

    def record_file_activity(self, project_path: str, file_path: str) -> JsonObject: ...

    def remove_file(self, project_path: str, file_path: str) -> bool: ...

    def clear_all_files(self, project_path: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class HistoryRoutesDeps:
    history: HistoryStoreLike
    get_project_root: Callable[[], Path]
    format_label: Callable[[str | None], str]
    get_sidecar_path: Callable[[str], Path]
    load_sidecar: Callable[[str], ProjectSidecarLike]


def _payload_string(payload: JsonObject, key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _active_project_or_root(deps: HistoryRoutesDeps) -> str:
    return deps.history.get_active_project() or str(deps.get_project_root())


def _with_exists(entry: JsonObject) -> JsonObject:
    entry_path = entry.get("path")
    entry_path_str = entry_path if isinstance(entry_path, str) else None
    result = dict(entry)
    result["exists"] = bool(entry_path_str and Path(entry_path_str).is_file())
    return result


def create_history_router(deps: HistoryRoutesDeps) -> APIRouter:
    router = APIRouter()

    @router.get("/debug/projects", response_model=None)
    def debug_projects() -> JsonObject:
        """Return recent projects plus associated sidecar metadata."""
        try:
            projects = deps.history.list_projects()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to read recent projects: {exc}") from exc

        active_project = deps.history.get_active_project()

        results: list[JsonObject] = []
        for entry in projects:
            project_path = entry.get("path")
            project_path_str = project_path if isinstance(project_path, str) else None
            label = entry.get("label") or deps.format_label(project_path_str)
            opened_at = entry.get("opened_at")

            sidecar_path: str | None = None
            sidecar_exists = False
            session_count: int | None = None
            last_boot_at: str | None = None
            draft_count = 0

            if project_path_str:
                try:
                    sc_path = deps.get_sidecar_path(project_path_str)
                    sidecar_path = str(sc_path)
                    sidecar_exists = sc_path.exists()
                    if sidecar_exists:
                        sc = deps.load_sidecar(project_path_str)
                        session_count = sc.session_count
                        last_boot_at = sc.last_boot_at
                        draft_count = sc.get_draft_count()
                except Exception:
                    # Sidecar issues should not block listing history.
                    pass

            is_active = bool(
                project_path_str
                and active_project
                and str(project_path_str) == str(active_project)
            )

            results.append(
                {
                    "path": project_path_str,
                    "label": label,
                    "opened_at": opened_at,
                    "sidecar_path": sidecar_path,
                    "sidecar_exists": sidecar_exists,
                    "session_count": session_count,
                    "last_boot_at": last_boot_at,
                    "draft_count": draft_count,
                    "is_active": is_active,
                }
            )

        return {"ok": True, "data": results}

    @router.delete("/debug/projects", response_model=None)
    def debug_delete_project(payload: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Delete or reset a project entry from history and its sidecar."""
        project_path = _payload_string(payload, "path")
        if not project_path:
            raise HTTPException(status_code=400, detail="path is required")

        active_project = deps.history.get_active_project()
        is_active = bool(
            project_path
            and active_project
            and str(project_path) == str(active_project)
        )

        removed = False
        sidecar_deleted = False
        history_reset = False

        if is_active:
            try:
                history_reset = deps.history.reset_project_history(project_path)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to reset project history: {exc}") from exc

            try:
                sidecar = deps.load_sidecar(project_path)
                sidecar.clear_session_cache()
                sidecar.clear_tracked_jobs()
                sidecar.set_diff_base("HEAD")
                sidecar.save()
            except Exception:
                # Sidecar failures are non-fatal for debug tooling.
                pass
        else:
            try:
                removed = deps.history.remove_project(project_path)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to remove project: {exc}") from exc

            try:
                sc_path = deps.get_sidecar_path(project_path)
                if sc_path.exists():
                    sc_path.unlink()
                    sidecar_deleted = True
            except Exception:
                # Sidecar deletion failures are non-fatal for a debug endpoint.
                sidecar_deleted = False

        return {
            "ok": True,
            "data": {
                "removed": removed,
                "sidecar_deleted": sidecar_deleted,
                "history_reset": history_reset,
                "is_active": is_active,
            },
        }

    @router.get("/history/files", response_model=None)
    def get_recent_files() -> JsonObject:
        """Get recent files for the current project."""
        project_root = _active_project_or_root(deps)
        try:
            files_raw = deps.history.list_files(str(project_root))
            files = [_with_exists(entry) for entry in files_raw]
            return {"ok": True, "data": files}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/history/raw", response_model=None)
    def get_history_raw() -> JsonObject:
        """Return raw HistoryStore state."""
        try:
            return {"ok": True, "data": deps.history.dump_raw()}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/project/sidecar/raw", response_model=None)
    def get_project_sidecar_raw() -> JsonObject:
        """Return raw ProjectSidecar state for the active project."""
        project_root = _active_project_or_root(deps)
        try:
            sidecar = deps.load_sidecar(str(project_root))
            return {"ok": True, "data": sidecar.dump_raw()}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/debug/state/raw", response_model=None)
    def get_debug_state_raw() -> JsonObject:
        """Return raw history plus raw sidecar for the active project."""
        project_root = _active_project_or_root(deps)
        try:
            sidecar = deps.load_sidecar(str(project_root))
            return {
                "ok": True,
                "data": {
                    "history": deps.history.dump_raw(),
                    "sidecar": sidecar.dump_raw(),
                },
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/history/touch", response_model=None)
    async def touch_file_history(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Add a file to the recent files list."""
        path = _payload_string(data, "path")
        if not path:
            raise HTTPException(status_code=400, detail="Path is required")

        project_root = _active_project_or_root(deps)
        try:
            entry = deps.history.record_file_activity(str(project_root), path)
            return {"ok": True, "data": entry}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/history/file", response_model=None)
    def remove_file_history(path: str = Query(...)) -> JsonObject:
        """Remove a file from the recent files list."""
        project_root = _active_project_or_root(deps)
        try:
            removed = deps.history.remove_file(str(project_root), path)
            return {"ok": True, "data": {"removed": removed}}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/history/files/all", response_model=None)
    def clear_all_file_history() -> JsonObject:
        """Clear all recent files for the active project."""
        project_root = _active_project_or_root(deps)
        try:
            cleared = deps.history.clear_all_files(str(project_root))
            return {"ok": True, "data": {"cleared": cleared}}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
