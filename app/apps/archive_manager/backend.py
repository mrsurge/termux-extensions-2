from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request

from app.libs.archiver_service import browse_archive
from app.libs.jobs import manager as job_manager
from app.utils.paths import _resolve_user_path

archive_manager_bp = Blueprint("archive_manager_app", __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _json_err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": str(message)}), status


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@archive_manager_bp.route("/ping")
def ping():
    return _json_ok({"message": "archive-manager ready"})


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

@archive_manager_bp.route("/browse", methods=["GET"])
def browse():
    raw_path = request.args.get("path", "~")
    internal = (request.args.get("internal", "") or "").strip('/')
    show_hidden = request.args.get("hidden", "false").lower() in {"1", "true", "yes", "on"}
    forced_archive = request.args.get("archive", "false").lower() in {"1", "true", "yes", "on"}

    try:
        target_path = _resolve_user_path(raw_path, must_exist=True)
    except PermissionError as exc:
        return _json_err(str(exc), 403)
    except FileNotFoundError as exc:
        return _json_err(str(exc), 404)

    if target_path.is_dir() and not forced_archive:
        try:
            entries = _list_directory_entries(target_path, show_hidden)
        except PermissionError as exc:
            return _json_err(str(exc), 403)
        except FileNotFoundError as exc:
            return _json_err(str(exc), 404)
        payload = {
            "mode": "filesystem",
            "path": str(target_path),
            "entries": entries,
            "show_hidden": show_hidden,
        }
        return _json_ok(payload)

    # Archive mode
    if not target_path.is_file() and not forced_archive:
        return _json_err("Target is neither a directory nor a readable archive.", 400)

    if not _looks_like_archive(target_path) and not forced_archive:
        return _json_err("Unsupported archive type.", 400)

    try:
        entries = browse_archive(target_path, internal, show_hidden)
    except Exception as exc:
        return _json_err(f"Failed to browse archive: {exc}", 500)

    payload = {
        "mode": "archive",
        "archive_path": str(target_path),
        "internal": internal,
        "entries": entries,
        "show_hidden": show_hidden,
    }
    return _json_ok(payload)


@archive_manager_bp.route("/archives/launch", methods=["POST"])
def launch_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    internal = (payload.get("internal") or "").strip('/')
    filesystem_path_raw = payload.get("filesystem_path")
    destination_raw = payload.get("destination")
    show_hidden = bool(payload.get("show_hidden"))

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    except FileNotFoundError as exc:
        return _json_err(str(exc), 404)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    params = {"archive": str(archive_path)}
    if internal:
        params["internal"] = internal

    if filesystem_path_raw:
        try:
            fs_path = _resolve_user_path(filesystem_path_raw, must_exist=True)
            params["path"] = str(fs_path)
        except FileNotFoundError as exc:
            return _json_err(str(exc), 404)
        except PermissionError as exc:
            return _json_err(str(exc), 403)
    if destination_raw:
        try:
            dest_path = _resolve_user_path(destination_raw, must_exist=False)
            params["destination"] = str(dest_path)
        except PermissionError as exc:
            return _json_err(str(exc), 403)
    if show_hidden:
        params["hidden"] = '1'

    app_url = '/app/archive_manager'
    if params:
        app_url = f"{app_url}?{urlencode(params)}"

    return _json_ok({
        "archive_path": str(archive_path),
        "app_url": app_url,
    })

@archive_manager_bp.route("/archives/extract", methods=["POST"])
def extract_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    items = payload.get("items") or []
    destination_raw = payload.get("destination")
    options = payload.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)

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
        return _json_err(f"Failed to create extraction job: {exc}", 500)

    return _json_ok(job.to_public_dict())



