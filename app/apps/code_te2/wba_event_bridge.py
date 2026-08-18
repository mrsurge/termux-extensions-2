"""Backend-owned WBA control-plane event dispatch.

The WBA process writes backend-relevant ``te2.event`` payloads over its existing
FWS stdio pipe. The adapter shell manager reads those push frames and calls this
module so Explorer, diagnostics, watchers, and adapter lifecycle facts stay on
the backend control-plane path. Editor language-feature traffic remains on the
direct WBA socket lane.
"""

from __future__ import annotations

from typing import cast

JsonObject = dict[str, object]

_enospc_forwarded = False


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    result: list[JsonObject] = []
    for item in cast(list[object], value):
        if isinstance(item, dict):
            result.append(_json_object(cast(object, item)))
    return result


def _int_value(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float | str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


def reset_wba_project_event_state() -> None:
    """Clear project-scoped WBA event projections without stopping intake."""
    global _enospc_forwarded

    _enospc_forwarded = False
    try:
        from .diagnostics_bridge import reset_diagnostics_projection

        reset_diagnostics_projection()
    except Exception:
        pass
    try:
        from .extension_navigation_backend import reset_extension_navigation

        reset_extension_navigation("WBA project event state reset")
    except Exception:
        pass


async def _handle_watcher_enospc(ev: JsonObject) -> None:
    global _enospc_forwarded

    if _enospc_forwarded:
        return

    proj = ""
    try:
        from .explorer.services.file_ops import get_project_root
        from .project_sidecar import ProjectSidecar

        proj = str(get_project_root())
        sidecar = ProjectSidecar.load_or_create(proj)
        watcher_obj = sidecar.dump_raw().get("watcher", {})
        watcher = _json_object(watcher_obj)
        watcher_mode = str(watcher.get("mode", "ipc"))
        if watcher_mode != "ipc":
            print(
                f"[wba_event_bridge] watcher/enospc suppressed (mode={watcher_mode})",
                flush=True,
            )
            _enospc_forwarded = True
            return
    except Exception:
        pass

    _enospc_forwarded = True
    try:
        from .workspace_events import publish_watcher_error

        await publish_watcher_error(
            proj,
            {
                "message": str(ev.get("message", "Inotify limit reached (ENOSPC)")),
                "limit": 524288,
            },
        )
        print("[wba_event_bridge] watcher/enospc forwarded (once)", flush=True)
    except Exception as exc:
        print(f"[wba_event_bridge] watcher/enospc emit FAIL: {exc}", flush=True)


async def _handle_watcher_file_changes(ev: JsonObject) -> None:
    try:
        changes = _json_object_list(ev.get("changes", []))
        if not changes:
            return
        try:
            from .explorer.services.file_ops import get_project_root

            project_root = str(get_project_root())
        except Exception:
            project_root = ""

        created_abs: list[str] = []
        changed_abs: list[str] = []
        deleted_abs: list[str] = []
        for change in changes:
            path = str(change.get("path", ""))
            if not path:
                continue
            change_type = _int_value(change.get("type", 0))
            if change_type == 1:
                created_abs.append(path)
            elif change_type == 2:
                deleted_abs.append(path)
            else:
                changed_abs.append(path)

        total = len(created_abs) + len(changed_abs) + len(deleted_abs)
        if total <= 0:
            return

        from .workspace_events import publish_file_change_event

        await publish_file_change_event(
            project_root,
            created_abs=created_abs,
            changed_abs=changed_abs,
            deleted_abs=deleted_abs,
        )
        print(
            f"[wba_event_bridge] watcher/fileChanges forwarded project={project_root} paths={total}",
            flush=True,
        )
    except Exception as exc:
        print(f"[wba_event_bridge] watcher/fileChanges emit FAIL: {exc}", flush=True)


async def _dispatch_wba_event(ev: JsonObject) -> None:
    ev_type = str(ev.get("type") or "")
    if ev_type == "adapter/ready":
        return
    if ev_type == "adapter/sessionReset":
        await _handle_adapter_session_reset(ev)
        return
    if ev_type == "document/activeChanged":
        await _handle_active_document_changed(ev)
        return
    if ev_type == "workspace/switched":
        await _handle_workspace_switched(ev)
        return
    if ev_type == "watcher/enospc":
        await _handle_watcher_enospc(ev)
        return
    if ev_type == "watcher/fileChanges":
        await _handle_watcher_file_changes(ev)
        return
    if ev_type == "diagnostics/update":
        from .diagnostics_bridge import handle_wba_diagnostics_update

        await handle_wba_diagnostics_update(ev)
        return
    if ev_type == "extension/editorOpenRequested":
        from .extension_navigation_backend import schedule_extension_open

        schedule_extension_open(ev)
        return
    if ev_type == "webview/snapshot":
        await _handle_webview_snapshot(ev)


async def dispatch_wba_pipe_event(ev: JsonObject) -> None:
    """Dispatch a backend WBA event received from the adapter stdio pipe."""
    await _dispatch_wba_event(ev)


async def _handle_adapter_session_reset(ev: JsonObject) -> None:
    project_root = _event_workspace_root(ev)
    try:
        from .adapter_lifecycle_events import publish_adapter_session_reset

        await publish_adapter_session_reset(
            dict(ev),
            project_root=project_root,
            source="wba_event_bridge:adapter_session_reset",
        )
        print(
            f"[wba_event_bridge] adapter/sessionReset forwarded project={project_root or ''}",
            flush=True,
        )
    except Exception as exc:
        print(f"[wba_event_bridge] adapter/sessionReset emit FAIL: {exc}", flush=True)


async def _handle_active_document_changed(ev: JsonObject) -> None:
    project_root = _event_workspace_root(ev)
    if project_root is None:
        return
    try:
        from .adapter_lifecycle_events import publish_adapter_active_document_changed

        await publish_adapter_active_document_changed(
            dict(ev),
            project_root=project_root,
            source="wba_event_bridge:active_document_changed",
        )
    except Exception as exc:
        print(
            f"[wba_event_bridge] document/activeChanged emit FAIL: {exc}",
            flush=True,
        )


async def _handle_workspace_switched(ev: JsonObject) -> None:
    raw_root = ev.get("workspaceFolder") or ev.get("to")
    if not isinstance(raw_root, str) or not raw_root.strip():
        return
    try:
        from pathlib import Path

        switched_root = str(Path(raw_root).expanduser().resolve(strict=False))
        backend_root = _event_workspace_root({})
        if switched_root != backend_root:
            print(
                f"[wba_event_bridge] workspace/switched ignored root={switched_root} backend={backend_root}",
                flush=True,
            )
            return
        from .adapter_lifecycle_events import publish_adapter_workspace_ready

        await publish_adapter_workspace_ready(
            dict(ev),
            project_root=switched_root,
            source="wba_event_bridge:workspace_switched",
        )
        print(
            f"[wba_event_bridge] workspace/switched forwarded root={switched_root}",
            flush=True,
        )
    except Exception as exc:
        print(f"[wba_event_bridge] workspace/switched handling failed: {exc}", flush=True)


async def _handle_webview_snapshot(ev: JsonObject) -> None:
    from pathlib import Path

    from .sidebar_window_events import publish_sidebar_window_state_changed
    from .ui_ipc.sidebar_window_state import reconcile_extension_webview_slots
    from .ui_ipc.sidebar_ws import forget_sidebar_window_runtime_state

    raw_root = ev.get("workspaceFolder")
    if not isinstance(raw_root, str) or not raw_root.strip():
        return
    project_root = str(Path(raw_root).expanduser().resolve(strict=False))
    backend_root = _event_workspace_root({})
    surfaces = _json_object_list(ev.get("surfaces", []))
    admitted: dict[str, JsonObject] = {}
    for raw_surface in surfaces:
        if str(raw_surface.get("dto") or "") != "ExtensionWebviewSurface":
            continue
        if _int_value(raw_surface.get("version"), 0) != 1:
            continue
        surface_project = str(raw_surface.get("projectPath") or "").strip()
        host_id = str(raw_surface.get("hostId") or "").strip()
        surface_id = str(raw_surface.get("surfaceId") or "").strip()
        extension_id = str(raw_surface.get("extensionId") or "").strip()
        view_id = str(raw_surface.get("viewId") or "").strip()
        workspace_id = str(raw_surface.get("workspaceId") or "").strip()
        surface_kind = str(raw_surface.get("surfaceKind") or "view").strip()
        url = str(raw_surface.get("url") or "").strip()
        if not all(
            (
                surface_project,
                host_id,
                surface_id,
                extension_id,
                view_id,
                workspace_id,
                url,
            )
        ):
            continue
        normalized_project = str(
            Path(surface_project).expanduser().resolve(strict=False)
        )
        if normalized_project != project_root:
            continue
        admitted[host_id] = {
            "dto": "ExtensionWebviewSurface",
            "version": 1,
            "surfaceId": surface_id,
            "hostId": host_id,
            "workspaceId": workspace_id,
            "projectPath": normalized_project,
            "extensionId": extension_id,
            "viewId": view_id,
            "surfaceKind": surface_kind if surface_kind in {"view", "panel"} else "view",
            "url": url,
            "iconUrl": str(raw_surface.get("iconUrl") or "").strip(),
            "retainContextWhenHidden": bool(
                raw_surface.get("retainContextWhenHidden")
            ),
            "viewColumn": _int_value(raw_surface.get("viewColumn"), 0),
        }

    desired_slots: dict[str, JsonObject] = {}
    for raw_surface in surfaces:
        host_id = str(raw_surface.get("hostId") or "").strip()
        surface = admitted.get(host_id)
        if surface is None:
            continue
        title = str(raw_surface.get("title") or raw_surface.get("viewId") or "Extension")
        url = str(surface["url"])
        icon_url = str(surface.get("iconUrl") or "").strip()
        extension_id = str(surface.get("extensionId") or "Extension")
        desired_slots[host_id] = {
            "kind": "url",
            "host_id": host_id,
            "hostId": host_id,
            "title": title,
            "label": title,
            "url": url,
            "restore_url": url,
            "load": "eager",
            "version": str(raw_surface.get("htmlRevision") or 0),
            "icon": (
                {"kind": "image", "src": icon_url}
                if icon_url
                else {"kind": "text", "text": extension_id[:2].upper()}
            ),
            "webviewSurface": surface,
        }

    result = reconcile_extension_webview_slots(
        project_root,
        desired_slots,
        upsert=backend_root == project_root,
    )
    if result.get("changed") is not True:
        return
    removed = result.get("removed")
    if isinstance(removed, list):
        removed_values = cast(list[object], removed)
        forget_sidebar_window_runtime_state(
            [host_id for host_id in removed_values if isinstance(host_id, str)]
        )
    await publish_sidebar_window_state_changed(
        _json_object(result.get("state", {})),
        source="wba_event_bridge:webview_snapshot",
        sidebar_scope="global",
    )


def _event_workspace_root(ev: JsonObject) -> str | None:
    try:
        from pathlib import Path

        from .explorer.services.file_ops import get_project_root

        raw_root = ev.get("workspaceFolder") or ev.get("to")
        if isinstance(raw_root, str) and raw_root.strip():
            return str(Path(raw_root).expanduser().resolve(strict=False))
        return str(Path(get_project_root()).expanduser().resolve(strict=False))
    except Exception:
        return None
