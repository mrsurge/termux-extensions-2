from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ...stores import _history_store, _preferences_store

from .framework_apps_client import FrameworkAppsClient


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _normalize_load(value: Any) -> str:
    return "eager" if _norm(value).lower() == "eager" else "lazy"


@dataclass(slots=True)
class SidebarShortcutsClient:
    framework_apps: FrameworkAppsClient

    async def add_framework_app_shortcut(
        self,
        app_id: str,
        *,
        label: str = "",
        load: str = "lazy",
        header: bool = True,
        activate: bool = True,
    ) -> dict[str, Any]:
        safe_app_id = _norm(app_id)
        if not safe_app_id:
            return {"ok": False, "error": "app_id is required"}

        catalog = await self.framework_apps.get_catalog()
        manifest = next((item for item in catalog if _norm(item.get("id")) == safe_app_id), None)
        if manifest is None:
            return {"ok": False, "error": f"App not found in framework catalog: {safe_app_id}"}

        shortcut_id = f"framework_app::{safe_app_id}"
        shortcut = {
            "id": shortcut_id,
            "kind": "framework_app",
            "app_id": safe_app_id,
            "label": _norm(label) or _norm(manifest.get("name")) or safe_app_id,
            "url": f"/app/{safe_app_id}?embed=1",
            "icon": None,
            "load": _normalize_load(load),
            "header": bool(header),
            "last_used": 0,
        }

        prefs = _preferences_store.get_preferences()
        ui_prefs = dict(prefs.get("ui") or {})
        existing = list(ui_prefs.get("agentShortcuts") or [])

        next_shortcuts: list[dict[str, Any]] = []
        replaced = False
        for raw in existing:
            if not isinstance(raw, dict):
                continue
            raw_id = _norm(raw.get("id"))
            raw_kind = _norm(raw.get("kind")).lower()
            raw_app_id = _norm(raw.get("app_id"))
            if raw_id == shortcut_id or (raw_kind == "framework_app" and raw_app_id == safe_app_id):
                next_shortcuts.append(shortcut)
                replaced = True
            else:
                next_shortcuts.append(raw)
        if not replaced:
            next_shortcuts.append(shortcut)

        updates: dict[str, Any] = {"agentShortcuts": next_shortcuts}
        if activate:
            updates["agentActiveShortcutId"] = shortcut_id

        updated = _preferences_store.update_preferences(ui=updates)
        ui_snapshot = updated.get("ui") or {}

        active_project = _history_store.get_active_project()
        if active_project:
            from ...explorer_ws import manager as explorer_manager
            await explorer_manager.broadcast(
                str(active_project),
                {"type": "prefs:setUi", "payload": {"ui": ui_snapshot}},
            )

        return {
            "ok": True,
            "app_id": safe_app_id,
            "shortcut": shortcut,
            "active_project": active_project,
            "replaced": replaced,
            "count": len(next_shortcuts),
        }
