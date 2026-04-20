# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import anyio
import socketio

from ..core_read import emit_diff_changed, init_watcher, push_save_ack
from ..core_write import BaseMismatchError, _get_file_meta, write_full
from ..diff_helper import invalidate_diff_cache
from ..explorer_helper import _normalize_rel_path, mark_draft_cache_dirty, mark_git_cache_dirty
from ..stores import _history_store


async def request_editor_save_snapshot(
    ns: socketio.AsyncNamespace,
    request_id: str,
    *,
    waiting: dict[str, asyncio.Future[Any]],
    timeout_s: float = 3.0,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    future: asyncio.Future[Any] = loop.create_future()
    waiting[request_id] = future
    try:
        await ns.emit(
            "editor:save_snapshot_request",
            {"requestId": request_id, "requestedAtMs": int(time.time() * 1000)},
            room="file_editor_cm6",
        )
        payload = await asyncio.wait_for(future, timeout=timeout_s)
        return payload if isinstance(payload, dict) else {}
    finally:
        waiting.pop(request_id, None)


def resolve_editor_save_snapshot_response(
    waiting: dict[str, asyncio.Future[Any]],
    data: Any,
) -> bool:
    if not isinstance(data, dict):
        return False
    request_id = data.get("requestId") or data.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        return False
    future = waiting.get(request_id)
    if future and not future.done():
        future.set_result(data)
        return True
    return False


async def handle_editor_mirror(
    sid: str,
    data: Any,
    *,
    active_project: Callable[[], Optional[str]],
    normalize_abs_path: Callable[[str], Optional[str]],
    is_under_project: Callable[[str, str], bool],
    runtime_meta: Callable[[], dict[str, Any]],
    emit_to_room: Callable[[str, dict[str, Any]], Awaitable[None]],
    notify_draft_state_changed: Callable[[str], None],
) -> None:
    project = active_project()
    if not project:
        return

    payload = data if isinstance(data, dict) else {}
    path = normalize_abs_path(str(payload.get("path", "")))
    if not path or not is_under_project(project, path):
        return

    content = payload.get("content")
    if not isinstance(content, str):
        return

    base_sha256 = payload.get("base_sha256")
    if not isinstance(base_sha256, str) or len(base_sha256) != 64:
        base_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()

    meta = runtime_meta()
    entry = _history_store.upsert_cached_document(
        project_path=project,
        file_path=path,
        content=content,
        base_sha256=base_sha256,
        run_id=meta["run_id"],
        shell_id=meta["shell_id"],
        shell_run_id=meta["shell_run_id"],
        launcher_pid=meta["launcher_pid"],
        worker_pid=meta["worker_pid"],
    )
    is_unsaved = bool(entry.get("unsaved"))

    await emit_to_room(
        "editor:mirror",
        {
            "path": path,
            "content": content,
            "base_sha256": base_sha256,
            "content_sha256": entry.get("content_sha256"),
            "unsaved": is_unsaved,
            "source_client": sid,
        },
    )
    await emit_to_room(
        "editor:cache_state",
        {
            "path": path,
            "state": "mid_session" if is_unsaved else "clean",
            "unsaved": is_unsaved,
            "reason": "mirror",
            "content_sha256": entry.get("content_sha256"),
            "source_client": sid,
        },
    )
    try:
        notify_draft_state_changed(project)
    except Exception:
        pass


async def handle_editor_save_request(
    sid: str,
    data: Any,
    *,
    active_project: Callable[[], Optional[str]],
    normalize_abs_path: Callable[[str], Optional[str]],
    is_under_project: Callable[[str, str], bool],
    request_snapshot: Callable[[str], Awaitable[dict[str, Any]]],
    emit_to_room: Callable[[str, dict[str, Any]], Awaitable[None]],
    notify_draft_state_changed: Callable[[str], None],
    record_save_sha: Callable[[str, str], None],
) -> dict[str, Any]:
    payload = data if isinstance(data, dict) else {}

    project = active_project()
    if not project:
        return {"ok": False, "error": "no_active_project"}

    request_id = payload.get("request_id") or payload.get("requestId") or f"save_{int(time.time() * 1000)}_{str(sid)[-6:]}"
    if not isinstance(request_id, str) or not request_id:
        request_id = f"save_{int(time.time() * 1000)}_{str(sid)[-6:]}"

    try:
        snapshot = await request_snapshot(request_id)
    except asyncio.TimeoutError:
        return {"ok": False, "error": "save_snapshot_timeout"}
    except Exception as exc:
        return {"ok": False, "error": f"save_snapshot_failed: {exc}"}

    snapshot_error = snapshot.get("error")
    if isinstance(snapshot_error, str) and snapshot_error:
        return {"ok": False, "error": snapshot_error}

    raw_path = payload.get("target_path") or snapshot.get("path") or payload.get("path")
    if not raw_path:
        session_state = _history_store.get_session_state()
        raw_path = session_state.get("currentPath")

    abs_path = normalize_abs_path(str(raw_path) if raw_path else "")
    if not abs_path:
        return {"ok": False, "error": "missing_path"}
    if not is_under_project(project, abs_path):
        return {"ok": False, "error": "outside_project"}

    root_path = Path(project)
    try:
        init_watcher(root_path)
    except Exception:
        pass

    content = snapshot.get("content", "")
    if not isinstance(content, str):
        return {"ok": False, "error": "invalid_content"}

    base_sha256 = payload.get("base_sha256")
    if not isinstance(base_sha256, str) or len(base_sha256) != 64:
        base_sha256 = snapshot.get("base_sha256")
    if not isinstance(base_sha256, str) or len(base_sha256) != 64:
        base_sha256 = None
    if payload.get("force"):
        base_sha256 = None

    try:
        rel_path = _normalize_rel_path(root_path, str(abs_path))
    except Exception:
        return {"ok": False, "error": "path_invalid"}

    orig_mode: int | None = None
    abs_path_obj = Path(abs_path)
    if abs_path_obj.exists():
        try:
            orig_mode = abs_path_obj.stat().st_mode & 0o777
        except OSError:
            orig_mode = None

    try:
        await anyio.to_thread.run_sync(
            lambda: write_full(
                root_path,
                rel_path,
                content,
                base_sha256=base_sha256,
                mode=orig_mode,
            )
        )
    except BaseMismatchError as exc:
        return {"ok": False, "error": "BASE_MISMATCH", "current_meta": exc.current_meta}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    file_meta = _get_file_meta(Path(abs_path))
    file_meta = {**file_meta, "path": abs_path}
    save_sha = file_meta.get("sha256")
    if isinstance(save_sha, str) and save_sha:
        record_save_sha(abs_path, save_sha)

    _history_store.clear_cached_document(project, abs_path)
    _history_store.prune_clean_drafts(project)

    mark_git_cache_dirty(root_path)
    mark_draft_cache_dirty(root_path)

    try:
        notify_draft_state_changed(project)
    except Exception:
        pass

    op_id = payload.get("op_id") or f"editor_save_{int(time.time())}"
    client_id = payload.get("client_id") or "editor"
    push_save_ack(str(rel_path), str(op_id), str(client_id), file_meta)
    emit_diff_changed(str(rel_path), file_meta.get("sha256"))
    invalidate_diff_cache(root_path, str(rel_path))

    await emit_to_room(
        "editor:cache_state",
        {
            "path": abs_path,
            "state": "clean",
            "unsaved": False,
            "reason": "save",
            "content_sha256": file_meta.get("sha256"),
            "source_client": sid,
        },
    )

    return {"ok": True, "data": file_meta}
