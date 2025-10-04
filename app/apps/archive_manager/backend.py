from __future__ import annotations

import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request

from app.jobs import register_job_handler

archive_manager_bp = Blueprint("archive_manager_app", __name__)

HOME_DIR = Path(os.path.expanduser("~")).resolve()
DEFAULT_TIMEOUT = 120
ARCHIVE_EXTENSIONS = {
    ".7z",
    ".zip",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tbz2",
    ".tar.xz",
    ".txz",
    ".rar",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _json_err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": str(message)}), status


def _looks_like_archive(path: Path) -> bool:
    lower = path.name.lower()
    return any(lower.endswith(ext) for ext in ARCHIVE_EXTENSIONS)


def _format_timestamp(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts).isoformat()
    except Exception:
        return None


def _resolve_user_path(raw: Optional[str], *, must_exist: bool = True) -> Path:
    if not raw:
        raw = "~"
    expanded = os.path.expanduser(raw)
    candidate = Path(expanded)
    try:
        resolved = candidate.resolve(strict=False)
    except Exception:
        resolved = candidate.absolute()
    if not str(resolved).startswith(str(HOME_DIR)):
        raise PermissionError(f"Access denied: {raw}")
    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path not found: {resolved}")
    return resolved


def _list_directory_entries(path: Path, show_hidden: bool) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
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
                "modified": _format_timestamp(stat.st_mtime) if stat else None,
                "is_archive": (not is_dir) and _looks_like_archive(entry_path),
            }
            entries.append(item)
    entries.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return entries


def _parse_7zz_slt(output: str) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    current: Dict[str, str] = {}
    seen_path = False

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                records.append(current)
                current = {}
                seen_path = False
            continue
        if line.startswith("EVENT"):
            # Skip progress events printed when -bb or similar is enabled
            continue
        if line.startswith("Path = "):
            if current and seen_path:
                records.append(current)
                current = {}
            seen_path = True
        if " = " in line:
            key, value = line.split(" = ", 1)
            current[key.strip()] = value.strip()
    if current:
        records.append(current)
    return records


def _list_archive_children(records: Iterable[Dict[str, str]], internal: str, show_hidden: bool,
                            archive_path: Path) -> List[Dict[str, Any]]:
    internal_parts = [p for p in internal.split('/') if p]
    children: Dict[str, Dict[str, Any]] = {}

    for record in records:
        entry_path = record.get("Path", "").strip()
        if not entry_path:
            continue
        if entry_path == archive_path.name and "Folder" not in record and "Size" not in record:
            # Skip the archive summary record
            continue
        normalized = entry_path.replace('\\', '/').strip('/')
        parts = [p for p in normalized.split('/') if p]
        if internal_parts:
            if parts[:len(internal_parts)] != internal_parts:
                continue
            relative_parts = parts[len(internal_parts):]
        else:
            relative_parts = parts
        if not relative_parts:
            # This is the directory represented by `internal`; ignore
            continue
        top_segment = relative_parts[0]
        if not show_hidden and top_segment.startswith('.'):
            continue
        is_dir_flag = record.get("Folder", "").strip().lower() in {"+", "yes", "true", "1"}
        # If there are deeper elements beneath the first segment, treat as directory
        is_directory = is_dir_flag or len(relative_parts) > 1
        relative_internal = '/'.join((*internal_parts, top_segment))
        child = children.get(top_segment)
        if child is None:
            child = {
                "id": f"{archive_path}::{relative_internal}",
                "name": top_segment,
                "type": "directory" if is_directory else "file",
                "path": str(archive_path),
                "internal": relative_internal,
                "size": None,
                "packed_size": None,
                "modified": None,
            }
            children[top_segment] = child
        if is_directory and child["type"] != "directory":
            child["type"] = "directory"
            child["size"] = None
            child["packed_size"] = None
        if child["type"] == "file":
            size_value = record.get("Size")
            packed_value = record.get("Packed Size")
            modified_value = record.get("Modified")
            try:
                child["size"] = int(size_value) if size_value else None
            except ValueError:
                child["size"] = None
            try:
                child["packed_size"] = int(packed_value) if packed_value else None
            except ValueError:
                child["packed_size"] = None
            if modified_value:
                child["modified"] = modified_value.replace(' ', 'T')
        else:
            # For directories, prefer an explicit Modified timestamp if 7zz provides one
            modified_value = record.get("Modified")
            if modified_value and not child.get("modified"):
                child["modified"] = modified_value.replace(' ', 'T')
    results = list(children.values())
    results.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return results


def _run_7zz(args: Iterable[str], *, cwd: Optional[Path] = None) -> subprocess.CompletedProcess[str]:
    cmd = ["7zz", *args]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(cwd) if cwd else None,
            timeout=DEFAULT_TIMEOUT,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("7zz executable not found. Install the p7zip package on Termux.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("7zz command timed out.") from exc
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"7zz exited with code {result.returncode}"
        raise RuntimeError(message)
    return result


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@archive_manager_bp.route("/ping")
def ping():
    return _json_ok({"message": "archive-manager ready"})


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
        result = _run_7zz(["l", "-slt", "-ba", str(target_path)])
    except RuntimeError as exc:
        return _json_err(str(exc), 500)

    records = _parse_7zz_slt(result.stdout)
    entries = _list_archive_children(records, internal, show_hidden, target_path)
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


def _build_create_command(archive_path: Path, sources: List[Path], options: Dict[str, Any]) -> List[str]:
    cmd: List[str] = ["a"]
    archive_format = options.get("format")
    if archive_format:
        archive_format = str(archive_format).strip()
        if archive_format:
            cmd.append(f"-t{archive_format}")
    compression_level = options.get("compression_level")
    if compression_level is not None:
        try:
            level = int(compression_level)
            level = max(0, min(level, 9))
            cmd.append(f"-mx={level}")
        except (TypeError, ValueError):
            pass
    if options.get("solid") is False:
        cmd.append("-ms=off")
    password = options.get("password")
    if isinstance(password, str) and password:
        cmd.append(f"-p{password}")
        if options.get("encrypt_headers"):
            cmd.append("-mhe=on")
    cmd.append(str(archive_path))
    cmd.extend(str(path) for path in sources)
    return cmd


@archive_manager_bp.route("/archives/create", methods=["POST"])
def create_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    raw_sources = payload.get("sources") or []
    options = payload.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)
    if not isinstance(raw_sources, list) or not raw_sources:
        return _json_err("At least one source path is required", 400)

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=False)
        archive_path.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    sources: List[Path] = []
    for raw_source in raw_sources:
        if not isinstance(raw_source, str) or not raw_source.strip():
            return _json_err("Invalid source entry", 400)
        try:
            source_path = _resolve_user_path(raw_source, must_exist=True)
        except FileNotFoundError as exc:
            return _json_err(str(exc), 404)
        except PermissionError as exc:
            return _json_err(str(exc), 403)
        sources.append(source_path)

    try:
        cmd = _build_create_command(archive_path, sources, options)
        result = _run_7zz(cmd, cwd=archive_path.parent)
    except RuntimeError as exc:
        return _json_err(str(exc), 500)

    return _json_ok(
        {
            "archive_path": str(archive_path),
            "stdout": result.stdout,
            "stderr": result.stderr,
        },
        status=201,
    )


def _build_extract_command(
    archive_path: Path,
    items: List[str],
    destination: Path,
    options: Dict[str, Any],
) -> List[str]:
    cmd: List[str] = ["x", str(archive_path)]
    overwrite_policy = (options or {}).get("overwrite")
    if overwrite_policy == "overwrite":
        cmd.append("-aoa")
    elif overwrite_policy == "skip":
        cmd.append("-aos")
    elif overwrite_policy == "rename":
        cmd.append("-aou")
    password = options.get("password")
    if isinstance(password, str) and password:
        cmd.append(f"-p{password}")
    if items:
        cmd.extend(items)
    cmd.append(f"-o{destination}")
    if options.get("preserve_paths") is False:
        cmd[0] = "e"  # switch to extract without paths
    return cmd


@archive_manager_bp.route("/archives/extract", methods=["POST"])
def extract_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    items = payload.get("items") or []
    destination_raw = payload.get("destination")
    options = payload.get("options") or {}
    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)
    if destination_raw and not isinstance(destination_raw, str):
        return _json_err("destination must be a string", 400)
    if items and not isinstance(items, list):
        return _json_err("items must be a list of archive-relative paths", 400)

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    except FileNotFoundError as exc:
        return _json_err(str(exc), 404)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    try:
        destination = _resolve_user_path(destination_raw or str(archive_path.parent), must_exist=False)
        destination.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    normalized_items: List[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            return _json_err("Invalid item entry", 400)
        normalized_items.append(item.strip().lstrip('/'))

    try:
        cmd = _build_extract_command(archive_path, normalized_items, destination, options)
        result = _run_7zz(cmd, cwd=archive_path.parent)
    except RuntimeError as exc:
        return _json_err(str(exc), 500)

    return _json_ok(
        {
            "archive_path": str(archive_path),
            "destination": str(destination),
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    )




@archive_manager_bp.route("/archives/expand", methods=["POST"])
def expand_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    destination_raw = payload.get("destination")
    options = payload.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)
    if not isinstance(destination_raw, str) or not destination_raw.strip():
        return _json_err("destination is required", 400)

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    except FileNotFoundError as exc:
        return _json_err(str(exc), 404)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    try:
        destination = _resolve_user_path(destination_raw, must_exist=False)
        destination.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    try:
        cmd = _build_extract_command(archive_path, [], destination, options)
        result = _run_7zz(cmd, cwd=archive_path.parent)
    except RuntimeError as exc:
        return _json_err(str(exc), 500)

    return _json_ok({
        "archive_path": str(archive_path),
        "destination": str(destination),
        "stdout": result.stdout,
        "stderr": result.stderr,
    })


@register_job_handler("extract_archive")
def job_extract_archive(ctx, params):
    """Background job handler for archive extraction."""
    raw_archive_path = params.get("archive_path")
    items = params.get("items") or []
    destination_raw = params.get("destination")
    options = params.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        raise ValueError("archive_path is required")
    if destination_raw and not isinstance(destination_raw, str):
        raise ValueError("destination must be a string")
    if items and not isinstance(items, list):
        raise ValueError("items must be a list")

    archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    destination = _resolve_user_path(destination_raw or str(archive_path.parent), must_exist=False)
    destination.mkdir(parents=True, exist_ok=True)

    normalized_items: List[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("Invalid item entry")
        normalized_items.append(item.strip().lstrip('/'))

    ctx.set_message(f"Extracting {archive_path.name}…")
    cmd = _build_extract_command(archive_path, normalized_items, destination, options)
    result = _run_7zz(cmd, cwd=archive_path.parent)

    truncated_stdout = result.stdout if len(result.stdout) <= 2000 else result.stdout[:2000] + "…"
    truncated_stderr = result.stderr if len(result.stderr) <= 2000 else result.stderr[:2000] + "…"

    ctx.finish(
        message=f"Extracted to {destination}",
        result={
            "archive_path": str(archive_path),
            "destination": str(destination),
            "stdout": truncated_stdout,
            "stderr": truncated_stderr,
        },
    )


@archive_manager_bp.route("/archives/test", methods=["POST"])
def test_archive():
    payload = request.get_json(silent=True) or {}
    raw_archive_path = payload.get("archive_path")
    options = payload.get("options") or {}

    if not isinstance(raw_archive_path, str) or not raw_archive_path.strip():
        return _json_err("archive_path is required", 400)

    try:
        archive_path = _resolve_user_path(raw_archive_path, must_exist=True)
    except FileNotFoundError as exc:
        return _json_err(str(exc), 404)
    except PermissionError as exc:
        return _json_err(str(exc), 403)

    cmd: List[str] = ["t", str(archive_path)]
    password = options.get("password")
    if isinstance(password, str) and password:
        cmd.append(f"-p{password}")

    try:
        result = _run_7zz(cmd, cwd=archive_path.parent)
    except RuntimeError as exc:
        return _json_err(str(exc), 500)

    return _json_ok(
        {
            "archive_path": str(archive_path),
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    )
