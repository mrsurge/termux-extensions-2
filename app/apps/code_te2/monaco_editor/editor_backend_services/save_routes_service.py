# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from fastapi import Response

from .protocols import EditorLike

JsonMap = dict[str, object]


class SaveValidationError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...
    def upsert_cached_document(
        self,
        *,
        project_path: str,
        file_path: str,
        content: str,
        base_sha256: str,
        run_id: str,
        shell_id: str,
        shell_run_id: str,
        launcher_pid: int,
        worker_pid: int,
    ) -> dict[str, object]: ...
    def prune_clean_drafts(self, project_path: str) -> int: ...


class RuntimeMetaProvider(Protocol):
    def __call__(self) -> Mapping[str, object]: ...


class BroadcastCacheStateFn(Protocol):
    def __call__(
        self,
        project_path: str | None,
        file_path: str | None,
        *,
        state: str,
        unsaved: bool,
        cache_entry: dict[str, object] | None = None,
        reason: str = "update",
    ) -> None: ...


class GetCombinedDiffsAsyncFn(Protocol):
    def __call__(self, project_root: Path, file_path: str, current_content: str) -> Awaitable[list[object]]: ...


class NormalizeRelPathFn(Protocol):
    def __call__(self, project_root: Path, raw_path: str) -> str: ...


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


class BaseMismatchMetaLike(Protocol):
    current_meta: dict[str, object]


def _to_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except Exception:
            return default
    return default


async def write_editor_buffer_to_disk(
    *,
    client_id: str,
    op_id: str | None,
    get_active_editor: Callable[[], EditorLike | None],
    get_active_editors: Callable[[], list[EditorLike]],
    get_current_file: Callable[[], str | None],
    get_current_file_sha256: Callable[[], str | None],
    set_current_file: Callable[[str, str | None], None],
    get_project_root: Callable[[], Path],
    history_store: HistoryStoreLike,
    normalize_rel_path: NormalizeRelPathFn,
    write_full: WriteFullFn,
    push_save_ack: Callable[[str, str, str, dict[str, object]], None],
    emit_diff_changed: Callable[[str, str], None],
    mark_git_cache_dirty: Callable[[Path], None],
    invalidate_diff_cache: Callable[[Path, str], None],
    runtime_meta: RuntimeMetaProvider,
    broadcast_cache_state: BroadcastCacheStateFn,
    notify_draft_state_changed: Callable[[str], None],
    get_combined_diffs_async: GetCombinedDiffsAsyncFn,
) -> JsonMap:
    editor = get_active_editor()
    if not editor:
        raise SaveValidationError("Editor not ready")

    current_file_obj = get_current_file()
    current_file = current_file_obj if isinstance(current_file_obj, str) else ""
    if not current_file:
        raise SaveValidationError("No file is currently open")

    content = editor.value or ""
    base_sha256 = get_current_file_sha256()
    op_identifier = op_id or f"op_{int(time.time() * 1000)}"
    project_root = get_project_root()
    print(f"[SAVE] Attempting path={current_file!r} len={len(content)} base={base_sha256}", file=sys.stderr)

    rel_path = normalize_rel_path(project_root, current_file)
    target_path = project_root.joinpath(rel_path).resolve()
    orig_mode: int | None = None
    if target_path.exists() and target_path.is_file():
        try:
            orig_mode = target_path.stat().st_mode & 0o777
            print(f"[SAVE] Preserving mode {oct(orig_mode)} for {current_file!r}", file=sys.stderr)
        except OSError:
            orig_mode = None

    file_meta = await asyncio.to_thread(
        lambda: write_full(
            project_root,
            str(rel_path),
            content,
            base_sha256=base_sha256,
            mode=orig_mode,
        )
    )

    push_save_ack(str(rel_path), op_identifier, client_id, file_meta)
    sha_obj = file_meta.get("sha256")
    sha = sha_obj if isinstance(sha_obj, str) else ""
    emit_diff_changed(str(rel_path), sha)
    mark_git_cache_dirty(project_root)
    invalidate_diff_cache(project_root, str(rel_path))
    set_current_file(current_file, sha)

    project_path = history_store.get_active_project()
    if project_path and current_file:
        meta = runtime_meta()
        cache_entry = history_store.upsert_cached_document(
            project_path=project_path,
            file_path=current_file,
            content=content,
            base_sha256=sha,
            run_id=str(meta.get("run_id", "")),
            shell_id=str(meta.get("shell_id", "")),
            shell_run_id=str(meta.get("shell_run_id", "")),
            launcher_pid=_to_int(meta.get("launcher_pid", 0), 0),
            worker_pid=_to_int(meta.get("worker_pid", 0), 0),
        )
        broadcast_cache_state(
            project_path,
            current_file,
            state="clean",
            unsaved=bool(cache_entry.get("unsaved", False)),
            cache_entry=cache_entry,
            reason="save",
        )
        removed_clean = history_store.prune_clean_drafts(project_path)
        if removed_clean:
            try:
                notify_draft_state_changed(project_path)
            except Exception:
                pass

    try:
        hunks = await get_combined_diffs_async(project_root, current_file, content)
        for ed in get_active_editors():
            try:
                ed.set_diff_decorations(hunks)
            except Exception:
                pass
    except Exception as exc:
        print(f"[SAVE] Failed to refresh diffs: {exc}", file=sys.stderr)

    print(f"[SAVE] Success path={current_file!r} sha={sha}", file=sys.stderr)
    return file_meta


async def handle_save_current_file(
    data: Mapping[str, object],
    *,
    write_editor_buffer_to_disk_fn: Callable[[str, str | None, str | None], Awaitable[JsonMap]],
    history_store: HistoryStoreLike,
    get_current_file: Callable[[], str | None],
    get_current_file_sha256: Callable[[], str | None],
    base_mismatch_error_type: type[Exception],
    get_active_editor: Callable[[], EditorLike | None],
    get_cached_editor_content: Callable[[EditorLike | None], str],
    get_preferences: Callable[[], dict[str, object]],
    nicegui_broadcast: Callable[[str, str, dict[str, object]], None],
) -> JsonMap | Response:
    client_id_obj = data.get("client_id", "unknown")
    client_id = client_id_obj if isinstance(client_id_obj, str) and client_id_obj else "unknown"
    nicegui_client_id_obj = data.get("nicegui_client_id")
    nicegui_client_id = nicegui_client_id_obj if isinstance(nicegui_client_id_obj, str) else None
    op_id_obj = data.get("op_id")
    op_id = op_id_obj if isinstance(op_id_obj, str) else None

    current_file = get_current_file()
    base_snapshot = get_current_file_sha256()
    try:
        file_meta = await write_editor_buffer_to_disk_fn(client_id, op_id, nicegui_client_id)

        try:
            editor_prefs_obj = get_preferences().get("editor", {})
            editor_prefs = cast(dict[str, object], editor_prefs_obj if isinstance(editor_prefs_obj, dict) else {})
            if bool(editor_prefs.get("autoSave", False)):
                project_path = history_store.get_active_project()
                if project_path and current_file:
                    try:
                        editor = get_active_editor()
                        content = get_cached_editor_content(editor) if editor else None
                    except Exception:
                        content = None
                    if content is None:
                        try:
                            content = Path(current_file).read_text(encoding="utf-8", errors="replace")
                        except Exception:
                            content = ""

                    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest() if content else ""
                    proj_norm = str(Path(project_path).expanduser().resolve(strict=False))
                    sha_obj = file_meta.get("sha256")
                    base_sha = sha_obj if isinstance(sha_obj, str) else ""
                    nicegui_broadcast(
                        proj_norm,
                        "explorer.autosave.content",
                        {
                            "path": str(current_file),
                            "project_path": proj_norm,
                            "content": content,
                            "base_sha256": base_sha,
                            "content_sha256": content_hash or "",
                            "source_client": nicegui_client_id,
                        },
                    )
        except Exception:
            pass

        return {"ok": True, "data": file_meta}
    except SaveValidationError as exc:
        return {"ok": False, "error": exc.message}
    except base_mismatch_error_type as exc_obj:
        exc = cast(BaseMismatchMetaLike, cast(object, exc_obj))
        actual = exc.current_meta.get("sha256") if getattr(exc, "current_meta", None) else "unknown"
        print(
            f"[SAVE] BASE_MISMATCH path={current_file!r} expected={base_snapshot} actual={actual}",
            file=sys.stderr,
        )
        return Response(
            status_code=409,
            content=json.dumps({"ok": False, "error": "BASE_MISMATCH", "data": {"current": exc.current_meta}}),
            media_type="application/json",
        )
    except Exception as exc:
        print(f"[SAVE] ERROR path={current_file!r} error={exc}", file=sys.stderr)
        return {"ok": False, "error": str(exc)}
