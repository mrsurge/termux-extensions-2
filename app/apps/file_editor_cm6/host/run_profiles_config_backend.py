# pyright: strict
from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..runner_profiles import (
    DEFAULT_PAGE_PREVIEW_URL,
    load_run_profiles_config,
    run_profiles_config_path,
    save_run_profiles_config,
)
from ..stores import get_history_store


async def handle_host_run_profiles_get_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del data, source_name
    project_root = _active_project()
    if not project_root:
        return {"ok": False, "error": "No active project selected"}

    config_path = run_profiles_config_path(project_root)
    exists = config_path.exists()
    raw_json = _read_raw_json(config_path) if exists else _format_json(_empty_config())
    validation_error = ""
    config: JsonMap = _empty_config()
    try:
        config = load_run_profiles_config(project_root)
        raw_json = _format_json(config)
    except Exception as exc:
        validation_error = str(exc)

    return {
        "ok": True,
        "data": {
            "configPath": str(config_path),
            "exists": exists,
            "rawJson": raw_json,
            "profiles": _profiles(config),
            "validationError": validation_error,
            "profileContract": _run_profile_contract(),
        },
    }


async def handle_host_run_profiles_save_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    project_root = _active_project()
    if not project_root:
        return {"ok": False, "error": "No active project selected"}

    raw_json = data.get("rawJson")
    if not isinstance(raw_json, str):
        return {"ok": False, "error": "Run profile save requires rawJson"}

    try:
        config = save_run_profiles_config(project_root, raw_json)
    except Exception as exc:
        return {"ok": False, "error": f"Invalid run profile config: {exc}"}

    config_path = run_profiles_config_path(project_root)
    return {
        "ok": True,
        "data": {
            "configPath": str(config_path),
            "exists": True,
            "rawJson": _format_json(config),
            "profiles": _profiles(config),
            "validationError": "",
            "profileContract": _run_profile_contract(),
        },
    }


def _active_project() -> str | None:
    value = get_history_store().get_active_project()
    if not isinstance(value, str) or not value.strip():
        return None
    return str(Path(value).expanduser().resolve(strict=False))


def _read_raw_json(path: Path) -> str:
    try:
        return path.read_text("utf-8")
    except OSError:
        return ""


def _format_json(data: JsonMap) -> str:
    return json.dumps(data, indent=2, sort_keys=False) + "\n"


def _empty_config() -> JsonMap:
    profiles: list[object] = []
    return {"version": 1, "profiles": profiles}


def _profiles(config: JsonMap) -> list[object]:
    profiles = config.get("profiles")
    if not isinstance(profiles, list):
        return []
    normalized: list[object] = []
    for item_obj in cast(list[object], profiles):
        if not isinstance(item_obj, dict):
            normalized.append(item_obj)
            continue
        item = {
            str(key): value
            for key, value in cast(dict[object, object], item_obj).items()
            if isinstance(key, str)
        }
        _ = item.setdefault("saveDrafts", "included")
        _ = item.setdefault("showSaveWarning", True)
        normalized.append(item)
    return normalized


def _option(value: str, label: str) -> JsonMap:
    return {"value": value, "label": label}


def _field(
    key: str,
    label: str,
    kind: str,
    *,
    description: str = "",
    placeholder: str = "",
    required: bool = False,
    rows: int | None = None,
    options: list[JsonMap] | None = None,
) -> JsonMap:
    data: JsonMap = {
        "key": key,
        "label": label,
        "kind": kind,
        "description": description,
        "placeholder": placeholder,
        "required": required,
    }
    if rows is not None:
        data["rows"] = rows
    if options is not None:
        data["options"] = options
    return data


def _run_profile_contract() -> JsonMap:
    fields: list[object] = [
        _field("profileId", "Profile ID", "text", required=True, placeholder="page-preview"),
        _field(
            "runner",
            "Runner",
            "select",
            required=True,
            options=[
                _option("pagePreview", "Page Preview"),
                _option("node", "Node"),
                _option("python", "Python"),
                _option("custom", "Custom"),
            ],
        ),
        _field(
            "include",
            "Included Files",
            "stringList",
            required=True,
            rows=7,
            description="One project-relative path or glob per line. Clicking Play on any included file uses this profile.",
            placeholder="index.html\nsrc/**",
        ),
        _field(
            "saveDrafts",
            "Draft Save Policy",
            "select",
            description="Select which unsaved drafts are written before this profile runs.",
            options=[
                _option("included", "Save included drafts"),
                _option("opened", "Save opened drafts"),
                _option("all", "Save all drafts"),
                _option("none", "Do not save drafts"),
            ],
        ),
        _field(
            "showSaveWarning",
            "Show save warning before Run",
            "checkbox",
            description="Uncheck to run this profile without the confirmation dialog.",
        ),
        _field(
            "exec",
            "Exec",
            "text",
            description="Required for node/python/custom. Ignored for Page Preview.",
            placeholder="server.js",
        ),
        _field(
            "entry",
            "Entry",
            "text",
            description="Used by Page Preview. Ignored for node/python/custom.",
            placeholder="index.html",
        ),
        _field(
            "args",
            "Args",
            "stringList",
            rows=4,
            description="One process argument per line.",
            placeholder="--port\n3000",
        ),
        _field(
            "cwd",
            "Working Directory",
            "text",
            description="Optional project-relative working directory for node/python/custom profiles.",
            placeholder=".",
        ),
        _field(
            "env",
            "Environment",
            "jsonTextmate",
            rows=5,
            description="JSON object of environment variables. Keys must be valid shell environment names.",
            placeholder='{ "PORT": "3000" }',
        ),
        _field(
            "sidebarUrl",
            "Sidebar URL",
            "text",
            description="Optional URL opened in a sidebar slot. Page Preview defaults to port 3000.",
            placeholder=DEFAULT_PAGE_PREVIEW_URL,
        ),
        _field(
            "runningBehavior",
            "When Already Running",
            "select",
            options=[
                _option("just save", "Just save"),
                _option("relaunch", "Relaunch"),
            ],
        ),
    ]
    return {
        "fields": fields,
    }
