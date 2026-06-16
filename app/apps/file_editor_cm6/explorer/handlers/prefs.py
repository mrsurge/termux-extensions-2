# pyright: strict
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import cast

from ..contracts.prefs import (
    ExplorerPrefsUpdateUiParams,
    ExplorerPrefsVendorAgentIconParams,
)
from ..context import ExplorerPrefsHandlerContext
from ..services.state_facts import publish_preferences_changed
from ...preferences_store import DEFAULT_UI_PREFS
from ...stores import get_preferences_store

JsonObject = dict[str, object]
PreferenceValue = bool | str | list[JsonObject]

AGENT_ICON_DIR = Path.home() / ".local" / "share" / "termux-extensions-2" / "agent_icons"
PREFERENCES_STORE = get_preferences_store()


async def handle_prefs_update_ui(
    context: ExplorerPrefsHandlerContext,
    params: ExplorerPrefsUpdateUiParams,
    msg_id: str | None,
) -> None:
    key = params["key"]
    if key not in DEFAULT_UI_PREFS:
        raise RuntimeError(f"Unknown UI preference key: {key}")

    value = _normalize_ui_pref_value(key, params["value"])
    updated = PREFERENCES_STORE.update_preferences(ui={key: value})
    ui_prefs = _as_object(updated.get("ui")) or {}
    await publish_preferences_changed(
        ui=ui_prefs,
        source="explorer_prefs:update_ui",
    )
    del msg_id


async def handle_prefs_vendor_agent_icon(
    context: ExplorerPrefsHandlerContext,
    params: ExplorerPrefsVendorAgentIconParams,
    msg_id: str | None,
) -> None:
    src = Path(params["abs_path"]).expanduser()
    try:
        src = src.resolve(strict=True)
    except Exception:
        raise RuntimeError(f"Icon file not found: {params['abs_path']}") from None

    if not src.is_file():
        raise RuntimeError("Icon path is not a file")

    ext = src.suffix.lower()
    if ext not in (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"):
        raise RuntimeError("Unsupported icon type (svg/png/jpg/gif/webp)")

    try:
        data = src.read_bytes()
    except Exception as exc:
        raise RuntimeError(f"Failed to read icon: {exc}") from exc

    digest = hashlib.sha256(data).hexdigest()[:16]
    stem = src.stem
    safe_stem = "".join(ch for ch in stem if ch.isalnum() or ch in ("-", "_"))[:40] or "icon"
    name = f"{safe_stem}_{digest}{ext}"

    try:
        AGENT_ICON_DIR.mkdir(parents=True, exist_ok=True)
        dst = (AGENT_ICON_DIR / name).resolve()
        if AGENT_ICON_DIR.resolve() not in dst.parents:
            raise RuntimeError("Invalid destination path")
        if not dst.exists():
            tmp = dst.with_suffix(dst.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(dst)
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(f"Failed to vendor icon: {exc}") from exc

    await context.emit_personal(
        "prefs:vendorAgentIconResult",
        {
            "ok": True,
            "name": name,
            "url": f"/api/app/file_editor_cm6/agent_icons/{name}",
        },
        msg_id,
    )


def _normalize_ui_pref_value(key: str, value: object) -> PreferenceValue:
    expected = DEFAULT_UI_PREFS[key]
    if isinstance(expected, bool):
        return _normalize_bool_pref(value)
    if isinstance(expected, str):
        return _normalize_string_pref(key, value)
    if isinstance(expected, list):
        if key == "agentShortcuts":
            return _normalize_agent_shortcuts(value)
        if not isinstance(value, list):
            raise RuntimeError("prefs:updateUi requires 'value' (array)")
        return []
    raise RuntimeError("prefs:updateUi unsupported preference type")


def _normalize_bool_pref(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "on"):
            return True
        if lowered in ("false", "0", "no", "off"):
            return False
    raise RuntimeError("prefs:updateUi requires 'value' (boolean)")


def _normalize_string_pref(key: str, value: object) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise RuntimeError("prefs:updateUi requires 'value' (string)")
    normalized = value.strip()
    if key in ("agentToggleDisplay", "agentHeaderDisplay") and normalized not in ("icon", "text", "both"):
        raise RuntimeError(f"{key} must be one of: icon, text, both")
    return normalized


def _normalize_agent_shortcuts(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        raise RuntimeError("prefs:updateUi requires 'value' (array)")

    shortcut_values = cast(list[object], value)
    if len(shortcut_values) > 64:
        raise RuntimeError("agentShortcuts max length is 64")

    cleaned: list[JsonObject] = []
    for idx, raw in enumerate(shortcut_values):
        raw_dict = _as_object(raw)
        if raw_dict is None:
            raise RuntimeError(f"agentShortcuts[{idx}] must be an object")

        shortcut_kind = raw_dict.get("kind")
        if not isinstance(shortcut_kind, str):
            raise RuntimeError(f"agentShortcuts[{idx}].kind must be a string")
        shortcut_kind = shortcut_kind.strip().lower()
        if shortcut_kind not in ("url", "framework_app"):
            raise RuntimeError(f"agentShortcuts[{idx}].kind must be 'url' or 'framework_app'")

        app_id = raw_dict.get("app_id")
        app_id_clean = ""
        if shortcut_kind == "framework_app":
            if not isinstance(app_id, str) or not app_id.strip():
                raise RuntimeError(f"agentShortcuts[{idx}].app_id is required for kind=framework_app")
            app_id_clean = app_id.strip()

        label = raw_dict.get("label")
        if not isinstance(label, str) or not label.strip():
            raise RuntimeError(f"agentShortcuts[{idx}].label is required")

        url = raw_dict.get("url")
        if not isinstance(url, str) or not url.strip():
            raise RuntimeError(f"agentShortcuts[{idx}].url is required")

        version = raw_dict.get("version")
        if version is None:
            version_clean = ""
        elif isinstance(version, str):
            version_clean = version.strip()
        elif isinstance(version, (int, float)) and version >= 0:
            version_clean = str(int(version))
        else:
            raise RuntimeError(f"agentShortcuts[{idx}].version must be a string or positive number")

        sid = raw_dict.get("id")
        sid_clean = sid.strip() if isinstance(sid, str) and sid.strip() else f"sc_{idx}"

        load = raw_dict.get("load")
        if load is None or (isinstance(load, str) and not load.strip()):
            load_clean = "lazy"
        elif isinstance(load, str):
            load_clean = load.strip().lower()
            if load_clean not in ("lazy", "eager"):
                raise RuntimeError(f"agentShortcuts[{idx}].load must be 'lazy' or 'eager'")
        else:
            raise RuntimeError(f"agentShortcuts[{idx}].load must be 'lazy' or 'eager'")

        icon_clean = _normalize_shortcut_icon(raw_dict.get("icon"), idx)

        header_flag = raw_dict.get("header")
        header_clean = bool(header_flag) if header_flag is not None else False

        last_used = raw_dict.get("last_used")
        last_used_clean = int(last_used) if isinstance(last_used, (int, float)) and last_used >= 0 else 0

        cleaned.append(
            {
                "id": sid_clean,
                "kind": shortcut_kind,
                "app_id": app_id_clean,
                "label": label.strip(),
                "url": url.strip(),
                "version": version_clean,
                "icon": icon_clean,
                "load": load_clean,
                "header": header_clean,
                "last_used": last_used_clean,
            }
        )
    return cleaned


def _normalize_shortcut_icon(value: object, idx: int) -> JsonObject | None:
    if value is None:
        return None

    icon_dict = _as_object(value)
    if icon_dict is None:
        raise RuntimeError(f"agentShortcuts[{idx}].icon must be an object")

    icon_kind = icon_dict.get("kind")
    if icon_kind == "emoji":
        emoji = icon_dict.get("emoji")
        if not isinstance(emoji, str) or not emoji.strip():
            raise RuntimeError(f"agentShortcuts[{idx}].icon.emoji is required")
        return {"kind": "emoji", "emoji": emoji.strip()}
    if icon_kind == "asset":
        name = icon_dict.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RuntimeError(f"agentShortcuts[{idx}].icon.name is required")
        return {"kind": "asset", "name": name.strip()}
    raise RuntimeError(f"agentShortcuts[{idx}].icon.kind must be 'emoji' or 'asset'")


def _as_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
