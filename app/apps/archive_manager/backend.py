from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, List, Optional
from urllib.parse import quote
from urllib.parse import urlencode
from urllib import request as urllib_request

from fastapi import APIRouter, HTTPException, Body, Query
from fastapi.responses import JSONResponse

from app.libs.archiver_service import browse_archive
from app.libs.jobs import manager as job_manager
from app.utils.paths import _resolve_user_path

archive_manager_bp = APIRouter()
APP_ID = str(os.environ.get("TE_APP_ID") or "archive_manager").strip() or "archive_manager"


def _framework_url() -> str:
    explicit = str(os.environ.get("TE_FRAMEWORK_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    port = str(os.environ.get("TE_PORT") or "8089").strip() or "8089"
    return f"http://127.0.0.1:{port}"


def _post_serving_readiness() -> None:
    body = {
        "app_id": APP_ID,
        "status": "ready",
        "phase": "serving",
        "source": "archive_manager_backend",
    }
    endpoint = f"{_framework_url()}/api/apps/{quote(APP_ID, safe='')}/readiness"
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=5) as resp:
        resp.read()


async def te2_app_backend_serving() -> None:
    try:
        await asyncio.to_thread(_post_serving_readiness)
    except Exception as exc:
        print(f"[archive_manager] readiness post failed: {exc}", flush=True)


# ---------------------------------------------------------------------------'''
# Helpers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@archive_manager_bp.get("/ping")
def ping():
    return {"ok": True, "data": {"message": "archive-manager ready"}}


def _looks_like_archive(path: Path) -> bool:
    lower = path.name.lower()
    return any(lower.endswith(ext) for ext in {".7z", ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar"})

def _list_directory_entries(path: Path, show_hidden: bool) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    try:
        iterator = os.scandir(path)
    except PermissionError as exc:
        raise PermissionError(f"Access denied: {path}") from exc
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Directory not found: {path}") from exc

    with iterator as handle:
        for entry in handle:
            name = entry.name
            if not show_hidden and name.startswith('.'):
                continue
            entry_path = Path(entry.path)
            try:
                stat = entry.stat(follow_symlinks=False)
            except Exception:
                stat = None
            is_dir = entry.is_dir(follow_symlinks=False)
            item = {
                "id": str(entry_path),
                "name": name,
                "type": "directory" if is_dir else "file",
                "path": str(entry_path),
                "size": None if (stat is None or is_dir) else stat.st_size,
                "modified": stat.st_mtime if stat else None,
                "is_archive": (not is_dir) and _looks_like_archive(entry_path),
            }
            entries.append(item)
    entries.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return entries

@archive_manager_bp.get("/browse")
def browse(
    path: str = Query("~"),
    internal: str = Query(""),
    hidden: bool = Query(False),
    archive: bool = Query(False),
):
    raw_path = path
    internal = (internal or "").strip('/')
    show_hidden = hidden
    forced_archive = archive

    try:
        target_path = _resolve_user_path(raw_path, must_exist=True)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if target_path.is_dir() and not forced_archive:
        try:
            entries = _list_directory_entries(target_path, show_hidden)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        payload = {
            "mode": "filesystem",
            "path": str(target_path),
            "entries": entries,
            "show_hidden": show_hidden,
        }
        return {"ok": True, "data": payload}

    # Archive mode
    if not target_path.is_file() and not forced_archive:
        raise HTTPException(status_code=400, detail="Target is neither a directory nor a readable archive.")

    if not _looks_like_archive(target_path) and not forced_archive:
        raise HTTPException(status_code=400, detail="Unsupported archive type.")

    try:
        entries = browse_archive(target_path, internal, show_hidden)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to browse archive: {exc}")

    payload = {
        "mode": "archive",
        "archive_path": str(target_path),
        "internal": internal,
        "entries": entries,
        "show_hidden": show_hidden,
    }
    return {"ok": True, "data": payload}


@archive_manager_bp.post("/archives/launch")
def launch_archive(payload: dict = Body(...)):
    raw_archive_path = payload.get("archive_path")
    internal = (payload.get("internal") or "").strip('/')
    filesystem_path_raw = payload.get("filesystem_path")
    destination_raw = payload.get("destination")
    show_hidden = bool(payload.get("show_hidden"))

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        raise HTTPException(status_code=400, detail="archive_path is required")

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    params = {"archive": str(archive_path)}
    if internal:
        params["internal"] = internal

    if filesystem_path_raw:
        try:
            fs_path = _resolve_user_path(filesystem_path_raw, must_exist=True)
            params["path"] = str(fs_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
    if destination_raw:
        try:
            dest_path = _resolve_user_path(destination_raw, must_exist=False)
            params["destination"] = str(dest_path)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
    if show_hidden:
        params["hidden"] = '1'

    app_url = '/app/archive_manager'
    if params:
        app_url = f"{app_url}?{urlencode(params)}"

    return {"ok": True, "data": {
        "archive_path": str(archive_path),
        "app_url": app_url,
    }}

@archive_manager_bp.post("/archives/extract")
def extract_archive(payload: dict = Body(...)):
    raw_archive_path = payload.get("archive_path")
    items = payload.get("items") or []
    destination_raw = payload.get("destination")
    options = payload.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        raise HTTPException(status_code=400, detail="archive_path is required")

    try:
        job = job_manager.create_job(
            type="extract_archive",
            params={
                "archive_path": raw_archive_path,
                "items": items,
                "destination": destination_raw,
                "options": options,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create extraction job: {exc}")

    return {"ok": True, "data": job.to_public_dict()}

