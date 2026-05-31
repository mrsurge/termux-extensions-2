# pyright: strict
from __future__ import annotations

from pathlib import Path
import time
from typing import cast
from urllib.parse import unquote, urlparse

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..stores import get_history_store


def _string_value(data: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_uri(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme == "file":
        return Path(unquote(parsed.path or "")).expanduser().resolve(strict=False).as_uri()
    path = Path(text).expanduser()
    if path.is_absolute():
        return path.resolve(strict=False).as_uri()
    return text


def _path_to_uri(path: str) -> str:
    return Path(path).expanduser().resolve(strict=False).as_uri()


def _active_project() -> str:
    try:
        active = get_history_store().get_active_project()
        if active:
            return str(Path(active).expanduser().resolve(strict=False))
    except Exception:
        pass
    return ""


def _extract_uri(data: dict[str, object]) -> str:
    uri = _string_value(data, "uri")
    if uri:
        return _normalize_uri(uri)
    path = _string_value(data, "path", "targetFile", "target_file", "file")
    if path:
        return _path_to_uri(path)
    return ""


def _edit_count_from_projection(projection: dict[str, object]) -> int:
    edits = projection.get("edits")
    if isinstance(edits, list):
        edit_items = cast(list[object], edits)
        return len(edit_items)
    sources = projection.get("sources")
    count = 0
    if isinstance(sources, list):
        for source in cast(list[object], sources):
            if isinstance(source, dict):
                source_map = cast(dict[object, object], source)
                source_edits = source_map.get("edits")
                if isinstance(source_edits, list):
                    count += len(cast(list[object], source_edits))
    return count


async def _emit_editor_changed(payload: JsonMap) -> None:
    from ..monaco_editor.editor_ws import editor_runtime_emit_room_event

    await editor_runtime_emit_room_event("editor:agent_edits_changed", payload)


async def _request_document_state_from_sidebar(payload: JsonMap, *, exclude_sid: str | None = None) -> JsonMap:
    from ..ui_ipc.sidebar_ws import request_agent_edit_document_state_from_peers

    return await request_agent_edit_document_state_from_peers(payload, exclude_sid=exclude_sid)


def _empty_document_state(uri: str, project_path: str = "") -> JsonMap:
    return {
        "ok": True,
        "available": False,
        "uri": uri,
        "projectPath": project_path,
        "ledgerRevision": 0,
        "notModified": False,
        "sources": [],
        "edits": [],
    }


async def hydrate_agent_edit_document_state(data: dict[str, object], *, exclude_sid: str | None = None) -> JsonMap:
    uri = _extract_uri(data)
    if not uri:
        return {"ok": False, "error": "uri is required"}
    explicit_project_path = _string_value(data, "projectPath", "project", "projectRoot")
    request: JsonMap = {
        "uri": uri,
        "knownLedgerRevision": data.get("knownLedgerRevision") or data.get("known_ledger_revision") or 0,
        "documentVersion": data.get("documentVersion") or data.get("document_version") or 0,
    }
    if explicit_project_path:
        request["projectPath"] = explicit_project_path
    content_sha = _string_value(data, "contentSha256", "content_sha256")
    if content_sha:
        request["contentSha256"] = content_sha
    conversation_id = _string_value(data, "conversationId", "conversation_id")
    if conversation_id:
        request["conversationId"] = conversation_id

    response = await _request_document_state_from_sidebar(request, exclude_sid=exclude_sid)
    if not response.get("ok"):
        response = _empty_document_state(uri, explicit_project_path or _active_project())
        response["hydrateUnavailable"] = True
    elif bool(response.get("queued")):
        print(
            f"[agent_edit_review] document state requested uri={uri} peers={response.get('peers') or 0}",
            flush=True,
        )
        return dict(response)
    response_uri = _extract_uri(response) or uri
    response["uri"] = response_uri
    if not response.get("projectPath"):
        response["projectPath"] = explicit_project_path or _active_project()
    await _emit_editor_changed(dict(response))
    print(
        f"[agent_edit_review] hydrated uri={response_uri} ok={bool(response.get('ok'))} edits={_edit_count_from_projection(response)} notModified={bool(response.get('notModified'))}",
        flush=True,
    )
    return dict(response)


async def handle_sidebar_file_edit_review_signal(
    data: dict[str, object],
    *,
    source_name: str,
    source_sid: str | None = None,
) -> JsonMap:
    uri = _extract_uri(data)
    if not uri:
        return {"ok": False, "error": "path or uri is required"}
    payload: JsonMap = dict(data)
    payload["uri"] = uri
    payload["source"] = _string_value(payload, "source") or source_name
    payload["projectPath"] = _string_value(payload, "projectPath", "project", "projectRoot") or _active_project()
    del source_sid
    print(
        f"[agent_edit_review] file_edit tracking signal uri={uri} source={payload.get('source') or ''}",
        flush=True,
    )
    return {
        "ok": True,
        "uri": uri,
        "trackingSignal": True,
    }


async def handle_sidebar_agent_edits_document_state_get_request(
    data: dict[str, object],
    *,
    source_name: str,
    source_sid: str | None = None,
) -> JsonMap:
    del source_name
    return await hydrate_agent_edit_document_state(data, exclude_sid=source_sid)


async def handle_sidebar_agent_edits_publish_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    uri = _extract_uri(data)
    payload = dict(data)
    payload["source"] = _string_value(payload, "source") or source_name
    payload["ts"] = payload.get("ts") or int(time.time() * 1000)
    if uri:
        payload["uri"] = uri
    else:
        edits = payload.get("edits")
        if isinstance(edits, list):
            for edit in cast(list[object], edits):
                if isinstance(edit, dict):
                    edit_map = cast(dict[str, object], edit)
                    edit_uri = _extract_uri(edit_map)
                    if edit_uri:
                        if not uri:
                            uri = edit_uri
        if uri:
            payload["uri"] = uri
    await _emit_editor_changed(payload)
    print(
        f"[agent_edit_review] publish uri={uri or ''} source={payload.get('source') or ''} edits={_edit_count_from_projection(payload)}",
        flush=True,
    )
    return {
        "ok": True,
        "uri": uri,
        "visibleCount": _edit_count_from_projection(payload),
        "ledgerRevision": payload.get("ledgerRevision") or payload.get("ledger_revision") or 0,
    }


async def handle_sidebar_agent_edits_clear_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    uri = _extract_uri(data)
    removed = 0
    if uri:
        await _emit_editor_changed({"ok": True, "uri": uri, "edits": [], "sources": [], "cleared": True})
    elif isinstance(data.get("uris"), list):
        for raw_uri in cast(list[object], data["uris"]):
            if not isinstance(raw_uri, str):
                continue
            normalized = _normalize_uri(raw_uri)
            if not normalized:
                continue
            await _emit_editor_changed({"ok": True, "uri": normalized, "edits": [], "sources": [], "cleared": True})
    else:
        await _emit_editor_changed({"ok": True, "edits": [], "sources": [], "cleared": True})
    return {"ok": True, "removed": removed, "uri": uri}


async def handle_sidebar_agent_edits_list_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del data
    del source_name
    return {"ok": True, "items": [], "count": 0, "stateless": True}


async def handle_editor_agent_edits_decide_request(data: dict[str, object]) -> JsonMap:
    from ..ui_ipc.sidebar_ws import forward_agent_edit_decision_to_peers

    payload = dict(data)
    payload.setdefault("decisionId", f"agent_edit_decision_{int(time.time() * 1000)}")
    response = await forward_agent_edit_decision_to_peers(payload)
    return response


async def handle_sidebar_agent_edits_decide_request(
    data: dict[str, object],
    *,
    source_name: str,
    source_sid: str | None = None,
) -> JsonMap:
    del source_name
    from ..ui_ipc.sidebar_ws import forward_agent_edit_decision_to_peers

    payload = dict(data)
    payload.setdefault("decisionId", f"agent_edit_decision_{int(time.time() * 1000)}")
    return await forward_agent_edit_decision_to_peers(payload, exclude_sid=source_sid)
