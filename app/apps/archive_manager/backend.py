from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from collections.abc import Callable
from typing import Protocol, Self, TypeVar, cast
from urllib.parse import quote
from urllib.parse import urlencode
from urllib import request as urllib_request

import msgspec
from starlette.exceptions import HTTPException

from app.libs.archiver_service import browse_archive
from app.libs.app_jobs import AppJobs
from app.libs import archive_operations  # Registers neutral archive handlers.
from app.utils.paths import _resolve_user_path

APP_ID = str(os.environ.get("TE_APP_ID") or "archive_manager").strip() or "archive_manager"
JsonObject = dict[str, object]
JOBS = AppJobs('archive_manager', frozenset({'extract_archive', 'create_archive', 'test_archive'}))


class _ReadableHttpResponse(Protocol):
    def __enter__(self) -> Self: ...
    def __exit__(self, exc_type: type[BaseException] | None, exc_value: BaseException | None, traceback: object | None) -> None: ...
    def read(self) -> bytes: ...


class LaunchArchiveRequest(msgspec.Struct, kw_only=True):
    archive_path: str = ""
    internal: str | None = None
    filesystem_path: str | None = None
    destination: str | None = None
    show_hidden: bool = False


class ExtractArchiveRequest(msgspec.Struct, kw_only=True):
    archive_path: str = ""
    items: list[str] | None = None
    destination: str | None = None
    options: JsonObject | None = None


RequestT = TypeVar("RequestT", bound=msgspec.Struct)


def _request(payload: JsonObject, shape: type[RequestT]) -> RequestT:
    try:
        return msgspec.convert(payload, type=shape, strict=False)
    except msgspec.ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc


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
    response = cast(_ReadableHttpResponse, urllib_request.urlopen(req, timeout=5))
    with response as resp:
        _ = resp.read()


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

def ping() -> JsonObject:
    return {"ok": True, "data": {"message": "archive-manager ready"}}


def _looks_like_archive(path: Path) -> bool:
    lower = path.name.lower()
    return any(lower.endswith(ext) for ext in {".7z", ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar"})

def _list_directory_entries(path: Path, show_hidden: bool) -> list[JsonObject]:
    entries: list[JsonObject] = []
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
            item: JsonObject = {
                "id": str(entry_path),
                "name": name,
                "type": "directory" if is_dir else "file",
                "path": str(entry_path),
                "size": None if (stat is None or is_dir) else stat.st_size,
                "modified": stat.st_mtime if stat else None,
                "is_archive": (not is_dir) and _looks_like_archive(entry_path),
            }
            entries.append(item)
    entries.sort(key=lambda item: (item["type"] != "directory", cast(str, item["name"]).lower()))
    return entries

def browse(
    path: str = "~",
    internal: str = "",
    hidden: bool = False,
    archive: bool = False,
) -> JsonObject:
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
        # Existing archive service is a separately owned legacy boundary. Admit
        # its known JSON records without leaking its Any annotations downstream.
        archive_browser = cast(Callable[[Path, str, bool], list[JsonObject]], browse_archive)
        entries = archive_browser(target_path, internal, show_hidden)
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


def launch_archive(payload: JsonObject) -> JsonObject:
    request = _request(payload, LaunchArchiveRequest)
    raw_archive_path = request.archive_path
    internal = (request.internal or "").strip('/')
    filesystem_path_raw = request.filesystem_path
    destination_raw = request.destination
    show_hidden = request.show_hidden

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

def extract_archive(payload: JsonObject) -> JsonObject:
    request = _request(payload, ExtractArchiveRequest)
    raw_archive_path = request.archive_path
    items = request.items or []
    destination_raw = request.destination
    options = request.options or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        raise HTTPException(status_code=400, detail="archive_path is required")

    return {'ok': True, 'data': JOBS.create('extract_archive', {
                "archive_path": raw_archive_path,
                "items": items,
                "destination": destination_raw,
                "options": options,
            })}


def create_archive(payload: JsonObject) -> JsonObject:
    params = archive_operations.create_params(payload)
    return {'ok': True, 'data': JOBS.create('create_archive', params)}


def test_archive(payload: JsonObject) -> JsonObject:
    params = archive_operations.test_params(payload)
    return {'ok': True, 'data': JOBS.create('test_archive', params)}


from .http_app import ArchiveManagerASGI

TE2_ASGI_APP = ArchiveManagerASGI()

