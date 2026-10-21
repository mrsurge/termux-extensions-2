"""Sidebar service policy; framework relay metadata is not UI focus authority."""
from __future__ import annotations

import msgspec

from ..sidebar_window_events import publish_sidebar_window_state_changed
from ..ui_ipc.sidebar_rpc_contract import (
    SidebarFileOpen as _FileOpen,
    SidebarProjectRequest as _ProjectRequest,
)
from ..ui_ipc.sidebar_window_state import get_sidebar_window_state, open_sidebar_window_url

JsonObject = dict[str, object]
CALLERS = {"terminal", "file_explorer", "file_editor", "als-rs"}


def _object(value: object) -> JsonObject:
    return msgspec.convert(value, type=dict[str, object], strict=True)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _matching_aliases(params: JsonObject, keys: tuple[str, ...], expected: str) -> None:
    for key in keys:
        if key in params and params[key] != expected:
            raise ValueError(f"Sidebar {key} does not match its owner")


async def dispatch_sidebar_service(value: object) -> JsonObject:
    body = _object(value)
    if set(body) != {"service", "version", "method", "context", "payload", "source"}:
        raise ValueError("Invalid Sidebar service envelope")
    if body["service"] != "sidebar" or type(body["version"]) is not int or body["version"] != 1:
        raise ValueError("Unsupported Sidebar service version")
    source = _object(body["source"])
    app_id = _text(source.get("appId"))
    if set(source) != {"appId", "shellId"} or app_id not in CALLERS or not _text(source.get("shellId")):
        raise ValueError("Missing framework-derived Sidebar caller")
    # These are backend facts, not per-client foreground requests.
    if body["context"] not in (None, {}):
        raise ValueError("Sidebar fact publication does not accept presentation authority")
    params = dict(_object(body["payload"]))
    if body["method"] == "cwd.get":
        if params or app_id not in {"terminal", "file_explorer", "als-rs"}:
            raise ValueError("Invalid Sidebar CWD request")
        from ..ui_ipc.sidebar_ws import get_sidebar_cwd_snapshot
        return get_sidebar_cwd_snapshot("request")
    if app_id == "als-rs" and body["method"] != "window.state.update":
        from .sidebar_pipe import originating_app
        token = originating_app.set(app_id)
        try:
            return await _dispatch_als_service(_text(body["method"]), params)
        finally:
            originating_app.reset(token)
    if body["method"] != "window.state.update":
        raise ValueError("Unsupported Sidebar service method")
    if params.get("activate", False) is not False:
        raise ValueError("Backend state publication cannot activate a client window")
    _matching_aliases(params, ("app_id", "appId"), app_id)
    lane = _object(params.get("lane", {}))
    _matching_aliases(lane, ("app_id", "appId"), app_id)
    host_id = _text(params.get("host_id") or params.get("hostId"))
    if not host_id:
        raise ValueError("Sidebar slot identity is required")
    _matching_aliases(params, ("host_id", "hostId"), host_id)
    slots = _object(get_sidebar_window_state().get("slots"))
    slot = _object(slots.get(host_id, {}))
    if not slot or slot.get("app_id") != app_id:
        raise ValueError("Sidebar slot does not belong to this app")
    token_id = _text(slot.get("token_id"))
    _matching_aliases(params, ("token_id", "tokenId"), token_id)
    base_url = _text(slot.get("base_url"))
    _matching_aliases(params, ("base_url", "baseUrl"), base_url)
    _matching_aliases(lane, ("base_url", "baseUrl"), base_url)
    params.update(app_id=app_id, host_id=host_id, token_id=token_id, activate=False)
    # Reuse the ledger owner and its normal global projection, without fake SIDs
    # or changes to per-client foreground/presentation registrations.
    result = open_sidebar_window_url(params)
    await publish_sidebar_window_state_changed(
        _object(result["state"]), source=f"{app_id}_pipe_state", sidebar_scope="global",
    )
    return result


async def _dispatch_als_service(method: str, params: JsonObject) -> JsonObject:
    # Import the module itself: mypyc's package-from-import can leave its
    # separate module reference unset until the unrelated cwd.get branch runs.
    import app.apps.code_te2.ui_ipc.sidebar_ws as sidebar_ws
    from . import agent_edit_review_backend as review
    from . import draft_state_backend as drafts
    from . import project_backend as projects

    if method == "file.open":
        msgspec.convert(params, type=_FileOpen, strict=True)
        return await sidebar_ws.handle_sidebar_document_open(
            params, requester_app_id="als-rs", require_presentation=True,
        )
    if method == "file.edit":
        result = await review.handle_sidebar_file_edit_review_signal(params, source_name="als_pipe")
        if sidebar_ws._is_agent_sidebar_tracking_enabled():
            from .file_ops_backend import handle_host_open_request
            await handle_host_open_request({**params, "focus": False}, source_name="als_pipe", request_prefix="als_pipe")
        return {"ok": True, "review": result}
    if method == "project.lookup":
        return await projects.handle_sidebar_project_lookup_request(params, source_name="als_pipe")
    if method in {"project.open", "project.create"}:
        msgspec.convert(params, type=_ProjectRequest, strict=True)
        # Recheck the exact presentation after project/save-mode lock waits too.
        def validate() -> None:
            sidebar_ws.resolve_sidebar_request_client(params, requester_app_id="als-rs", require_presentation=True)
        validate()
        if method == "project.open":
            result = await projects.handle_sidebar_project_open_request(params, source_name="als_pipe", before_switch=validate)
        else:
            result = await projects.handle_sidebar_project_create_request(params, source_name="als_pipe", before_switch=validate)
        if result.get("ok") is True and "resolved_path" in result:
            await sidebar_ws.emit_sidebar_project_opened_global(result)
        return result
    if method == "agentEdits.publish":
        return await review.handle_sidebar_agent_edits_publish_request(params, source_name="als_pipe")
    if method == "agentEdits.clear":
        return await review.handle_sidebar_agent_edits_clear_request(params, source_name="als_pipe")
    if method == "agentEdits.list":
        return await review.handle_sidebar_agent_edits_list_request(params, source_name="als_pipe")
    if method == "agentEdits.documentState.get":
        return await review.handle_sidebar_agent_edits_document_state_get_request(params, source_name="als_pipe")
    if method == "agentEdits.decide":
        return await review.handle_sidebar_agent_edits_decide_request(params, source_name="als_pipe")
    if method == "drafts.list":
        return await drafts.handle_sidebar_drafts_list_request(params, source_name="als_pipe")
    if method == "draftState.get":
        return await drafts.handle_sidebar_draft_state_get_request(params, source_name="als_pipe")
    if method == "draft.clear":
        return await drafts.handle_sidebar_draft_clear_request(params, source_name="als_pipe")
    raise ValueError("Unsupported ALS Sidebar operation")
