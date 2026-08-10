# pyright: strict, reportUnusedFunction=false
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, HTTPException

from .state_payload import JsonObject
from .project_service import (
    ProjectServiceDeps as ProjectRoutesDeps,
    create_project_from_parent_name,
    open_project,
    payload_string,
)


def create_project_router(deps: ProjectRoutesDeps) -> APIRouter:
    router = APIRouter()

    @router.post("/project/open", response_model=None)
    async def project_open(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Open a project directory."""
        path = payload_string(data, "path") or ""

        try:
            file_target = (
                payload_string(data, "file")
                or payload_string(data, "file_path")
                or payload_string(data, "fileTarget")
                or payload_string(data, "targetFile")
            )
            result = await open_project(
                deps,
                path,
                require_known_sidecar=False,
                reason="project_open",
                file_target=file_target,
            )
            if result.get("ok") is not True:
                raise ValueError(str(result.get("reason") or "project open failed"))
            return {
                "ok": True,
                "data": {
                    "path": str(result.get("resolved_path") or result.get("path") or ""),
                    "state": result.get("state") if isinstance(result.get("state"), dict) else {},
                },
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/project/create", response_model=None)
    async def project_create(data: Annotated[JsonObject, Body(...)]) -> JsonObject:
        """Create a new project directory."""
        parent_path = payload_string(data, "parent_path")
        name = payload_string(data, "name")
        if not parent_path or not name:
            raise HTTPException(status_code=400, detail="parent_path and name are required")

        try:
            result = await create_project_from_parent_name(
                deps,
                parent_path=parent_path,
                name=name,
                open_after=True,
            )
            return {"ok": True, "data": result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/project/current", response_model=None)
    def project_current() -> JsonObject:
        """Get the current project root."""
        root = deps.history.get_active_project() or str(deps.get_project_root())
        return {"ok": True, "data": {"path": str(root)}}

    return router
