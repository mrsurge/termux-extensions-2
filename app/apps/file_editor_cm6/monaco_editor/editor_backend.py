# app/apps/file_editor_cm6/monaco_editor/editor_backend.py

import sys
import os
import hashlib
import asyncio
from pathlib import Path
from typing import Optional, cast

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response
from starlette.responses import FileResponse

# --- Local Imports ---
# Import stores as singletons from the new stores module
from app.apps.file_editor_cm6.stores import _history_store, _preferences_store
from app.apps.file_editor_cm6.preferences_store import ALLOWED_FONT_SCALES
# Import helpers
from app.apps.file_editor_cm6.explorer.services.file_ops import get_project_root, _normalize_rel_path, mark_git_cache_dirty
from app.apps.file_editor_cm6.core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe, unsubscribe
from app.apps.file_editor_cm6.core_write import write_full, BaseMismatchError
from app.apps.file_editor_cm6.diff_helper import invalidate_diff_cache, collect_diff
from app.apps.file_editor_cm6.draft_diff_helper import compute_draft_diff
from .editor_backend_services.contracts import RuntimeMeta
from .editor_backend_services.protocols import EditorLike
from .editor_backend_services.view_settings_service import (
    handle_set_font_scale as _handle_set_font_scale,
    handle_set_view_settings as _handle_set_view_settings,
)
from .editor_backend_services.editor_routes_service import (
    build_view_state_dict as _build_view_state_dict_service,
    handle_jump_to_line as _handle_jump_to_line,
    handle_search_open as _handle_search_open,
    handle_set_minimap_mode as _handle_set_minimap_mode,
    handle_set_read_only as _handle_set_read_only,
    handle_toggle_color_picker as _handle_toggle_color_picker,
)
from .editor_backend_services.cache_routes_service import (
    handle_check_cache as _handle_check_cache,
    handle_debug_editor_state as _handle_debug_editor_state,
    handle_discard_draft as _handle_discard_draft,
    handle_get_cache_state as _handle_get_cache_state,
    handle_refresh_cache_state as _handle_refresh_cache_state,
    handle_refresh_diffs as _handle_refresh_diffs,
    handle_set_editor_content as _handle_set_editor_content,
)
from .editor_backend_services.cache_runtime_service import (
    apply_watcher_replace as _apply_watcher_replace_service,
    broadcast_cache_state as _broadcast_cache_state_service,
    build_cache_state_payload as _build_cache_state_payload_service,
    get_combined_diffs as _get_combined_diffs_service,
    get_combined_diffs_async as _get_combined_diffs_async_service,
    schedule_diff_refresh as _schedule_diff_refresh_service,
)
from .editor_backend_services.save_routes_service import (
    handle_save_current_file as _handle_save_current_file,
    write_editor_buffer_to_disk as _write_editor_buffer_to_disk_service,
)
from .editor_backend_services.preferences_routes_service import (
    handle_update_preference as _handle_update_preference,
)


# --- FastAPI Router ---
editor_router = APIRouter(prefix="/editor")

# --- Global State ---
_active_editor: EditorLike | None = None
_active_editor_client_id: str | None = None
_active_editors: dict[str, EditorLike] = {}
_current_file_path = None
_current_file_sha256 = None
_current_watcher_token = None # Track active watcher subscription
_edit_tracker_subscription = None
_cache_persist_timer: asyncio.TimerHandle | None = None
# When multiple clients are connected, cache persistence must use the editor that
# actually triggered the change (not whichever client connected last).
_cache_persist_source_editor: EditorLike | None = None
_cache_persist_source_client_id = None

# Live (non-disk) mirroring of the active buffer between connected clients.
# NOTE: Mirror emission logic has been moved to codemirror.js to avoid
# NiceGUI component updates that can reset editor state. The iframe now
# emits cm6_mirror_out postMessages which main.js relays to the explorer bus.
_cache_persist_debounce_ms = 1000  # 1 second debounce

# Sprint B: per-URI throttle for TE2 draft diagnostics publishing.
_android_draft_diag_sig: dict[str, str] = {}

# Sprint E: in-memory cache for TE2 draft diagnostics replay.
# key: "<effective_project_root>::<uri>" -> (cache_key, diagnostics)
_android_draft_diag_cache: dict[str, tuple[str, list[dict[str, object]]]] = {}
_nicegui_loop: Optional[asyncio.AbstractEventLoop] = None
_nicegui_loop_thread: Optional[int] = None

# Live draft propagation: suppress local on_change persistence briefly after applying
# a remote draft update (prevents feedback loops).
_suppress_on_change_until: float = 0.0

# When True, live mirroring between clients uses incremental ChangeSet deltas
# (cm_delta → multicast → applyDelta) instead of full-text setEditorValue().
_incremental_mirror_active: bool = False

# Workspace diagnostics scans (repo-wide, best-effort).
_pyright_scan_tasks: dict[str, asyncio.Task[object]] = {}

# --- Constants ---
RECONNECT_TIMEOUT_S = 1200.0
RESPONSE_TIMEOUT_S = 1200.0  # Time allowed for page to render before client is deleted

THEME_MAP = {
    'one-dark': 'oneDark',
    'termux': 'consoleDark',
    'github-dark': 'githubDark',
    'github-light': 'githubLight',
    'vscode-dark': 'vscodeDark',
    'vscode-light': 'vscodeLight',
    'xcode-dark': 'xcodeDark',
    'xcode-light': 'xcodeLight',
    'solarized-dark': 'solarizedDark',
    'solarized-light': 'solarizedLight',
    'nord': 'nord',
    'dracula': 'dracula',
    'okaidia': 'okaidia',
    'sublime': 'sublime',
    'androidstudio': 'androidstudio',
    'darcula': 'darcula',
    'basic-dark': 'basicDark',
    'basic-light': 'basicLight',
}

def _current_diff_base(project_path: Optional[str]) -> str:
    return _history_store.get_diff_base(project_path) if project_path else 'HEAD'


def _resolve_theme_preference(theme_key: Optional[str]) -> str:
    """Map stored preference theme id to the CodeMirror theme name or raise."""
    pref_path = getattr(_preferences_store, 'path', None)
    location_hint = f" ({pref_path})" if pref_path else ''

    if not theme_key:
        raise RuntimeError(f"Preference file{location_hint} is missing required 'editor.theme'")

    try:
        return THEME_MAP[theme_key]
    except KeyError as exc:
        raise RuntimeError(
            f"Preference file{location_hint} references unsupported theme '{theme_key}'. "
            "Add it to THEME_MAP or update the preference file."
        ) from exc


def _resolve_font_scale(scale_value: object | None) -> float:
    """Validate and return the stored font scale, raising if it's missing/invalid."""
    pref_path = getattr(_preferences_store, 'path', None)
    location_hint = f" ({pref_path})" if pref_path else ''

    if scale_value is None:
        raise RuntimeError(f"Preference file{location_hint} is missing required 'editor.fontScale'")

    if not isinstance(scale_value, (str, int, float)):
        raise RuntimeError(
            f"Preference file{location_hint} has non-numeric fontScale value: {scale_value!r}"
        )

    try:
        numeric = float(scale_value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            f"Preference file{location_hint} has non-numeric fontScale value: {scale_value!r}"
        ) from exc

    if numeric not in ALLOWED_FONT_SCALES:
        allowed_str = ', '.join(str(v) for v in sorted(ALLOWED_FONT_SCALES))
        raise RuntimeError(
            f"Preference file{location_hint} references unsupported fontScale {numeric}. "
            f"Allowed values: {allowed_str}"
        )

    return numeric


# --- State Accessors ---
def get_active_editor() -> EditorLike | None:
    return _active_editor


def get_active_editors() -> list[EditorLike]:
    if _active_editors:
        return list(_active_editors.values())
    return [_active_editor] if _active_editor else []


def _register_editor_for_client(*, client_id: str, editor: EditorLike) -> None:
    global _active_editor, _active_editor_client_id
    _active_editors[client_id] = editor
    _active_editor = editor
    _active_editor_client_id = client_id


def _unregister_editor_for_client(*, client_id: str) -> None:
    global _active_editor, _active_editor_client_id
    removed = _active_editors.pop(client_id, None)
    if removed is None:
        return
    if _active_editor_client_id == client_id:
        if _active_editors:
            new_id, new_editor = next(iter(_active_editors.items()))
            _active_editor = new_editor
            _active_editor_client_id = new_id
        else:
            _active_editor = None
            _active_editor_client_id = None

def set_current_file(path: str, sha256: str | None = None):
    global _current_file_path, _current_file_sha256
    _current_file_path = path
    _current_file_sha256 = sha256

def get_current_file():
    return _current_file_path

def get_current_file_sha256():
    return _current_file_sha256


# --- Helpers ---
def _get_runtime_metadata() -> RuntimeMeta:
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }


def _get_editor_preferences() -> dict[str, object]:
    prefs_obj: object = _preferences_store.get_preferences()
    if not isinstance(prefs_obj, dict):
        return {}
    prefs = cast(dict[str, object], prefs_obj)
    editor_obj = prefs.get("editor", {})
    return cast(dict[str, object], editor_obj if isinstance(editor_obj, dict) else {})


# --- Cache Persistence ---
def _get_cached_editor_content(editor: EditorLike | None) -> str:
    if editor is None:
        return ""
    return getattr(editor, "_cached_content", editor.value or "")


def _build_cache_state_payload(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict[str, object] | None = None,
    reason: str = 'update',
) -> dict[str, object]:
    return _build_cache_state_payload_service(
        project_path,
        file_path,
        state=state,
        unsaved=unsaved,
        cache_entry=cache_entry,
        reason=reason,
        preferences_store=_preferences_store,
        normalize_rel_path=_normalize_rel_path,
    )


def _broadcast_cache_state(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict[str, object] | None = None,
    reason: str = 'update',
) -> None:
    _broadcast_cache_state_service(
        project_path,
        file_path,
        state=state,
        unsaved=unsaved,
        cache_entry=cache_entry,
        reason=reason,
        preferences_store=_preferences_store,
        normalize_rel_path=_normalize_rel_path,
        get_active_editors=get_active_editors,
    )


def _apply_watcher_replace(
    *,
    path: str,
    content: str,
    sha256: str | None,
    project_path: str | None,
    reason: str = 'watcher_replace',
):
    """Apply content delivered by the file watcher and invalidate stale cache entries.

    Returns True if content was actually applied to the editor.
    Returns False if the event was ignored (e.g., disk matches draft base).
    """
    from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
        notify_draft_state_changed,
    )

    return _apply_watcher_replace_service(
        path=path,
        content=content,
        sha256=sha256,
        project_path=project_path,
        reason=reason,
        get_active_editors=get_active_editors,
        get_active_editor=get_active_editor,
        get_cached_editor_content=_get_cached_editor_content,
        set_current_file=set_current_file,
        history_store=_history_store,
        notify_draft_state_changed=notify_draft_state_changed,
        broadcast_cache_state_fn=_broadcast_cache_state,
    )


def _get_combined_diffs(project_root: Path, file_path: str, current_content: str) -> list[object]:
    """
    Calculate combined diff hunks (Git and/or Draft) based on current preferences.
    Returns a unified list of hunks to be sent to the frontend.
    """
    return _get_combined_diffs_service(
        project_root,
        file_path,
        current_content,
        preferences_store=_preferences_store,
        normalize_rel_path=_normalize_rel_path,
        current_diff_base=_current_diff_base,
        collect_diff=collect_diff,
        compute_draft_diff=compute_draft_diff,
    )


async def _get_combined_diffs_async(project_root: Path, file_path: str, current_content: str) -> list[object]:
    return await _get_combined_diffs_async_service(
        project_root,
        file_path,
        current_content,
        preferences_store=_preferences_store,
        normalize_rel_path=_normalize_rel_path,
        current_diff_base=_current_diff_base,
        collect_diff=collect_diff,
        compute_draft_diff=compute_draft_diff,
    )


def _schedule_diff_refresh(
    project_root: Path,
    file_path: str,
    current_content: str,
    editor: EditorLike | None,
    reason: str,
) -> None:
    _schedule_diff_refresh_service(
        project_root,
        file_path,
        current_content,
        editor,
        reason,
        get_running_loop=asyncio.get_running_loop,
        get_nicegui_loop=lambda: _nicegui_loop,
        get_active_editors=get_active_editors,
        get_combined_diffs_async_fn=_get_combined_diffs_async,
    )


def _persist_to_cache_debounced():
    """Debounced cache persistence called on editor change."""
    global _cache_persist_timer
    _cache_persist_timer = None
    
    global _cache_persist_source_editor, _cache_persist_source_client_id
    editor = _cache_persist_source_editor or get_active_editor()
    source_client_id = _cache_persist_source_client_id
    _cache_persist_source_editor = None
    _cache_persist_source_client_id = None
    current_file = get_current_file()
    current_sha = get_current_file_sha256()
    
    if not editor or not current_file:
        return
    
    project_path = _history_store.get_active_project()
    if not project_path:
        return
    
    editor_prefs = _get_editor_preferences()
    auto_save_enabled = bool(editor_prefs.get('autoSave', False))
    
    current_content = _get_cached_editor_content(editor)
    current_hash = hashlib.sha256(current_content.encode('utf-8')).hexdigest() if current_content else ''
    unsaved_flag = (current_hash != (current_sha or '')) or (not current_sha and bool(current_content))
    print(f"[SESSION_CACHE] snapshot path={current_file} len={len(current_content)} sha256={current_hash or '0'*64}", file=sys.stderr)
    
    if auto_save_enabled:
        # When autosave is enabled, do not write session cache sidecars.
        _broadcast_cache_state(
            project_path,
            current_file,
            state='mid_session' if unsaved_flag else 'clean',
            unsaved=unsaved_flag,
            cache_entry=None,
            reason='autosave_pending' if unsaved_flag else 'autosave_clean',
        )
        try:
            project_root = get_project_root()
            _schedule_diff_refresh(project_root, current_file, current_content, editor, "persist_autosave")
        except Exception as e:
            print(f"[PERSIST] Failed to refresh diffs (autosave mode): {e}", file=sys.stderr)
        return
    
    # Collect runtime metadata for session cache persistence
    runtime_meta = _get_runtime_metadata()
    
    cache_entry = _history_store.upsert_cached_document(
        project_path=project_path,
        file_path=current_file,
        content=current_content,
        base_sha256=current_sha or '',
        run_id=runtime_meta["run_id"],
        shell_id=runtime_meta["shell_id"],
        shell_run_id=runtime_meta["shell_run_id"],
        launcher_pid=runtime_meta["launcher_pid"],
        worker_pid=runtime_meta["worker_pid"],
    )
    
    print(f"[SESSION_CACHE] Persisted draft for {current_file} (Unsaved: {cache_entry.get('unsaved', False)})", file=sys.stderr)

    # Live draft propagation (SSOT active file only): broadcast the draft buffer to other clients.
    try:
        state = _history_store.get_session_state() or {}
        ssot_current = state.get("currentPath")
        if isinstance(ssot_current, str) and ssot_current.strip() and str(ssot_current) == str(current_file):
            from app.apps.file_editor_cm6.explorer.transport.rpc_emit import (
                emit_project_explorer_rpc_notification,
            )

            proj_norm = str(Path(project_path).expanduser().resolve(strict=False))
            source_client = source_client_id

            payload = {
                "path": str(current_file),
                "project_path": proj_norm,
                "content": current_content,
                "base_sha256": current_sha or '',
                "content_sha256": current_hash or '',
                "source_client": source_client,
            }
            asyncio.create_task(
                emit_project_explorer_rpc_notification(
                    proj_norm,
                    "explorer.draft.content",
                    payload,
                )
            )
    except Exception:
        pass

    # Notify explorer of draft state change (debounced)
    try:
        from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
            notify_draft_state_changed,
        )
        notify_draft_state_changed(project_path)
    except Exception as e:
        print(f"[SESSION_CACHE] Failed to notify explorer of draft change: {e}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        current_file,
        state='mid_session',
        unsaved=bool(cache_entry.get('unsaved', False)),
        cache_entry=cache_entry,
        reason='persist',
    )

    # Refresh diffs for live draft markers (and git inline diffs if enabled).
    # This is debounced via the draft persist timer, so it should remain stable
    # while still keeping diff decorations up to date.
    try:
        prefs = _get_editor_preferences()
        if prefs.get('showInlineDiffs', False) or prefs.get('showDraftDiffs', False):
            project_root = get_project_root()
            _schedule_diff_refresh(project_root, current_file, current_content, editor, "persist")
    except Exception as e:
        print(f"[PERSIST] Failed to refresh diffs: {e}", file=sys.stderr)

def _cancel_cache_persist_timer():
    """Cancel any pending cache persist timer."""
    global _cache_persist_timer
    if _cache_persist_timer:
        try:
            _cache_persist_timer.cancel()
        except Exception:
            pass
        _cache_persist_timer = None


def _schedule_cache_persist():
    """Schedule debounced cache persistence."""
    global _cache_persist_timer

    _cancel_cache_persist_timer()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = _nicegui_loop
    if loop is None:
        return
    _cache_persist_timer = loop.call_later(
        _cache_persist_debounce_ms / 1000,
        _persist_to_cache_debounced,
    )


def _schedule_cache_persist_from(*, editor: EditorLike, source_client_id: str | None) -> None:
    """Schedule cache persistence using the editor that actually changed."""
    global _cache_persist_source_editor, _cache_persist_source_client_id
    _cache_persist_source_editor = editor
    _cache_persist_source_client_id = source_client_id
    _schedule_cache_persist()


def _persist_active_draft_immediately(reason: str = 'switch') -> bool:
    """
    Flush the currently active draft to disk immediately.
    Used when switching files so unsaved buffers are not lost before the timer fires.
    """
    editor = get_active_editor()
    current_file = get_current_file()
    current_sha = get_current_file_sha256()
    if not editor or not current_file:
        return False
    project_path = _history_store.get_active_project()
    if not project_path:
        return False

    editor_prefs = _get_editor_preferences()
    if editor_prefs.get('autoSave', False):
        return False

    current_content = _get_cached_editor_content(editor)
    current_hash = hashlib.sha256(current_content.encode('utf-8')).hexdigest() if current_content else ''
    unsaved_flag = (current_hash != (current_sha or '')) or (not current_sha and bool(current_content))
    if not unsaved_flag:
        return False

    runtime_meta = _get_runtime_metadata()
    cache_entry = _history_store.upsert_cached_document(
        project_path=project_path,
        file_path=current_file,
        content=current_content,
        base_sha256=current_sha or '',
        run_id=runtime_meta["run_id"],
        shell_id=runtime_meta["shell_id"],
        shell_run_id=runtime_meta["shell_run_id"],
        launcher_pid=runtime_meta["launcher_pid"],
        worker_pid=runtime_meta["worker_pid"],
    )

    print(f"[SESSION_CACHE][IMMEDIATE] Persisted draft for {current_file} (Unsaved: {cache_entry.get('unsaved', False)})", file=sys.stderr)

    # Keep explorer draft accents in sync for immediate persists (file switch).
    try:
        from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
            notify_draft_state_changed,
        )
        notify_draft_state_changed(project_path)
    except Exception as exc:
        print(f"[SESSION_CACHE][IMMEDIATE] Failed to notify explorer: {exc}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        current_file,
        state='mid_session',
        unsaved=bool(cache_entry.get('unsaved', False)),
        cache_entry=cache_entry,
        reason=reason,
    )

    try:
        project_root = get_project_root()
        _schedule_diff_refresh(project_root, current_file, current_content, editor, f"persist_{reason}")
    except Exception as exc:
        print(f"[PERSIST][{reason}] Failed to refresh diffs: {exc}", file=sys.stderr)
    return True

# --- Editor API Endpoints ---

@editor_router.post('/discard_draft')
async def discard_draft(data: dict[str, object] = Body(...)):
    from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
        notify_draft_state_changed,
    )

    return await _handle_discard_draft(
        data,
        history_store=_history_store,
        get_current_file=get_current_file,
        notify_draft_state_changed=notify_draft_state_changed,
        broadcast_cache_state=_broadcast_cache_state,
    )

@editor_router.post('/refresh_cache_state')
async def refresh_cache_state():
    return await _handle_refresh_cache_state(
        history_store=_history_store,
        get_current_file=get_current_file,
        runtime_meta=_get_runtime_metadata,
        get_active_editors=get_active_editors,
        broadcast_cache_state=_broadcast_cache_state,
    )

@editor_router.post('/check_cache')
async def check_cache(data: dict[str, object] = Body(...)):
    return await _handle_check_cache(data, history_store=_history_store)


def _set_suppress_on_change_until(value: float) -> None:
    global _suppress_on_change_until
    _suppress_on_change_until = value


def _get_watcher_token() -> object | None:
    return _current_watcher_token


def _set_watcher_token(token: object | None) -> None:
    global _current_watcher_token
    _current_watcher_token = token


def _unsubscribe_token(token: object) -> None:
    unsubscribe(str(token))

@editor_router.post('/set_content')
async def set_editor_content(data: dict[str, object] = Body(...)):
    return await _handle_set_editor_content(
        data,
        history_store=_history_store,
        preferences_store=_preferences_store,
        get_active_editor=get_active_editor,
        get_active_editors=get_active_editors,
        get_current_file=get_current_file,
        set_current_file=set_current_file,
        persist_active_draft_immediately=_persist_active_draft_immediately,
        cancel_cache_persist_timer=_cancel_cache_persist_timer,
        get_cached_editor_content=_get_cached_editor_content,
        set_suppress_on_change_until=_set_suppress_on_change_until,
        broadcast_cache_state=_broadcast_cache_state,
        schedule_diff_refresh=_schedule_diff_refresh,
        apply_watcher_replace=_apply_watcher_replace,
        current_diff_base=_current_diff_base,
        normalize_rel_path=_normalize_rel_path,
        collect_diff=collect_diff,
        get_combined_diffs_async=_get_combined_diffs_async,
        resolve_font_scale=_resolve_font_scale,
        get_project_root=get_project_root,
        init_watcher=init_watcher,
        subscribe=subscribe,
        unsubscribe=_unsubscribe_token,
        get_watcher_token=_get_watcher_token,
        set_watcher_token=_set_watcher_token,
    )

@editor_router.post('/refresh_diffs')
async def refresh_diffs(data: dict[str, object] = Body(...)):
    return await _handle_refresh_diffs(
        data,
        history_store=_history_store,
        get_active_editors=get_active_editors,
        get_project_root=get_project_root,
        normalize_rel_path=_normalize_rel_path,
        collect_diff=collect_diff,
        current_diff_base=_current_diff_base,
    )

@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict[str, object] = Body(...)):
    editors = get_active_editors()
    primary = get_active_editor()
    return _handle_jump_to_line(data, editors=editors, primary=primary)

@editor_router.post('/search/open')
async def editor_search_open(data: dict[str, object] = Body(...)):
    """Open the CodeMirror search panel when user presses Ctrl+F."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404, 
            detail="Editor not initialized. Open a file first."
        )
    
    try:
        return _handle_search_open(editor)
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to open search panel: {str(e)}"
        )

@editor_router.post('/color_picker/toggle')
async def editor_toggle_color_picker(data: dict[str, object] = Body(...)):
    """Toggle CSS color picker extension."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404,
            detail="Editor not initialized. Open a file first."
        )
    
    try:
        return _handle_toggle_color_picker(editor, data)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to toggle color picker: {str(e)}"
        )

@editor_router.post('/read_only/set')
async def editor_set_read_only(data: dict[str, object] = Body(...)):
    """Set editor read-only mode."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404,
            detail="Editor not initialized. Open a file first."
        )
    
    try:
        return _handle_set_read_only(editor, data)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to set read-only mode: {str(e)}"
        )

@editor_router.post('/minimap/mode')
async def editor_minimap_mode(data: dict[str, object] = Body(...)):
    """Set the minimap mode for the current editor."""
    editor = get_active_editor()
    if not editor:
        raise HTTPException(status_code=404, detail='Editor not initialized')
    try:
        return _handle_set_minimap_mode(editor, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to set minimap mode: {e}')


# --- Helper Function for View State ---
def _get_view_state_dict() -> dict[str, object]:
    return _build_view_state_dict_service(
        preferences_store=_preferences_store,
        active_project=_history_store.get_active_project,
        project_root=get_project_root,
        get_lsp_state_payload=_history_store.get_lsp_state_payload,
    )


@editor_router.get('/view_state')
async def get_view_state():
    """Return current editor view settings for frontend display (menu checkmarks)."""
    return {"ok": True, "data": _get_view_state_dict()}


@editor_router.post('/update_preference')
async def update_preference(data: dict[str, object] = Body(...)):
    def _collect_diff(project_root: Path, rel_path: str, base_ref: str) -> dict[str, object]:
        return collect_diff(project_root, rel_path, base_ref=base_ref)

    def _emit_preferences_changed(
        project_path: str,
        key: str,
        value: object,
        view_state: dict[str, object],
        preferences: dict[str, object],
        source_client: str | None,
    ) -> None:
        from app.apps.file_editor_cm6.explorer.transport.rpc_emit import (
            emit_project_explorer_rpc_notification,
        )

        payload = {
            "project_path": project_path,
            "key": key,
            "value": value,
            "view_state": view_state,
            "preferences": preferences,
            "source_client": source_client,
        }
        asyncio.create_task(
            emit_project_explorer_rpc_notification(
                project_path,
                "explorer.editor.prefs.changed",
                payload,
            )
        )
        try:
            from app.apps.file_editor_cm6.monaco_editor.editor_ws import editor_runtime_emit_room_event

            asyncio.create_task(
                editor_runtime_emit_room_event(
                    "editor:prefs_changed",
                    payload,
                )
            )
        except Exception:
            pass
        try:
            from app.apps.file_editor_cm6.ui_ipc.rpc_contract import (
                UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED,
            )
            from app.apps.file_editor_cm6.ui_ipc.ui_ipc_ws import (
                emit_ui_ipc_rpc_notification,
            )

            asyncio.create_task(
                emit_ui_ipc_rpc_notification(
                    UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED,
                    payload,
                )
            )
        except Exception:
            pass

    return await _handle_update_preference(
        data,
        editors=get_active_editors(),
        preferences_store=_preferences_store,
        history_store=_history_store,
        get_project_root=get_project_root,
        get_current_file=get_current_file,
        resolve_font_scale=_resolve_font_scale,
        normalize_rel_path=_normalize_rel_path,
        collect_diff=_collect_diff,
        current_diff_base=_current_diff_base,
        broadcast_cache_state=_broadcast_cache_state,
        refresh_active_diffs=_refresh_active_diffs,
        build_view_state_dict=_get_view_state_dict,
        theme_map=THEME_MAP,
        emit_preferences_changed=_emit_preferences_changed,
    )


@editor_router.get('/cache_state')
def get_cache_state(project: str | None = Query(None), path: str | None = Query(None)):
    return _handle_get_cache_state(
        history_store=_history_store,
        runtime_meta=_get_runtime_metadata,
        get_current_file=get_current_file,
        project=project,
        path=path,
    )

@editor_router.get('/debug/state')
def debug_editor_state():
    return _handle_debug_editor_state(
        get_active_editor=get_active_editor,
        get_current_file=get_current_file,
    )


async def _write_editor_buffer_to_disk(*, client_id: str, op_id: str | None) -> dict[str, object]:
    from app.apps.file_editor_cm6.explorer.services.runtime_notifications import (
        notify_draft_state_changed,
    )

    return await _write_editor_buffer_to_disk_service(
        client_id=client_id,
        op_id=op_id,
        get_active_editor=get_active_editor,
        get_active_editors=get_active_editors,
        get_current_file=get_current_file,
        get_current_file_sha256=get_current_file_sha256,
        set_current_file=set_current_file,
        get_project_root=get_project_root,
        history_store=_history_store,
        normalize_rel_path=_normalize_rel_path,
        write_full=write_full,
        init_watcher=init_watcher,
        push_save_ack=push_save_ack,
        emit_diff_changed=emit_diff_changed,
        mark_git_cache_dirty=mark_git_cache_dirty,
        invalidate_diff_cache=invalidate_diff_cache,
        runtime_meta=_get_runtime_metadata,
        broadcast_cache_state=_broadcast_cache_state,
        notify_draft_state_changed=notify_draft_state_changed,
        get_combined_diffs_async=_get_combined_diffs_async,
    )

@editor_router.post('/save')
async def save_current_file(data: dict[str, object] = Body(...)):
    def _broadcast_to_explorer(project_norm: str, method: str, params: dict[str, object]) -> None:
        from app.apps.file_editor_cm6.explorer.transport.rpc_emit import (
            emit_project_explorer_rpc_notification,
        )

        asyncio.create_task(
            emit_project_explorer_rpc_notification(project_norm, method, params)
        )

    async def _write_wrapper(client_id: str, op_id: str | None, _nicegui_client_id: str | None) -> dict[str, object]:
        return await _write_editor_buffer_to_disk(client_id=client_id, op_id=op_id)

    return await _handle_save_current_file(
        data,
        write_editor_buffer_to_disk_fn=_write_wrapper,
        history_store=_history_store,
        get_current_file=get_current_file,
        get_current_file_sha256=get_current_file_sha256,
        base_mismatch_error_type=BaseMismatchError,
        get_active_editor=get_active_editor,
        get_cached_editor_content=_get_cached_editor_content,
        get_preferences=_preferences_store.get_preferences,
        nicegui_broadcast=_broadcast_to_explorer,
    )


@editor_router.post('/set_view_settings')
async def set_view_settings(data: dict[str, object] = Body(...)):
    return _handle_set_view_settings(
        data,
        get_active_editor=get_active_editor,
        update_editor_preferences=lambda updates: _preferences_store.update_preferences(editor=updates),
        active_project=_history_store.get_active_project,
        project_root=get_project_root,
        normalize_rel_path=_normalize_rel_path,
        collect_diff=collect_diff,
        current_diff_base=_current_diff_base,
        resolve_theme_preference=_resolve_theme_preference,
    )

@editor_router.post('/set_font_scale')
async def set_font_scale_endpoint(data: dict[str, object] = Body(...)):
    return _handle_set_font_scale(
        data,
        get_active_editor=get_active_editor,
        resolve_font_scale=_resolve_font_scale,
        update_editor_preferences=lambda updates: _preferences_store.update_preferences(editor=updates),
    )


def register_monaco_editor_routes(fastapi_app, mount_path: str = "/ui") -> None:
    """Register Monaco static asset routes for the inline host editor runtime."""
    app_pkg_root = Path(__file__).resolve().parents[3]
    vendored_monaco = app_pkg_root / "static" / "vendor" / "monaco-editor-core"
    vscode_monaco_esm_dir = vendored_monaco / "esm"
    esm_ok = vscode_monaco_esm_dir.exists()
    vscode_monaco_lang_dir = vendored_monaco / "te2-lang"
    lang_ok = vscode_monaco_lang_dir.exists()

    async def _serve_static_with_css_shim(base_dir: Path, file_path: str, raw: str | None):
        base = base_dir.resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        if target.suffix == ".css" and raw == "1":
            return FileResponse(str(target), media_type="text/css")
        if target.suffix == ".css":
            shim = """
// Auto-generated CSS module shim (TE2 / VSCode Monaco ESM)
const url = new URL(import.meta.url);
url.searchParams.set('raw', '1');
const href = url.toString();
const id = 'te2-css:' + href;
if (!document.querySelector(`link[data-te2-css="${id}"]`)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.te2Css = id;
  document.head.appendChild(link);
}
export default href;
""".lstrip()
            return Response(shim, media_type="application/javascript")
        return FileResponse(str(target))

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/esm/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_esm(file_path: str, raw: str | None = None):
        if not esm_ok:
            return Response("monaco esm not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_esm_dir, file_path, raw)

    @fastapi_app.api_route(
        f"{mount_path}/monaco_vscode/lang/{{file_path:path}}",
        methods=["GET", "HEAD"],
        include_in_schema=False,
    )
    async def _serve_monaco_vscode_lang(file_path: str, raw: str | None = None):
        if not lang_ok:
            return Response("te2-lang not built; run `worktrees/vscode-te2-diff/build_monaco_te2.sh`", status_code=404)
        return await _serve_static_with_css_shim(vscode_monaco_lang_dir, file_path, raw)

    @fastapi_app.get(mount_path + "/monaco_editor/themes/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_theme_json(file_path: str):
        base = Path(__file__).with_name("themes").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    cs_ext_themes = Path.home() / ".config" / "code-server" / "extensions"

    @fastapi_app.get(mount_path + "/monaco_editor/cs_themes/{ext_id}/{theme_file:path}", include_in_schema=False)
    async def _serve_cs_extension_theme(ext_id: str, theme_file: str):
        base = (cs_ext_themes / ext_id / "themes").resolve()
        target = (base / theme_file).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target), media_type="application/json")

    vendored_themes_dir = Path(__file__).with_name("themes") / "vendored"

    @fastapi_app.get(mount_path + "/monaco_editor/available_themes", include_in_schema=False)
    async def _available_themes():
        import json as _json

        themes: list[dict[str, object]] = []
        if vendored_themes_dir.is_dir():
            for vendor_dir in sorted(vendored_themes_dir.iterdir()):
                idx_file = vendor_dir / "theme_index.json"
                if not idx_file.is_file():
                    continue
                try:
                    idx_obj = cast(object, _json.loads(idx_file.read_text("utf-8")))
                    if not isinstance(idx_obj, dict):
                        continue
                    idx = cast(dict[str, object], idx_obj)
                    vendored_list_obj = idx.get("vendored", [])
                    vendored_list = vendored_list_obj if isinstance(vendored_list_obj, list) else []
                    if not isinstance(vendored_list, list):
                        continue
                    for theme_item_obj in vendored_list:
                        if not isinstance(theme_item_obj, dict):
                            continue
                        theme_id = theme_item_obj.get("id")
                        theme_label = theme_item_obj.get("label")
                        theme_file = theme_item_obj.get("file")
                        if not isinstance(theme_id, str) or not isinstance(theme_label, str) or not isinstance(theme_file, str):
                            continue
                        source_label_obj = idx.get("source")
                        source_label = source_label_obj if isinstance(source_label_obj, str) else vendor_dir.name
                        themes.append(
                            {
                                "id": theme_id,
                                "label": theme_label,
                                "uiTheme": theme_item_obj.get("uiTheme", "vs-dark"),
                                "source": "vendored",
                                "sourceLabel": source_label,
                                "serveUrl": f"monaco_editor/themes/vendored/{vendor_dir.name}/{theme_file}",
                            }
                        )
                except Exception:
                    pass

        try:
            from ..extension_registry import get_extension_list

            exts = get_extension_list()
            if isinstance(exts, list):
                for ext_obj in exts:
                    if not isinstance(ext_obj, dict):
                        continue
                    ext_themes = ext_obj.get("themes", [])
                    if not isinstance(ext_themes, list) or not ext_themes:
                        continue
                    ext_id = ext_obj.get("id", "")
                    ext_path = ext_obj.get("path", "")
                    if not isinstance(ext_id, str) or not isinstance(ext_path, str) or not ext_id or not ext_path:
                        continue
                    for theme_obj in ext_themes:
                        if not isinstance(theme_obj, dict):
                            continue
                        raw_path = theme_obj.get("path", "")
                        if not isinstance(raw_path, str):
                            continue
                        fname = raw_path.rsplit("/", 1)[-1] if "/" in raw_path else raw_path
                        label_obj = theme_obj.get("label", fname)
                        label = label_obj if isinstance(label_obj, str) else fname
                        tid = label.lower().replace(" ", "-").replace("(", "").replace(")", "")
                        ext_dir_name = Path(ext_path).name
                        themes.append(
                            {
                                "id": f"ext:{ext_id}:{tid}",
                                "label": label,
                                "uiTheme": theme_obj.get("uiTheme", "vs-dark"),
                                "source": "extension",
                                "sourceLabel": ext_obj.get("display_name", ext_id),
                                "serveUrl": f"monaco_editor/cs_themes/{ext_dir_name}/{fname}",
                            }
                        )
        except Exception as exc:
            print(f"[themes] extension theme scan failed: {exc}", flush=True)

        return {"themes": themes}

    @fastapi_app.get(mount_path + "/monaco_editor/textmate/{file_path:path}", include_in_schema=False)
    async def _serve_monaco_editor_textmate(file_path: str):
        base = Path(__file__).with_name("textmate").resolve()
        target = (base / file_path).resolve()
        if not str(target).startswith(str(base) + "/") and target != base:
            return Response("not found", status_code=404, media_type="text/plain")
        if not target.exists() or not target.is_file():
            return Response("not found", status_code=404, media_type="text/plain")
        return FileResponse(str(target))

def _refresh_active_diffs():
    """Recalculate combined diffs for the current file based on latest preferences."""
    editor = get_active_editor()
    current_file = get_current_file()
    project_path = _history_store.get_active_project() or str(get_project_root())
    if not editor or not current_file or not project_path:
        return
    content = editor.value or ''
    try:
        _schedule_diff_refresh(Path(project_path).expanduser(), current_file, content, editor, "prefs")
    except Exception as exc:
        print(f"[PREFERENCE] Failed to refresh combined diffs: {exc}", file=sys.stderr)
