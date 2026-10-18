"""Worker-owned persistent shortcut updates from trusted framework requests."""
from __future__ import annotations
from typing import cast

def project_shortcuts(existing: object, shortcut: dict[str, object]) -> tuple[list[dict[str, object]], bool]:
    updated: list[dict[str, object]] = []
    replaced = False
    items = cast(list[object],existing) if isinstance(existing,list) else []
    for value in items:
        if not isinstance(value,dict):
            continue
        item = cast(dict[str,object],value)
        if str(item.get("id") or "").strip()==shortcut["id"] or (str(item.get("kind") or "").strip().lower()=="framework_app" and str(item.get("app_id") or "").strip()==shortcut["app_id"]):
            updated.append(shortcut)
            replaced = True
        else:
            updated.append(item)
    if not replaced:
        updated.append(shortcut)
    return updated,replaced

async def add_framework_shortcut(params: object) -> dict[str, object]:
    if not isinstance(params,dict):
        raise ValueError("Invalid framework shortcut request")
    values = cast(dict[str,object],params)
    if set(values)!={"shortcut"} or not isinstance(values["shortcut"],dict):
        raise ValueError("Invalid framework shortcut request")
    shortcut = cast(dict[str,object],values["shortcut"])
    app_id = shortcut.get("app_id")
    if not isinstance(app_id,str) or not app_id or shortcut.get("id")!=f"framework_app::{app_id}" or shortcut.get("kind")!="framework_app":
        raise ValueError("Invalid framework shortcut identity")
    # These stores and notifications belong to this live worker, never the MCP
    # sidecar. The pipe admits only the trusted framework origin and exact owner.
    from ..stores import get_preferences_store, get_history_store
    from ..explorer.handlers.prefs import normalize_agent_shortcuts
    from ..explorer.services.state_facts import publish_preferences_changed
    preferences_store = get_preferences_store()
    prefs = preferences_store.get_preferences()
    raw_ui = prefs.get("ui")
    ui = cast(dict[str,object],raw_ui) if isinstance(raw_ui,dict) else {}
    next_shortcuts,replaced = project_shortcuts(ui.get("agentShortcuts"),shortcut)
    normalized = normalize_agent_shortcuts(next_shortcuts)
    updated = preferences_store.update_preferences(ui={"agentShortcuts":normalized})
    active_project = get_history_store().get_active_project()
    raw_updated = updated.get("ui")
    updated_ui = cast(dict[str,object],raw_updated) if isinstance(raw_updated,dict) else {}
    await publish_preferences_changed(ui=updated_ui,source="native_mcp:sidebar_shortcut")
    return {"ok":True,"app_id":app_id,"shortcut":shortcut,"active_project":active_project,
            "replaced":replaced,"count":len(next_shortcuts)}
