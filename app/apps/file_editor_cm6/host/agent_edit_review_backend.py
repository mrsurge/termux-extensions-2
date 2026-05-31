# pyright: strict
from __future__ import annotations

from pathlib import Path
import time
from typing import cast
from urllib.parse import unquote, urlparse

from ..monaco_editor.editor_backend_services.contracts import JsonMap
from ..stores import get_history_store

_CACHE_BY_URI: dict[str, JsonMap] = {}
_OPEN_URIS: set[str] = set()


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


def _uri_to_path(uri: str) -> str:
    parsed = urlparse(uri)
    if parsed.scheme == "file":
        return str(Path(unquote(parsed.path or "")).expanduser().resolve(strict=False))
    return uri


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


def _display_path(uri: str, project_path: str | None = None, rel: str | None = None) -> str:
    if rel:
        return rel
    abs_path = _uri_to_path(uri)
    project = project_path or _active_project()
    if project:
        try:
            return Path(abs_path).resolve(strict=False).relative_to(Path(project).resolve(strict=False)).as_posix()
        except Exception:
            pass
    return abs_path


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


def _cached_payload_for_uri(uri: str) -> JsonMap | None:
    cached = _CACHE_BY_URI.get(uri)
    if cached is None:
        return None
    return dict(cached)


async def _emit_editor_changed(payload: JsonMap) -> None:
    from ..monaco_editor.editor_ws import editor_runtime_emit_room_event

    await editor_runtime_emit_room_event("editor:agent_edits_changed", payload)


async def _emit_review_toast(payload: dict[str, object]) -> None:
    from ..monaco_editor.editor_ws import editor_runtime_emit_room_event

    uri = _extract_uri(payload)
    if not uri:
        return
    project_path = _string_value(payload, "projectPath", "project", "projectRoot")
    rel = _string_value(payload, "rel")
    path_label = _display_path(uri, project_path, rel)
    if not path_label:
        return
    await editor_runtime_emit_room_event(
        "editor:notify",
        {
            "message": f"Agent edit review available: {path_label}",
            "kind": "info",
            "timeout": 4500,
            "source": "agent_edit_review",
            "path": _uri_to_path(uri),
            "uri": uri,
        },
    )


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
    _OPEN_URIS.add(uri)
    request: JsonMap = {
        "uri": uri,
        "projectPath": _string_value(data, "projectPath", "project", "projectRoot") or _active_project(),
        "knownLedgerRevision": data.get("knownLedgerRevision") or data.get("known_ledger_revision") or 0,
        "documentVersion": data.get("documentVersion") or data.get("document_version") or 0,
    }
    content_sha = _string_value(data, "contentSha256", "content_sha256")
    if content_sha:
        request["contentSha256"] = content_sha
    conversation_id = _string_value(data, "conversationId", "conversation_id")
    if conversation_id:
        request["conversationId"] = conversation_id

    response = await _request_document_state_from_sidebar(request, exclude_sid=exclude_sid)
    if not response.get("ok"):
        cached = _cached_payload_for_uri(uri)
        if cached is not None:
            cached["hydratedFromCache"] = True
            cached["hydrateUnavailable"] = True
            await _emit_editor_changed(dict(cached))
            print(
                f"[agent_edit_review] hydrate replayed cached projection uri={uri} reason={response.get('error') or 'peer_unavailable'} edits={_edit_count_from_projection(cached)}",
                flush=True,
            )
            return dict(cached)
        response = _empty_document_state(uri, str(request.get("projectPath") or ""))
    response_uri = _extract_uri(response) or uri
    response["uri"] = response_uri
    if not response.get("projectPath"):
        response["projectPath"] = request["projectPath"]
    _CACHE_BY_URI[response_uri] = dict(response)
    await _emit_editor_changed(dict(response))
    print(
        f"[agent_edit_review] hydrated uri={response_uri} ok={bool(response.get('ok'))} edits={_edit_count_from_projection(response)} notModified={bool(response.get('notModified'))}",
        flush=True,
    )
    return dict(response)


async def handle_editor_open_complete_for_agent_edits(data: dict[str, object]) -> None:
    path = _string_value(data, "path")
    if not path:
        return
    payload: JsonMap = {
        "uri": _path_to_uri(path),
        "path": path,
        "projectPath": _active_project(),
        "source": "editor_open_complete",
    }
    try:
        await hydrate_agent_edit_document_state(payload)
    except Exception as exc:
        print(f"[agent_edit_review] document hydration failed path={path} err={exc}", flush=True)


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
    if not _cached_payload_for_uri(uri):
        _CACHE_BY_URI[uri] = {
            "ok": True,
            "available": False,
            "uri": uri,
            "path": _uri_to_path(uri),
            "projectPath": payload.get("projectPath") or "",
            "source": payload.get("source") or source_name,
            "conversationId": payload.get("conversationId") or payload.get("conversation_id") or "",
            "diffId": payload.get("diffId") or payload.get("diff_id") or "",
            "edits": [],
            "sources": [],
            "pendingHydration": True,
        }
    result = await hydrate_agent_edit_document_state(payload, exclude_sid=source_sid)
    print(
        f"[agent_edit_review] file_edit review refresh uri={uri} source={payload.get('source') or ''} edits={_edit_count_from_projection(result)}",
        flush=True,
    )
    return {
        "ok": True,
        "uri": uri,
        "visibleCount": _edit_count_from_projection(result),
        "hydrate": result,
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
        _CACHE_BY_URI[uri] = payload
    else:
        edits = payload.get("edits")
        if isinstance(edits, list):
            for edit in cast(list[object], edits):
                if isinstance(edit, dict):
                    edit_map = cast(dict[str, object], edit)
                    edit_uri = _extract_uri(edit_map)
                    if edit_uri:
                        _CACHE_BY_URI[edit_uri] = payload
                        if not uri:
                            uri = edit_uri
        if uri:
            payload["uri"] = uri
    await _emit_editor_changed(payload)
    print(
        f"[agent_edit_review] publish uri={uri or ''} source={payload.get('source') or ''} edits={_edit_count_from_projection(payload)}",
        flush=True,
    )
    if _edit_count_from_projection(payload) > 0:
        await _emit_review_toast(payload)
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
    if uri:
        removed = 1 if _CACHE_BY_URI.pop(uri, None) is not None else 0
        await _emit_editor_changed({"ok": True, "uri": uri, "edits": [], "sources": [], "cleared": True})
    elif isinstance(data.get("uris"), list):
        removed = 0
        for raw_uri in cast(list[object], data["uris"]):
            if not isinstance(raw_uri, str):
                continue
            normalized = _normalize_uri(raw_uri)
            if not normalized:
                continue
            if _CACHE_BY_URI.pop(normalized, None) is not None:
                removed += 1
            await _emit_editor_changed({"ok": True, "uri": normalized, "edits": [], "sources": [], "cleared": True})
    else:
        removed = len(_CACHE_BY_URI)
        _CACHE_BY_URI.clear()
        await _emit_editor_changed({"ok": True, "edits": [], "sources": [], "cleared": True})
    return {"ok": True, "removed": removed, "uri": uri}


async def handle_sidebar_agent_edits_list_request(
    data: dict[str, object],
    *,
    source_name: str,
) -> JsonMap:
    del source_name
    uri = _extract_uri(data)
    if uri:
        item = _CACHE_BY_URI.get(uri)
        return {"ok": True, "items": [dict(item)] if item else [], "count": 1 if item else 0}
    items = [dict(item) for item in _CACHE_BY_URI.values()]
    return {"ok": True, "items": items, "count": len(items)}


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
