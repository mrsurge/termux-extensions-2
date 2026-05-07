# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import time
from pathlib import Path
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

from ... import core_read as _core_read
from ... import core_write as _core_write
from ...explorer.services import file_ops as _file_ops
from ...core_read import emit_diff_changed, init_watcher
from ...core_write import BaseMismatchError
from ...diff_helper import invalidate_diff_cache
from ...explorer.services.file_ops import mark_draft_cache_dirty, mark_git_cache_dirty
from ...stores import get_history_store
from .contracts import EmitToRoomFn, JsonMap, RuntimeMeta
from .payload_utils import as_payload_dict, get_opt_str, get_str


class PushSaveAckFn(Protocol):
    def __call__(self, path: str, op_id: str, client_id: str, meta: dict[str, object]) -> None: ...


class GetFileMetaFn(Protocol):
    def __call__(self, path: Path) -> dict[str, object]: ...


class WriteFullFn(Protocol):
    def __call__(
        self,
        project_root: Path,
        path: str,
        content: str,
        *,
        base_sha256: str | None = None,
        mode: int | None = None,
    ) -> dict[str, object]: ...


class NormalizeRelPathFn(Protocol):
    def __call__(self, project_root: Path, raw_path: str) -> str: ...


_push_save_ack = cast(PushSaveAckFn, getattr(_core_read, "push_save_ack"))
_get_file_meta = cast(GetFileMetaFn, getattr(_core_write, "_get_file_meta"))
_write_full = cast(WriteFullFn, getattr(_core_write, "write_full"))
_normalize_rel_path = cast(NormalizeRelPathFn, getattr(_file_ops, "_normalize_rel_path"))
_history_store = get_history_store()


def _typed_get_file_meta(path: Path) -> JsonMap:
    raw = cast(dict[object, object], _get_file_meta(path))
    out: JsonMap = {}
    for raw_key, raw_value in raw.items():
        if isinstance(raw_key, str):
            out[raw_key] = raw_value
    return out


def _typed_write_full(
    project_root: Path,
    rel_path: str,
    content: str,
    *,
    base_sha256: str | None,
    mode: int | None,
) -> JsonMap:
    raw = cast(
        dict[object, object],
        _write_full(
        project_root,
        rel_path,
        content,
        base_sha256=base_sha256,
        mode=mode,
    ),
    )
    out: JsonMap = {}
    for raw_key, raw_value in raw.items():
        if isinstance(raw_key, str):
            out[raw_key] = raw_value
    return out


def resolve_editor_save_snapshot_response(
    waiting: dict[str, asyncio.Future[JsonMap]],
    data: object,
) -> bool:
    payload = as_payload_dict(data)
    if not payload:
        return False
    request_id = get_opt_str(payload, "requestId") or get_opt_str(payload, "request_id")
    if not request_id:
        return False
    future = waiting.get(request_id)
    if future and not future.done():
        future.set_result(payload)
        return True
    return False


async def handle_editor_mirror(
    sid: str,
    data: object,
    *,
    active_project: Callable[[], str | None],
    normalize_abs_path: Callable[[str], str | None],
    is_under_project: Callable[[str, str], bool],
    runtime_meta: Callable[[], RuntimeMeta],
    emit_to_room: EmitToRoomFn,
    notify_draft_state_changed: Callable[[str], None],
) -> None:
    project = active_project()
    if not project:
        return

    payload = as_payload_dict(data)
    path = normalize_abs_path(get_str(payload, "path", ""))
    if not path or not is_under_project(project, path):
        return

    content_obj = payload.get("content")
    if not isinstance(content_obj, str):
        return
    content = content_obj

    content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    base_sha256_obj = payload.get("base_sha256")
    if isinstance(base_sha256_obj, str) and len(base_sha256_obj) == 64:
        base_sha256 = base_sha256_obj
    else:
        base_sha256 = content_sha256
    try:
        current_meta = _typed_get_file_meta(Path(path))
        current_sha = current_meta.get("sha256")
        if isinstance(current_sha, str) and current_sha == content_sha256:
            base_sha256 = current_sha
    except Exception:
        pass

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
            "base_sha256": entry.get("base_sha256"),
            "source_client": sid,
        },
    )
    try:
        notify_draft_state_changed(project)
    except Exception:
        pass


async def handle_editor_save_request(
    sid: str,
    data: object,
    *,
    active_project: Callable[[], str | None],
    normalize_abs_path: Callable[[str], str | None],
    is_under_project: Callable[[str, str], bool],
    request_snapshot: Callable[[str], Awaitable[JsonMap]],
    emit_to_room: EmitToRoomFn,
    notify_draft_state_changed: Callable[[str], None],
    record_save_sha: Callable[[str, str], None],
) -> JsonMap:
    payload = as_payload_dict(data)

    project = active_project()
    if not project:
        return {"ok": False, "error": "no_active_project"}

    request_id = get_opt_str(payload, "request_id") or get_opt_str(payload, "requestId")
    if not request_id:
        request_id = f"save_{int(time.time() * 1000)}_{str(sid)[-6:]}"

    try:
        snapshot = await request_snapshot(request_id)
    except asyncio.TimeoutError:
        return {"ok": False, "error": "save_snapshot_timeout"}
    except Exception as exc:
        return {"ok": False, "error": f"save_snapshot_failed: {exc}"}

    snapshot_error = get_opt_str(snapshot, "error")
    if snapshot_error:
        return {"ok": False, "error": snapshot_error}

    raw_path = (
        get_opt_str(payload, "target_path")
        or get_opt_str(snapshot, "path")
        or get_opt_str(payload, "path")
    )
    if not raw_path:
        session_state = _history_store.get_session_state()
        maybe_current = session_state.get("currentPath")
        raw_path = maybe_current if isinstance(maybe_current, str) else None

    abs_path = normalize_abs_path(raw_path or "")
    if not abs_path:
        return {"ok": False, "error": "missing_path"}
    if not is_under_project(project, abs_path):
        return {"ok": False, "error": "outside_project"}

    root_path = Path(project)
    try:
        init_watcher(root_path)
    except Exception:
        pass

    content_obj = snapshot.get("content", "")
    if not isinstance(content_obj, str):
        return {"ok": False, "error": "invalid_content"}
    content = content_obj

    # The editor-owned snapshot is authoritative for save conflict checks.
    # Host state can lag or reflect draft content hashes, so it is only fallback.
    base_sha256 = get_opt_str(snapshot, "base_sha256")
    if not (isinstance(base_sha256, str) and len(base_sha256) == 64):
        base_sha256 = get_opt_str(payload, "base_sha256")
    if not (isinstance(base_sha256, str) and len(base_sha256) == 64):
        base_sha256 = None
    if payload.get("force") is True:
        base_sha256 = None

    try:
        rel_path = _normalize_rel_path(root_path, abs_path)
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
        await asyncio.to_thread(
            _typed_write_full,
            root_path,
            str(rel_path),
            content,
            base_sha256=base_sha256,
            mode=orig_mode,
        )
    except BaseMismatchError as exc:
        return {"ok": False, "error": "BASE_MISMATCH", "current_meta": exc.current_meta}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    file_meta = _typed_get_file_meta(Path(abs_path))
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

    op_id = get_opt_str(payload, "op_id") or f"editor_save_{int(time.time())}"
    client_id = get_opt_str(payload, "client_id") or "editor"
    _push_save_ack(str(rel_path), op_id, client_id, file_meta)
    emit_diff_changed(str(rel_path), save_sha if isinstance(save_sha, str) else "")
    invalidate_diff_cache(root_path, str(rel_path))

    await emit_to_room(
        "editor:cache_state",
        {
            "path": abs_path,
            "state": "clean",
            "unsaved": False,
            "reason": "save",
            "content_sha256": file_meta.get("sha256"),
            "base_sha256": file_meta.get("sha256"),
            "source_client": sid,
        },
    )

    return {"ok": True, "data": file_meta}
