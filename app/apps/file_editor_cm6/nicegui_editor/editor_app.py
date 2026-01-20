# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

import json
import sys
import os
import hashlib
import threading
import time
import asyncio
import uuid
from pathlib import Path
from typing import Optional
import anyio

from nicegui import ui, app as nicegui_app, context
from fastapi import APIRouter, Body, HTTPException, Query, Response

# --- Local Imports ---
# Import stores as singletons from the new stores module
from app.apps.file_editor_cm6.stores import _history_store, _preferences_store
from app.apps.file_editor_cm6.preferences_store import ALLOWED_FONT_SCALES
# Import helpers
from app.apps.file_editor_cm6.explorer_helper import get_project_root, _normalize_rel_path, mark_git_cache_dirty
from app.apps.file_editor_cm6.core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe
from app.apps.file_editor_cm6.core_write import write_full, BaseMismatchError
from app.apps.file_editor_cm6.diff_helper import invalidate_diff_cache, collect_diff
from app.apps.file_editor_cm6.draft_diff_helper import compute_draft_diff
from app.apps.file_editor_cm6.android_lang.android_config import (
    collect_android_config,
    update_properties_file,
    update_build_gradle,
)


# --- FastAPI Router ---
editor_router = APIRouter(prefix="/editor")

# --- Global State ---
_active_editor = None
_active_editor_client_id: str | None = None
_active_editors: dict[str, object] = {}
_current_file_path = None
_current_file_sha256 = None
_current_watcher_token = None # Track active watcher subscription
_edit_tracker_subscription = None
_cache_persist_timer = None
# When multiple clients are connected, cache persistence must use the editor that
# actually triggered the change (not whichever client connected last).
_cache_persist_source_editor = None
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
_android_draft_diag_cache: dict[str, tuple[str, list[dict]]] = {}
_nicegui_loop: Optional[asyncio.AbstractEventLoop] = None
_nicegui_loop_thread: Optional[int] = None

# Live draft propagation: suppress local on_change persistence briefly after applying
# a remote draft update (prevents feedback loops).
_suppress_on_change_until: float = 0.0

# When True, live mirroring between clients uses incremental ChangeSet deltas
# (cm_delta → multicast → applyDelta) instead of full-text setEditorValue().
_incremental_mirror_active: bool = False

# Sprint E: guard expensive dependency index builds (no Gradle spam on every keystroke).
# key: "<effective_project_root>::<syncFingerprint>" -> started_at_ms
_android_dep_index_build_inflight: dict[str, int] = {}

# Sprint D: per-project lock for Android sync to prevent concurrent stomping.
_android_sync_locks: dict[str, asyncio.Lock] = {}

# Workspace diagnostics scans (repo-wide, best-effort).
_pyright_scan_tasks: dict[str, asyncio.Task] = {}

# Sprint F: broadcast "busy" signals for long-running Android LSP work (e.g., Gradle).
_lsp_busy_counts: dict[str, int] = {}
_lsp_busy_tasks: dict[str, dict] = {}

# --- Constants ---
RECONNECT_TIMEOUT_S = 1200.0

THEME_MAP = {
    'cm6-dark': 'basicDark',
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

# Map file extensions to LSP language identifiers
LSP_LANGUAGE_MAP = {
    '.py': 'python',
    '.pyw': 'python',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascriptreact',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.tsx': 'typescriptreact',
    '.c': 'c',
    '.h': 'cpp',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hh': 'cpp',
    '.hxx': 'cpp',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.go': 'go',
    '.rs': 'rust',
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


def _normalize_project_path_for_broadcast(project_path: str | Path) -> str:
    try:
        return str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        return str(project_path)


async def _broadcast_lsp_busy(*, project_path: str, payload: dict) -> None:
    try:
        from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager

        await _explorer_manager.broadcast(str(project_path), {"type": "lsp:busy", "payload": payload})
    except Exception:
        return


async def _lsp_busy_begin(*, project_path: str | Path, language_id: str, activity: str, detail: str = "") -> str:
    project_path_s = _normalize_project_path_for_broadcast(project_path)
    key = f"{project_path_s}::{language_id}"
    count = int(_lsp_busy_counts.get(key) or 0) + 1
    _lsp_busy_counts[key] = count

    task_id = uuid.uuid4().hex
    started_at_ms = int(time.time() * 1000)
    started_mono = time.monotonic()
    _lsp_busy_tasks[task_id] = {
        "project_path": project_path_s,
        "languageId": str(language_id),
        "activity": str(activity or "work"),
        "detail": str(detail or ""),
        "startedAtMs": started_at_ms,
        "startedMono": started_mono,
        "key": key,
    }

    await _broadcast_lsp_busy(
        project_path=project_path_s,
        payload={
            "taskId": task_id,
            "languageId": str(language_id),
            "busy": True,
            "activity": str(activity or "work"),
            "detail": str(detail or ""),
            "startedAtMs": started_at_ms,
        },
    )
    return task_id


async def _lsp_busy_end(*, token: str, ok: bool = True, error: str = "") -> None:
    try:
        task_id = str(token or "")
        if not task_id:
            return

        meta = _lsp_busy_tasks.pop(task_id, None)
        if not isinstance(meta, dict):
            return

        project_path = str(meta.get("project_path") or "")
        language_id = str(meta.get("languageId") or "")
        activity = str(meta.get("activity") or "")
        detail = str(meta.get("detail") or "")
        started_mono = float(meta.get("startedMono") or time.monotonic())
        duration_ms = max(0, int((time.monotonic() - started_mono) * 1000))

        # Decrement per-(project,language) busy count (best-effort).
        try:
            key = str(meta.get("key") or f"{project_path}::{language_id}")
            count = int(_lsp_busy_counts.get(key) or 0)
            if count <= 1:
                _lsp_busy_counts.pop(key, None)
            else:
                _lsp_busy_counts[key] = count - 1
        except Exception:
            pass

        await _broadcast_lsp_busy(
            project_path=project_path,
            payload={
                "taskId": task_id,
                "languageId": language_id,
                "busy": False,
                "activity": activity,
                "detail": detail,
                "ok": bool(ok),
                "error": str(error or ""),
                "durationMs": duration_ms,
            },
        )
        return
    except Exception:
        return


def _resolve_font_scale(scale_value: Optional[float]) -> float:
    """Validate and return the stored font scale, raising if it's missing/invalid."""
    pref_path = getattr(_preferences_store, 'path', None)
    location_hint = f" ({pref_path})" if pref_path else ''

    if scale_value is None:
        raise RuntimeError(f"Preference file{location_hint} is missing required 'editor.fontScale'")

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


class SaveValidationError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

# --- State Accessors ---
def get_active_editor():
    return _active_editor


def get_active_editors() -> list[object]:
    if _active_editors:
        return list(_active_editors.values())
    return [_active_editor] if _active_editor else []


def _register_editor_for_client(*, client_id: str, editor: object) -> None:
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

def set_current_file(path: str, sha256: str = None):
    global _current_file_path, _current_file_sha256
    _current_file_path = path
    _current_file_sha256 = sha256

def get_current_file():
    return _current_file_path

def get_current_file_sha256():
    return _current_file_sha256


def _should_use_lsp(project_root: Path | None, language_id: str) -> bool:
    """Determine whether LSP should be used for the given project and language.

    For now this is driven by a simple editor preference flag. In the future
    this can consult per-project configuration (see tmp7_PROJECT_LSP_CONFIG.md).
    """
    if project_root is None:
        return False

    project_path = str(project_root)
    if not _history_store.get_lsp_enabled(project_path):
        return False

    server_id = None
    if language_id == "python":
        server_id = "pyright"
    elif language_id in ("typescript", "typescriptreact", "javascript", "javascriptreact"):
        server_id = "typescript"
    elif language_id in ("c", "cpp"):
        server_id = "clangd"
    elif language_id == "kotlin":
        server_id = "kotlin"
    elif language_id == "kotlin-android":
        server_id = "kotlin-android"

    if server_id:
        return _history_store.get_lsp_server_enabled(project_path, server_id)

    return True


def _maybe_connect_lsp(editor, file_path: Path | None, project_root: Path | None) -> None:
    """Connect or disconnect the CM6 LSP client based on file/language.

    - If the file extension is mapped and LSP is enabled, connect the client.
    - Otherwise, ensure any existing LSP connection is torn down.
    """
    if editor is None or file_path is None or project_root is None:
        # No active document or project: best-effort disconnect
        try:
            if hasattr(editor, 'disconnect_lsp'):
                editor.disconnect_lsp()
        except Exception as exc:
            print(f"[LSP] Failed to disconnect LSP for null document: {exc}", file=sys.stderr)
        return

    language_id = LSP_LANGUAGE_MAP.get(file_path.suffix)
    if not language_id:
        # Unsupported extension: ensure any previous client is stopped
        try:
            if hasattr(editor, 'disconnect_lsp'):
                editor.disconnect_lsp()
        except Exception as exc:
            print(f"[LSP] Failed to disconnect LSP for unsupported type {file_path}: {exc}", file=sys.stderr)
        return

    # Special case: Kotlin files can use Android LSP instead of regular Kotlin LSP
    # if enableLspKotlinAndroid is set for this project.
    if language_id == "kotlin":
        try:
            project_path = str(project_root)
            if _history_store.get_lsp_server_enabled(project_path, "kotlin-android"):
                language_id = "kotlin-android"
                print(f"[LSP] Using Android Kotlin LSP for {file_path}", file=sys.stderr)
        except Exception:
            pass

    if not _should_use_lsp(project_root, language_id):
        # Preference gate disabled: disconnect if previously connected
        print(f"[LSP] Preference gate disabled for {language_id}", file=sys.stderr)
        try:
            if hasattr(editor, 'disconnect_lsp'):
                editor.disconnect_lsp()
        except Exception as exc:
            print(f"[LSP] Failed to disconnect LSP when disabled for {file_path}: {exc}", file=sys.stderr)
        return

    # Allow per-server project-root override (project-scoped via sidecar SSOT).
    effective_project_root = project_root
    try:
        project_path = str(project_root)
        server_id = None
        if language_id == "python":
            server_id = "pyright"
        elif language_id in ("typescript", "typescriptreact", "javascript", "javascriptreact"):
            server_id = "typescript"
        elif language_id in ("c", "cpp"):
            server_id = "clangd"
        elif language_id == "kotlin":
            server_id = "kotlin"
        elif language_id == "kotlin-android":
            server_id = "kotlin-android"

        if server_id:
            rel_root = _history_store.get_lsp_server_root_rel(project_path, server_id)
            if rel_root:
                candidate = (project_root / rel_root).expanduser().resolve(strict=False)
                if candidate.exists() and candidate.is_dir():
                    effective_project_root = candidate
    except Exception:
        effective_project_root = project_root

    pyright_mode = "root"
    if language_id == "python":
        try:
            pyright_mode = _history_store.get_lsp_pyright_config_mode(str(project_root))
        except Exception:
            pyright_mode = "root"

    # If a python worker registry exists and mode=workers, pick the most specific worker root.
    if language_id == "python" and pyright_mode == "workers":
        try:
            from app.apps.file_editor_cm6.python_lang.worker_registry import find_python_worker_for_file

            entry = find_python_worker_for_file(project_root, file_path)
            if entry and entry.root:
                effective_project_root = entry.root
        except Exception:
            pass

    # At this point we want LSP active for this document
    print(f"[LSP] Triggering connect_lsp: {language_id} / {effective_project_root} / {file_path}", file=sys.stderr)
    try:
        if hasattr(editor, 'connect_lsp'):
            editor.connect_lsp({
                'languageId': language_id,
                'projectRoot': str(effective_project_root),
                'filePath': str(file_path),
                'baseProjectRoot': str(project_root),
            })
        else:
            print("[LSP] connect_lsp() not available on editor; bundle may be outdated", file=sys.stderr)
    except Exception as exc:
        print(f"[LSP] Failed to connect LSP for {file_path} ({language_id}): {exc}", file=sys.stderr)

# --- Helpers ---
def _get_runtime_metadata() -> dict:
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }

# --- Cache Persistence ---
def _get_cached_editor_content(editor) -> str:
    return getattr(editor, '_cached_content', editor.value or '')


def _build_cache_state_payload(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict | None = None,
    reason: str = 'update',
) -> dict:
    resolved_path = str(file_path) if file_path else ''
    project_path = str(project_path) if project_path else None
    file_label = Path(resolved_path).name if resolved_path else 'Untitled'
    directory = str(Path(resolved_path).parent) if resolved_path else ''
    rel_path = None
    if project_path and resolved_path:
        try:
            rel_path = _normalize_rel_path(Path(project_path).expanduser(), resolved_path)
        except Exception:
            rel_path = None

    auto_save_enabled = None
    try:
        auto_save_enabled = bool(_preferences_store.get_preferences().get("editor", {}).get("autoSave", False))
    except Exception:
        auto_save_enabled = None

    payload = {
        "path": resolved_path or None,
        "project_path": project_path,
        "relative_path": rel_path,
        "file_label": file_label,
        "directory_label": rel_path or directory or None,
        "absolute_directory": directory or None,
        "state": state,
        "unsaved": bool(unsaved),
        "auto_save": auto_save_enabled,
        "reason": reason,
        "updated_at": (cache_entry or {}).get("updated_at"),
        "timestamp": time.time(),
        "content_sha256": (cache_entry or {}).get("content_sha256"),
        "base_sha256": (cache_entry or {}).get("base_sha256"),
        "run_id": (cache_entry or {}).get("run_id"),
        "shell_id": (cache_entry or {}).get("shell_id"),
        "shell_run_id": (cache_entry or {}).get("shell_run_id"),
    }
    # Drop None values to keep the payload compact
    return {k: v for k, v in payload.items() if v is not None}


def _broadcast_cache_state(
    project_path: str | None,
    file_path: str | None,
    *,
    state: str,
    unsaved: bool,
    cache_entry: dict | None = None,
    reason: str = 'update',
):
    editors = get_active_editors()
    if not editors or not file_path:
        return
    payload = _build_cache_state_payload(
        project_path,
        file_path,
        state=state,
        unsaved=unsaved,
        cache_entry=cache_entry,
        reason=reason,
    )
    for editor in editors:
        try:
            editor.run_method('emitCacheState', payload)
        except Exception as exc:
            print(f"[SESSION_CACHE] Failed to emit cache state: {exc}", file=sys.stderr)


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
    editors = get_active_editors()
    if not editors or not path:
        return False

    cache_entry = None
    external_change = False

    if project_path:
        cache_entry = _history_store.get_cached_document(project_path, path)

        # If we have a valid draft, check if the disk event is actually a conflict
        if cache_entry and cache_entry.get('unsaved'):
            base_sha = cache_entry.get('base_sha256')

            # 1. Disk matches the draft's base -> Ignore event (safe echo or init)
            if base_sha and sha256 and base_sha == sha256:
                print(f"[SESSION_CACHE] Ignoring watcher event for {path}; disk matches draft base", file=sys.stderr)
                return False

            # 2. Disk does NOT match base -> Genuine external edit
            if base_sha and sha256 and base_sha != sha256:
                print(f"[SESSION_CACHE] External edit detected for {path} (base={base_sha} disk={sha256}); clearing cached draft", file=sys.stderr)
                _history_store.clear_cached_document(project_path, path)
                cache_entry = None
                external_change = True
                # Notify explorer of draft state change
                try:
                    from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
                    notify_draft_state_changed(project_path)
                except Exception as e:
                    print(f"[WATCHER] Failed to notify explorer of draft change: {e}", file=sys.stderr)

    # If we reach here, we either had no draft, or we had a conflict and cleared it.
    # In both cases, the editor should accept the disk content.
    # Guard: if disk content is identical to the current editor buffer, don't
    # re-apply. Re-applying via set_value() can reset selection/scroll and looks
    # like the editor "refreshing" while the user is typing.
    try:
        same = False
        try:
            current = _get_cached_editor_content(get_active_editor())
            same = (current == content)
        except Exception:
            same = False
        if same:
            return False
    except Exception:
        pass

    for editor in editors:
        try:
            editor.set_value(content)
            editor._cached_content = content
        except Exception as exc:
            print(f"[WATCHER] Failed to apply content to editor: {exc}", file=sys.stderr)
    set_current_file(path, sha256)

    _broadcast_cache_state(
        project_path,
        path,
        state='clean',
        unsaved=False,
        cache_entry=cache_entry,
        reason='watcher_external' if external_change else reason,
    )

    if external_change:
        for editor in editors:
            try:
                editor.set_diff_decorations([])
            except Exception as err:
                print(f"[DIFF] Failed to clear decorations after external edit: {err}", file=sys.stderr)

    return True  # Content was applied to editor


def _get_combined_diffs(project_root: Path, file_path: str, current_content: str) -> list:
    """
    Calculate combined diff hunks (Git and/or Draft) based on current preferences.
    Returns a unified list of hunks to be sent to the frontend.
    """
    hunks = []
    prefs = _preferences_store.get_preferences().get('editor', {})
    
    # 1. Git Diffs (Show if enabled)
    if prefs.get('showInlineDiffs', False):
        try:
            rel = _normalize_rel_path(project_root, file_path)
            diff_data = collect_diff(project_root, rel, base_ref=_current_diff_base(str(project_root)))
            hunks.extend(diff_data.get('hunks', []))
        except Exception as e:
            print(f"[DIFF_HELPER] Failed to collect git diffs: {e}", file=sys.stderr)

    # 2. Draft Diffs (Show if enabled AND Autosave is OFF)
    if not prefs.get('autoSave', False) and prefs.get('showDraftDiffs', True):
        try:
            if Path(file_path).exists():
                disk_content = Path(file_path).read_text(encoding='utf-8', errors='replace')
                diff_data = compute_draft_diff(file_path, current_content, disk_content)
                hunks.extend(diff_data.get('hunks', []))
        except Exception as e:
            print(f"[DIFF_HELPER] Failed to compute draft diffs: {e}", file=sys.stderr)
            
    return hunks


async def _get_combined_diffs_async(project_root: Path, file_path: str, current_content: str) -> list:
    return await anyio.to_thread.run_sync(
        lambda: _get_combined_diffs(project_root, file_path, current_content)
    )


def _schedule_diff_refresh(project_root: Path, file_path: str, current_content: str, editor, reason: str) -> None:
    async def _run():
        try:
            hunks = await _get_combined_diffs_async(project_root, file_path, current_content)
            for ed in get_active_editors():
                try:
                    ed.set_diff_decorations(hunks)
                except Exception:
                    pass
        except Exception as e:
            print(f"[DIFF_REFRESH][{reason}] Failed: {e}", file=sys.stderr)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        loop.create_task(_run())
        return
    loop = _nicegui_loop
    if loop and loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(_run(), loop)
        except Exception as exc:
            print(f"[DIFF_REFRESH][{reason}] Schedule failed: {exc}", file=sys.stderr)


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
    
    editor_prefs = _preferences_store.get_preferences().get('editor', {})
    auto_save_enabled = editor_prefs.get('autoSave', False)
    
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
    runtime_meta = {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }
    
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
            from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager

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
            asyncio.create_task(_explorer_manager.broadcast(proj_norm, {"type": "draft:content", "payload": payload}))
    except Exception:
        pass

    # Notify explorer of draft state change (debounced)
    try:
        from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
        notify_draft_state_changed(project_path)
    except Exception as e:
        print(f"[SESSION_CACHE] Failed to notify explorer of draft change: {e}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        current_file,
        state='mid_session',
        unsaved=cache_entry.get('unsaved', False),
        cache_entry=cache_entry,
        reason='persist',
    )

    # Refresh diffs for live draft markers (and git inline diffs if enabled).
    # This is debounced via the draft persist timer, so it should remain stable
    # while still keeping diff decorations up to date.
    try:
        prefs = _preferences_store.get_preferences().get('editor', {})
        if prefs.get('showInlineDiffs', False) or prefs.get('showDraftDiffs', False):
            project_root = get_project_root()
            _schedule_diff_refresh(project_root, current_file, current_content, editor, "persist")
    except Exception as e:
        print(f"[PERSIST] Failed to refresh diffs: {e}", file=sys.stderr)

    # Sprint E: publish WARNING-level Android draft diagnostics (draft mode only).
    try:
        if Path(current_file).suffix in ('.kt', '.kts'):
            base_project_root = Path(project_path)
            base_project_path = str(base_project_root)
            if _history_store.get_lsp_enabled(base_project_path) and _history_store.get_lsp_server_enabled(base_project_path, 'kotlin-android'):
                cfg = _get_android_lsp_config(base_project_root)
                effective_project_root = base_project_root
                rel_root = str(cfg.get("rootRel") or "").strip()
                if rel_root:
                    candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
                    if candidate.exists() and candidate.is_dir():
                        effective_project_root = candidate

                uri = f"file://{current_file}"
                sig_key = f"{effective_project_root}::{uri}"
                sig = f"draft:{current_hash}"
                if _android_draft_diag_sig.get(sig_key) != sig:
                    _android_draft_diag_sig[sig_key] = sig

                    async def _publish_android_draft_diags_bg() -> None:
                        try:
                            from app.apps.file_editor_cm6.android_lang.android_sidecar import resolve_te2_android_sidecar_path
                            from app.apps.file_editor_cm6.android_lang.dependency_index import ensure_compiled_dependency_index
                            from app.apps.file_editor_cm6.android_lang.draft_diagnostics import build_draft_diagnostics
                            from app.apps.file_editor_cm6.android_lang.android_lsp_bridge import update_android_sidecar_for_project
                            from ..lsp_ws import publish_draft_diagnostics_to_client

                            sidecar_path = resolve_te2_android_sidecar_path(project_root=base_project_root)
                            if not sidecar_path.exists():
                                sidecar_path = await anyio.to_thread.run_sync(
                                    lambda: (
                                        lambda _cfg: update_android_sidecar_for_project(
                                            project_root=base_project_root,
                                            effective_project_root=effective_project_root,
                                            module=str((_cfg or {}).get('module') or 'app'),
                                            variant=str((_cfg or {}).get('variant') or 'GeckoDebug'),
                                        )
                                    )(
                                        _get_android_lsp_config(base_project_root)
                                    )
                                )

                            def _load_sidecar() -> dict:
                                try:
                                    if sidecar_path and Path(sidecar_path).exists():
                                        return json.loads(Path(sidecar_path).read_text(encoding='utf-8'))
                                except Exception:
                                    return {}
                                return {}

                            te2_sidecar = await anyio.to_thread.run_sync(_load_sidecar)

                            # Compute cache key (draft content + sync/index version).
                            sync_fp = str((te2_sidecar or {}).get('syncFingerprint') or '')
                            idx = (te2_sidecar or {}).get('dependencyIndex') or {}
                            idx_built = str(idx.get('builtAtMs') or '') if isinstance(idx, dict) else ''
                            cache_key = f"{sync_fp}|{idx_built}|{current_hash}"

                            cached = _android_draft_diag_cache.get(sig_key)
                            if cached and cached[0] == cache_key:
                                diags = cached[1]
                            else:
                                # Do NOT spawn Gradle here; build partial index only.
                                te2_sidecar = await anyio.to_thread.run_sync(
                                    lambda: ensure_compiled_dependency_index(
                                        sidecar_path=Path(sidecar_path),
                                        te2_sidecar=te2_sidecar or {},
                                        effective_project_root=effective_project_root,
                                        allow_gradle_resolve=False,
                                    )
                                )

                                diags = build_draft_diagnostics(te2_sidecar=te2_sidecar or {}, uri=uri, content=current_content)
                                _android_draft_diag_cache[sig_key] = (cache_key, diags)

                                # If no dependency index yet, kick off one build per syncFingerprint.
                                try:
                                    idx2 = (te2_sidecar or {}).get('dependencyIndex') or {}
                                    has_index = isinstance(idx2, dict) and bool(idx2.get('classes'))
                                    if not has_index:
                                        build_key = f"{effective_project_root}::{sync_fp}"
                                        now_ms = int(time.time() * 1000)
                                        started = _android_dep_index_build_inflight.get(build_key)
                                        if not started or (now_ms - int(started)) > 30_000:
                                            _android_dep_index_build_inflight[build_key] = now_ms

                                            async def _build_index_bg() -> None:
                                                busy_token = ""
                                                ok = True
                                                err = ""
                                                try:
                                                    busy_token = await _lsp_busy_begin(
                                                        project_path=base_project_root,
                                                        language_id="kotlin-android",
                                                        activity="gradle_dependency_index",
                                                        detail="Building dependency index (Gradle)…",
                                                    )
                                                    sidecar2 = await anyio.to_thread.run_sync(_load_sidecar)
                                                    await anyio.to_thread.run_sync(
                                                        lambda: ensure_compiled_dependency_index(
                                                            sidecar_path=Path(sidecar_path),
                                                            te2_sidecar=sidecar2 or {},
                                                            effective_project_root=effective_project_root,
                                                            allow_gradle_resolve=True,
                                                        )
                                                    )
                                                except Exception as exc:
                                                    ok = False
                                                    err = str(exc)
                                                finally:
                                                    try:
                                                        if busy_token:
                                                            await _lsp_busy_end(token=busy_token, ok=ok, error=err)
                                                    except Exception:
                                                        pass
                                                    try:
                                                        _android_dep_index_build_inflight.pop(build_key, None)
                                                    except Exception:
                                                        pass

                                            asyncio.create_task(_build_index_bg())
                                except Exception:
                                    pass

                            await publish_draft_diagnostics_to_client(
                                language_id='kotlin-android',
                                project_root=effective_project_root,
                                uri=uri,
                                draft_diagnostics=diags,
                                has_drafts=bool(cache_entry.get('unsaved', False)),
                            )
                        except Exception as exc:
                            print(f"[ANDROID DRAFT DIAGS] failed: {exc}", file=sys.stderr)

                    asyncio.create_task(_publish_android_draft_diags_bg())
    except Exception:
        pass

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
    _cache_persist_timer = ui.timer(
        _cache_persist_debounce_ms / 1000,
        _persist_to_cache_debounced,
        once=True
    )


def _schedule_cache_persist_from(*, editor: object, source_client_id: str | None) -> None:
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

    editor_prefs = _preferences_store.get_preferences().get('editor', {})
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
        from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
        notify_draft_state_changed(project_path)
    except Exception as exc:
        print(f"[SESSION_CACHE][IMMEDIATE] Failed to notify explorer: {exc}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        current_file,
        state='mid_session',
        unsaved=cache_entry.get('unsaved', False),
        cache_entry=cache_entry,
        reason=reason,
    )

    try:
        project_root = get_project_root()
        _schedule_diff_refresh(project_root, current_file, current_content, editor, f"persist_{reason}")
    except Exception as exc:
        print(f"[PERSIST][{reason}] Failed to refresh diffs: {exc}", file=sys.stderr)
    return True

# --- Edit Tracking ---
def enable_edit_tracking():
    global _edit_tracker_subscription
    from app.apps.file_editor_cm6 import edit_tracker
    
    def on_edit(event):
        if event.get('event') == 'edit_tracked':
            path = event.get('path')
            line = event.get('line', 1)
            print(f"[EDIT_TRACK] Edit detected: {path}:{line}", file=sys.stderr)
            ui.run_javascript(f'''
                fetch('/api/app/file_editor_cm6/editor/jump_to_line', {{
                    method: 'POST',
                    headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify({{path: {repr(path)}, line: {line}}})
                }});
            ''')
    
    _edit_tracker_subscription = edit_tracker.subscribe(on_edit)
    print(f"[EDIT_TRACK] Enabled automatic jump on edits", file=sys.stderr)

def disable_edit_tracking():
    global _edit_tracker_subscription
    if _edit_tracker_subscription:
        from app.apps.file_editor_cm6 import edit_tracker
        edit_tracker.unsubscribe(_edit_tracker_subscription)
        _edit_tracker_subscription = None
        print(f"[EDIT_TRACK] Disabled automatic jump on edits", file=sys.stderr)

# --- NiceGUI Page ---
@ui.page('/nc', reconnect_timeout=RECONNECT_TIMEOUT_S)
async def editor_page():
    global _nicegui_loop, _nicegui_loop_thread
    
    print(f"[EDITOR_APP] ==================== PAGE LOAD ====================", file=sys.stderr)
    try:
        _nicegui_loop = asyncio.get_running_loop()
        _nicegui_loop_thread = threading.get_ident()
    except RuntimeError:
        _nicegui_loop = None
        _nicegui_loop_thread = None
    
    # 1. Load Preferences and History
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    font_scale_pref = _resolve_font_scale(editor_prefs.get('fontScale'))
    
    # 2. Determine and Load Initial File
    # NOTE (Null Document Semantics):
    # - If there is no last_file for the active project, or it no longer
    #   exists on disk, the editor is created with an empty buffer and
    #   initial_path=None. In that mode:
    #     * No watcher subscription is created
    #     * No session sidecar entries are written
    #     * No MRU updates happen
    #   This acts as the "null document" / blank state for a project.
    project_path = _history_store.get_active_project()
    last_file = _history_store.get_last_file(project_path) if project_path else None
    
    initial_content = ''
    initial_language = 'text'
    initial_path = None
    initial_sha256 = None
    restored_state = None

    if last_file and Path(last_file).is_file():
        try:
            content_bytes = await anyio.to_thread.run_sync(lambda: Path(last_file).read_bytes())
            initial_content = content_bytes.decode('utf-8', errors='replace')
            initial_path = last_file
            initial_sha256 = hashlib.sha256(content_bytes).hexdigest()
            
            if last_file.endswith(('.py', '.pyw')): initial_language = 'python'
            elif last_file.endswith('.js'): initial_language = 'javascript'
            elif last_file.endswith('.ts'): initial_language = 'typescript'
            elif last_file.endswith('.c'): initial_language = 'c'
            elif last_file.endswith(('.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx')): initial_language = 'cpp'
            elif last_file.endswith(('.kt', '.kts')): initial_language = 'kotlin'
            elif last_file.endswith(('.html', '.htm')): initial_language = 'html'
            elif last_file.endswith('.css'): initial_language = 'css'
            elif last_file.endswith(('.json', '.webmanifest')): initial_language = 'json'
            elif last_file.endswith(('.md', '.mdx')): initial_language = 'markdown'
            elif last_file.endswith(('.sh', '.bash', '.zsh')): initial_language = 'shell'
            elif last_file.endswith(('.yml', '.yaml')): initial_language = 'yaml'
            
            print(f"[EDITOR_APP] Auto-loading last file: {last_file}", file=sys.stderr)
        except Exception as e:
            print(f"[EDITOR_APP] Failed to auto-load last file '{last_file}': {e}", file=sys.stderr)

    # 2b. Apply cached session content if available
    cached_was_restored = False
    cached_entry = None
    if project_path and initial_path:
        cached_entry = _history_store.get_cached_document(project_path, initial_path)
        # Only restore if entry exists AND is marked unsaved
        if cached_entry and isinstance(cached_entry.get('content'), str) and cached_entry.get('unsaved', False):
            runtime_meta = _get_runtime_metadata()
            cached_run = cached_entry.get('run_id', 'unknown')
            restored_state = 'mid_session' if cached_run == runtime_meta.get('run_id') else 'crashed'
            initial_content = cached_entry.get('content')
            initial_sha256 = cached_entry.get('base_sha256') or hashlib.sha256(initial_content.encode('utf-8')).hexdigest()
            cached_was_restored = True
            print(f"[EDITOR_APP] Restored cached session ({restored_state}) for {initial_path}", file=sys.stderr)

    # 3. Set up UI
    ui.add_head_html(f'''
    <script>
        window.NICEGUI_RECONNECT_TIMEOUT = {int(RECONNECT_TIMEOUT_S)};
        window.NICEGUI_CONTINUE_ON_DISCONNECT = true;
    </script>
    ''')

    ui.add_head_html('''
    <style>
      html, body, #q-app, .q-page-container, .q-page, .nicegui-content { margin:0 !important; padding:0 !important; height:100%; }
      body { overflow: hidden; }

      /* JetBrains Mono – editor-only mono font (served from /static) */
      @font-face {
        font-family: "EditorMono";
        src: url("/static/fonts/jetbrains/webfonts/JetBrainsMono-Regular.woff2") format("woff2");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: "EditorMono";
        src: url("/static/fonts/jetbrains/webfonts/JetBrainsMono-Bold.woff2") format("woff2");
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: "EditorMono";
        src: url("/static/fonts/jetbrains/webfonts/JetBrainsMono-Italic.woff2") format("woff2");
        font-weight: 400;
        font-style: italic;
        font-display: swap;
      }
      @font-face {
        font-family: "EditorMono";
        src: url("/static/fonts/jetbrains/webfonts/JetBrainsMono-BoldItalic.woff2") format("woff2");
        font-weight: 700;
        font-style: italic;
        font-display: swap;
      }

      /* Force CodeMirror + gutters to use the vendored mono, and disable faux bold */
      .cm-editor,
      .cm-content,
      .cm-gutters,
      .cm-tooltip,
      .cm-tooltip * {
        font-family: "EditorMono", "JetBrains Mono", monospace;
        font-synthesis: none;
        font-synthesis-weight: none;
        font-synthesis-style: none;
      }
    </style>
    ''')
    
    with ui.element('div').style('width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #0b0f1a; color: #e5e7eb; overflow: hidden;'):
        with ui.element('div').style('flex: 1; display: flex; flex-direction: column; overflow: hidden;').classes('editor-wrapper w-full h-full'):

            # 4. Create Editor with Auto-Loaded Content
            def _on_editor_change(event):
                global _suppress_on_change_until
                global _incremental_mirror_active
                # Use the authoritative backend value; event.value can lag during init.
                value = editor.value or ''
                print(
                    f"[ON_CHANGE] len={len(value)} sha={hashlib.sha256(value.encode('utf-8')).hexdigest() if value else '0'*64}",
                    file=sys.stderr,
                )
                editor._cached_content = value
                current_path = get_current_file()
                try:
                    editor.notify_parent('cm6-dirty-state', {
                        'path': current_path,
                        'timestamp': time.time(),
                    })
                except Exception as notify_err:
                    print(f"[ON_CHANGE] Failed to signal dirty state: {notify_err}", file=sys.stderr)
                auto_save_enabled = _preferences_store.get_preferences().get('editor', {}).get('autoSave', False)
                # If we just applied a remote draft update, don't persist/broadcast again.
                try:
                    if _suppress_on_change_until and time.time() < _suppress_on_change_until:
                        return
                except Exception:
                    pass


                # Identify the client that originated this change (if available).
                source_client_id = None
                try:
                    source_client_id = context.client.id
                except Exception:
                    source_client_id = None

                # Live mirror: push the updated buffer to all OTHER connected
                # NiceGUI clients (SSOT: only one file may be open).
                # Do not send back to the authoring client (prevents cursor/selection churn).
                if not _incremental_mirror_active:
                    try:
                        for cid, ed in list(_active_editors.items()):
                            if not cid or ed is None:
                                continue
                            if source_client_id and cid == source_client_id:
                                continue
                            try:
                                ed.run_method('setEditorValue', value)
                                ed._cached_content = value
                            except Exception:
                                pass
                    except Exception:
                        pass

                if auto_save_enabled:
                    _cancel_cache_persist_timer()
                    _persist_to_cache_debounced()
                else:
                    _schedule_cache_persist_from(editor=editor, source_client_id=source_client_id)
            
            # Debug: What are we passing to the editor?
            theme_from_prefs = editor_prefs.get('theme')
            theme_mapped = _resolve_theme_preference(theme_from_prefs)
            print(
                f"[EDITOR_APP] Theme loading: file={theme_from_prefs} -> mapped={theme_mapped}; fontScale={font_scale_pref}",
                file=sys.stderr,
            )
            
            # Determine initial scroll line from per-file storage in sidecar.
            # Falls back to global session state for legacy compatibility.
            initial_scroll_line = None
            try:
                if initial_path and project_path:
                    # Try per-file scroll line from sidecar (preferred)
                    scroll_line = _history_store.get_file_scroll_line(project_path, initial_path)
                    if scroll_line and isinstance(scroll_line, (int, float)) and float(scroll_line) > 1:
                        initial_scroll_line = float(scroll_line)
                        print(f"[EDITOR_APP] Using initial_scroll_line={initial_scroll_line} (from sidecar) for {initial_path}", file=sys.stderr)
                
                # Fallback to global session state for legacy/compat
                if initial_scroll_line is None:
                    session_state = _history_store.get_session_state()
                    session_path = session_state.get("currentPath")
                    scroll_line = session_state.get("scrollLine") or session_state.get("cursorLine")
                    if (
                        session_path
                        and scroll_line
                        and isinstance(scroll_line, (int, float))
                        and initial_path
                        and str(session_path) == str(initial_path)
                        and float(scroll_line) > 1
                    ):
                        initial_scroll_line = float(scroll_line)
                        print(f"[EDITOR_APP] Using initial_scroll_line={initial_scroll_line} (from session state) for {initial_path}", file=sys.stderr)
            except Exception as exc:
                print(f"[EDITOR_APP] Failed to resolve initial_scroll_line: {exc}", file=sys.stderr)

            # Get client ID early so we can pass it to the editor for self-echo filtering
            try:
                client_id = context.client.id
            except Exception:
                client_id = str(uuid.uuid4())

            editor = ui.codemirror(
                value=initial_content,
                language=initial_language,
                theme=theme_mapped,
                line_wrapping=editor_prefs.get('wordWrap'),
                font_scale=font_scale_pref,
                highlight_whitespace=False,
                show_minimap=editor_prefs.get('showMinimap', False),
                initial_scroll_line=initial_scroll_line,
                client_id=client_id,
                on_change=_on_editor_change,
            ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
            editor._cached_content = initial_content

            # 5. Register editor for multi-client broadcasting (keep last-created as "primary")
            _register_editor_for_client(client_id=client_id, editor=editor)
            try:
                # Only remove when the client is deleted; disconnect handlers also fire on reconnect.
                context.client.on_delete(lambda *_args, _cid=client_id: _unregister_editor_for_client(client_id=_cid))
            except Exception:
                pass
            set_current_file(initial_path, initial_sha256)

            # Incremental mirroring: listen for cm_delta events emitted by the
            # CM6 component (ChangeSet.toJSON) and multicast to other clients.
            def _on_cm_delta(e):
                global _incremental_mirror_active
                try:
                    delta = getattr(e, "args", None)
                except Exception:
                    delta = None
                if not isinstance(delta, dict):
                    return
                try:
                    source_cid = context.client.id
                except Exception:
                    source_cid = client_id

                _incremental_mirror_active = True
                payload = {
                    **delta,
                    "source_client": source_cid,
                    "path": get_current_file(),
                }
                try:
                    for cid, ed in list(_active_editors.items()):
                        if not cid or ed is None:
                            continue
                        if source_cid and cid == source_cid:
                            continue
                        try:
                            ed.run_method("applyDelta", payload)
                        except Exception:
                            pass
                except Exception:
                    pass

            try:
                editor.on("cm_delta", _on_cm_delta)
            except Exception:
                pass
            
            # Apply runtime-only preferences (not available in constructor)
            # NOTE: theme and line_wrapping already set in constructor above
            print(f"[EDITOR_APP] Editor created with theme={theme_from_prefs}, wrap={editor_prefs.get('wordWrap')}", file=sys.stderr)
            
            editor.set_zebra_stripes(editor_prefs.get('showShading', False))
            editor.set_font_scale(font_scale_pref)
            editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
            # Theme and line wrapping already applied in constructor - don't re-apply
            editor.toggle_color_picker(editor_prefs.get('colorPicker', True))
            editor.set_read_only(editor_prefs.get('readOnly', False))
            # NOTE: sticky scroll moved to end of init (after LSP, diffs, watcher) to avoid rendering issues
            
            print(f"[EDITOR_APP] Applied runtime preferences: shading={editor_prefs.get('showShading')}, guides={editor_prefs.get('showIndentGuides')}, fontScale={editor_prefs.get('fontScale')}, colorPicker={editor_prefs.get('colorPicker')}, readOnly={editor_prefs.get('readOnly')}, stickyScroll={editor_prefs.get('stickyScroll')}", file=sys.stderr)

            # 5b. Optionally connect LSP client for this initial file
            try:
                if initial_path and project_path:
                    project_root_path = Path(project_path).expanduser()
                    _maybe_connect_lsp(editor, Path(initial_path), project_root_path)

                    # Sprint E: On page load (stateless iframe), publish cached draft diagnostics
                    # immediately for the open file (do not wait for first keystroke).
                    async def _publish_android_draft_on_open_bg() -> None:
                        try:
                            if Path(initial_path).suffix not in ('.kt', '.kts'):
                                return
                            base_project_root = Path(project_path).expanduser()
                            base_project_path = str(base_project_root)
                            if not (_history_store.get_lsp_enabled(base_project_path) and _history_store.get_lsp_server_enabled(base_project_path, 'kotlin-android')):
                                return

                            # Match connect_lsp() effective project root.
                            effective_project_root = base_project_root
                            try:
                                rel_root = _history_store.get_lsp_server_root_rel(base_project_path, 'kotlin-android')
                                if rel_root:
                                    candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
                                    if candidate.exists() and candidate.is_dir():
                                        effective_project_root = candidate
                            except Exception:
                                effective_project_root = base_project_root

                            from app.apps.file_editor_cm6.android_lang.android_sidecar import resolve_te2_android_sidecar_path
                            from app.apps.file_editor_cm6.android_lang.dependency_index import ensure_compiled_dependency_index
                            from app.apps.file_editor_cm6.android_lang.draft_diagnostics import build_draft_diagnostics
                            from ..lsp_ws import publish_draft_diagnostics_to_client

                            uri = f"file://{initial_path}"
                            sidecar_path = resolve_te2_android_sidecar_path(project_root=base_project_root)

                            def _load_sidecar() -> dict:
                                try:
                                    if sidecar_path.exists():
                                        return json.loads(sidecar_path.read_text(encoding='utf-8'))
                                except Exception:
                                    return {}
                                return {}

                            te2_sidecar = await anyio.to_thread.run_sync(_load_sidecar)
                            te2_sidecar = await anyio.to_thread.run_sync(
                                lambda: ensure_compiled_dependency_index(
                                    sidecar_path=sidecar_path,
                                    te2_sidecar=te2_sidecar or {},
                                    effective_project_root=effective_project_root,
                                    allow_gradle_resolve=False,
                                )
                            )

                            current_content = editor._cached_content if hasattr(editor, '_cached_content') else (editor.value or '')
                            diags = build_draft_diagnostics(te2_sidecar=te2_sidecar or {}, uri=uri, content=current_content)

                            # Retry until iframe finishes LSP initialize and session has a current_sid.
                            for _ in range(20):
                                ok = await publish_draft_diagnostics_to_client(
                                    language_id='kotlin-android',
                                    project_root=effective_project_root,
                                    uri=uri,
                                    draft_diagnostics=diags,
                                    has_drafts=bool(cached_entry.get('unsaved', False)) if cached_entry else False,
                                )
                                if ok:
                                    return
                                await asyncio.sleep(0.25)
                        except Exception:
                            return

                    asyncio.create_task(_publish_android_draft_on_open_bg())
            except Exception as exc:
                print(f"[LSP] Failed to auto-connect LSP on init for {initial_path}: {exc}", file=sys.stderr)

            if initial_path:
                if cached_was_restored:
                    _broadcast_cache_state(
                        project_path,
                        initial_path,
                        state=restored_state or 'mid_session',
                        unsaved=cached_entry.get('unsaved', False),
                        cache_entry=cached_entry,
                        reason='restore',
                    )
                else:
                    _broadcast_cache_state(
                        project_path,
                        initial_path,
                        state='clean',
                        unsaved=False,
                        reason='init',
                    )

            if restored_state:
                msg = 'Restored unsaved draft' if restored_state == 'mid_session' else 'Recovered changes from prior crash'
                editor.notify_parent('notification', {
                    'message': msg,
                    'type': 'warning',
                    'timeout': 4000
                })
                
                # Force indicator state on frontend
                editor.notify_parent('draft_state', {
                    'has_draft': True,
                    'path': initial_path
                })
            
            # 6. Load Diffs if Enabled
            try:
                if initial_path:
                    # On init, if file exists, we check diffs.
                    # _get_combined_diffs uses preferences store, which is loaded.
                    project_root = Path(project_path).expanduser() if project_path else get_project_root()
                    hunks = await _get_combined_diffs_async(project_root, initial_path, initial_content)
                    editor.set_diff_decorations(hunks)
                            
            except Exception as e:
                print(f"[DIFF] Failed to auto-load diffs on init: {e}", file=sys.stderr)

            # 7. Subscribe to File Watcher
            if initial_path:
                project_root = get_project_root()
                init_watcher(project_root)
                
                first_snapshot_seen = False
                
                def on_file_change(event):
                    nonlocal first_snapshot_seen
                    
                    if event.get('type') == 'replace_full':
                        # Skip the first snapshot if we restored from cache
                        if not first_snapshot_seen and cached_was_restored:
                            first_snapshot_seen = True
                            print(f"[FILE_WATCH] Skipping initial snapshot, cache was restored", file=sys.stderr)
                            return
                        
                        first_snapshot_seen = True
                        new_content, new_sha256 = event.get('content', ''), event.get('sha256')
                        was_applied = _apply_watcher_replace(
                            path=initial_path,
                            content=new_content,
                            sha256=new_sha256,
                            project_path=project_path,
                        )
                        # Only recalculate diffs if content was actually replaced
                        if was_applied and _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
                            try:
                                _schedule_diff_refresh(project_root, initial_path, new_content, editor, "watcher_replace")
                            except Exception as e:
                                print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)
                
                subscribe(initial_path, 'nicegui_backend', on_file_change)

            # 7b. Enable sticky scroll LAST - after content, LSP, diffs, watcher are ready
            # This prevents rendering issues (whitespace, empty slots) on page load
            editor.set_sticky_scroll(editor_prefs.get('stickyScroll', False))

    # 8. Add Diff Styling
    ui.add_head_html('''
    <style>
    :root {
      --diff-gutter-width: 0.7rem;
      --diff-marker-width: var(--diff-gutter-width);
      --diff-add-bg: rgba(52, 211, 153, 0.22);
      --diff-add-border: rgba(52, 211, 153, 0.75);
      --diff-add-marker: rgba(52, 211, 153, 0.9);
      --diff-context-border: rgba(148, 163, 184, 0.35);
      --diff-context-marker: rgba(148, 163, 184, 0.55);
      --diff-del-bg: rgba(248, 113, 113, 0.18);
      --diff-del-border: rgba(248, 113, 113, 0.7);
      --diff-del-fg: rgba(248, 113, 113, 0.95);
      --diff-del-marker: rgba(248, 113, 113, 0.85);
    }

    /* Base minimap container */
    .cm-editor .cm-minimap-container {
      position: sticky; /* Changed from absolute to sticky to fix scrolling issue */
      top: 0;
      right: 0;
      height: 100%;
      pointer-events: auto;
      z-index: 5000; /* Increased z-index */
    }

    /* Desktop: Sidebar style */
    .cm-editor .cm-minimap-desktop {
      position: fixed; /* Fixed to iframe viewport so it doesn't scroll */
      top: 0;
      right: 0;
      bottom: 0;
      width: 75px;
      opacity: 1.0;
      background: var(--bg, #0b0f1a); /* Fallback to dark bg */
      border-left: 1px solid rgba(128, 128, 128, 0.2);
      z-index: 5000;
    }
    
    /* Desktop: Push content to the left */
    .cm-editor.cm-has-minimap-desktop .cm-content {
      padding-right: 75px; /* 75px width */
    }

	    /* Mobile: semi-transparent overlay “preview” on the right */
	    .cm-editor .cm-minimap-mobile {
	      position: fixed; /* Changed to fixed to stay in viewport */
	      top: 0;
	      right: 0;
	      bottom: 0;
	      width: 30%;
	      opacity: 0; /* Hidden by default */
	      pointer-events: none;
	      touch-action: none;
	      transition: opacity 0.3s ease; /* Smooth fade */
	      z-index: 5001; /* Ensure it's above everything */
	    }
	    
	    /* Show mobile minimap when scrolling */
	    .cm-editor.cm-scrolling .cm-minimap-mobile {
	      opacity: 0.7;
	      pointer-events: auto;
	    }
	    
	    /* Keep minimap interactive during touch scrub even after scroll state clears */
	    .cm-editor.cm-minimap-interacting .cm-minimap-mobile {
	      opacity: 0.7;
	      pointer-events: auto;
	    }

    /* You can also hide desktop style when really narrow, if you ever send mode=desktop on a phone */
    @media (max-width: 600px) {
      .cm-editor .cm-minimap-desktop {
        display: none;
      }
    }
    .cm-diff-gutter {
      width: var(--diff-gutter-width);
      min-width: var(--diff-gutter-width);
    }
    .cm-diff-gutter .cm-gutterElement {
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }
    .cm-diff-gutter-marker {
      display: inline-flex;
      align-items: flex-start;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-weight: 600;
      user-select: none;
      -webkit-user-select: none;
      line-height: inherit;
    }
    /* tint the fold/twisty gutter for deletion rows */
    .cm-foldGutter .cm-gutterElement.cm-diff-deleted-lineno {
       background-color: var(--diff-del-bg);
    }
    .cm-foldGutter .cm-gutterElement.cm-diff-deleted-lineno-draft {
       background-color: rgba(250, 204, 21, 0.18);
    }

    .cm-diff-marker-add { color: var(--diff-add-marker); }
    .cm-diff-marker-del { color: var(--diff-del-marker); }
    .cm-diff-marker-context { color: var(--diff-context-marker); }
    
    .cm-diff-minus-marker {
      display: inline-flex;
      align-items: flex-start;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-weight: 600;
      color: var(--diff-del-marker);
      user-select: none;
      -webkit-user-select: none;
    }
    
    .cm-diff-line-added,
    .cm-diff-line-context,
    .cm-diff-line-removed {
      position: relative;
    }
    .cm-diff-line-added {
      background: var(--diff-add-bg) !important;
    }
    .cm-diff-line-context { background: transparent; }
    .cm-diff-line-removed {
      padding: 0 10px 0 6px;
      background: var(--diff-del-bg);
      color: var(--diff-del-fg);
      font: inherit;
      white-space: pre;
      line-height: inherit;
      user-select: none;
      -webkit-user-select: none;
      contain: layout paint;
    }
    .cm-diff-line-added::after,
    .cm-diff-line-context::after,
    .cm-diff-line-removed::after {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      pointer-events: none;
    }
    .cm-diff-line-added::after { background: var(--diff-add-border); }
    .cm-diff-line-context::after { background: var(--diff-context-border); }
    .cm-diff-line-removed::after { background: var(--diff-del-border); }
    .cm-diff-removed-text { display: block; white-space: pre; }
    .cm-diff-line-removed.cm-diff-wrap { white-space: pre-wrap; word-break: break-word; }
    .cm-diff-line-removed.cm-diff-wrap .cm-diff-removed-text { white-space: pre-wrap; word-break: break-word; }
    
    /* Deleted line number in standard gutter */
    .cm-diff-deleted-lineno {
      color: var(--diff-del-marker);
      background-color: var(--diff-del-bg);
      display: block;
      user-select: none;
      -webkit-user-select: none;
    }
    
    /* Added line number in ALL gutters (applied via gutterLineClass) */
    .cm-diff-added-lineno {
      color: var(--diff-add-marker);
      background-color: var(--diff-add-bg);
      font-weight: 600;
    }

    /* --- Draft Diff Styles (Blue/Yellow) --- */
    /* Defined LAST to override generic git styles */
    
    .cm-diff-line-added-draft {
      background: rgba(59, 130, 246, 0.22) !important;
      position: relative;
    }
    .cm-diff-line-added-draft::after {
      content: '';
      position: absolute; left: 0; top: 0; bottom: 0; width: 3px; pointer-events: none;
      background: rgba(59, 130, 246, 0.75);
    }
    
    .cm-diff-line-removed-draft {
      background: rgba(250, 204, 21, 0.18) !important;
      color: rgba(250, 204, 21, 0.95);
    }
    .cm-diff-line-removed-draft::after {
      background: rgba(250, 204, 21, 0.7) !important;
    }
    
        .cm-diff-deleted-lineno-draft {
      color: rgba(250, 204, 21, 0.85);
      background-color: rgba(250, 204, 21, 0.18);
      display: block;
      user-select: none;
      -webkit-user-select: none;
    }
    
    .cm-foldGutter .cm-gutterElement.cm-diff-added-lineno-draft {
       background-color: rgba(59, 130, 246, 0.22);
    }
    
    .cm-diff-added-lineno-draft {
       color: rgba(59, 130, 246, 0.9);
       background-color: rgba(59, 130, 246, 0.22);
       font-weight: 600;
    }
    
    .cm-diff-minus-marker-draft {
       color: rgba(250, 204, 21, 0.85);
    }
    </style>
    ''')

# --- Editor API Endpoints ---

@editor_router.post('/discard_draft')
async def discard_draft(data: dict = Body(...)):
    """Discard cached session for current document."""
    path = data.get('path')
    project_path = _history_store.get_active_project()
    
    if not path or not project_path:
        return {"ok": False, "error": "No active document"}
    
    cleared = _history_store.clear_cached_document(project_path, path)

    # Notify explorer of draft state change
    if cleared:
        try:
            from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
            notify_draft_state_changed(project_path)
        except Exception as e:
            print(f"[DISCARD] Failed to notify explorer of draft change: {e}", file=sys.stderr)

    if cleared and path == get_current_file():
        _broadcast_cache_state(
            project_path,
            path,
            state='clean',
            unsaved=False,
            reason='discard',
        )
    
    return {"ok": True, "data": {"cleared": cleared}}

@editor_router.post('/refresh_cache_state')
async def refresh_cache_state():
    """Force re-broadcast of the current cache state."""
    project_path = _history_store.get_active_project()
    current_file = get_current_file()
    
    if not project_path or not current_file:
        return {"ok": True}

    cached_entry = _history_store.get_cached_document(project_path, current_file)
    if cached_entry:
        unsaved = cached_entry.get('unsaved', False)
        
        if not unsaved:
             # If cached but clean, broadcast as clean (no draft indicator)
             _broadcast_cache_state(
                project_path,
                current_file,
                state='clean',
                unsaved=False,
                cache_entry=cached_entry,
                reason='restore_clean'
             )
             return {"ok": True}

        # Handle actual unsaved draft
        runtime_meta = _get_runtime_metadata()
        cached_run = cached_entry.get('run_id', 'unknown')
        current_run = runtime_meta['run_id']
        
        state = 'mid_session' if cached_run == current_run else 'crashed'
        
        # Broadcast standard telemetry
        _broadcast_cache_state(
            project_path,
            current_file,
            state=state,
            unsaved=True,
            cache_entry=cached_entry,
            reason='restore'
        )
        
        # Explicitly signal draft state if active
        if state == 'crashed' or (state == 'mid_session'):
             for editor in get_active_editors():
                 try:
                     editor.notify_parent('draft_state', {
                        'has_draft': True,
                        'path': current_file
                    })
                 except Exception:
                     pass
            
    return {"ok": True}

@editor_router.post('/check_cache')
async def check_cache(data: dict = Body(...)):
    """Check if a file has a cached draft."""
    path = data.get('path')
    if not path:
        return {"ok": False, "error": "No path provided"}
    
    project_path = _history_store.get_active_project()
    if not project_path:
        return {"ok": True, "has_draft": False}
        
    cache_entry = _history_store.get_cached_document(project_path, path)
    print(f"[CHECK_CACHE] Checking {path} -> Found: {bool(cache_entry)}, Unsaved: {cache_entry.get('unsaved') if cache_entry else 'N/A'}", file=sys.stderr)
    
    if cache_entry and cache_entry.get('unsaved'):
        return {
            "ok": True,
            "has_draft": True,
            "content": cache_entry.get('content', ''),
            "base_sha256": cache_entry.get('base_sha256')
        }
    return {"ok": True, "has_draft": False}

@editor_router.post('/set_content')
async def set_editor_content(data: dict = Body(...)):
    global _current_watcher_token
    global _suppress_on_change_until
    editors = get_active_editors()
    editor = get_active_editor()
    if not editors or not editor:
        return {"ok": False, "error": "Editor not ready"}
    
    new_path = data.get('path', '')
    old_path = get_current_file()
    project_path = _history_store.get_active_project()
    has_draft = data.get('has_draft', False)
    
    print(f"[SET_CONTENT] path={new_path!r} old={old_path!r}", file=sys.stderr)

    # Cache clearing removed to allow multi-file drafts / persistence
    if old_path and old_path != new_path:
        _persist_active_draft_immediately(reason='switch')
    _cancel_cache_persist_timer()
    
    content = data.get('content')
    if content is None:
        content = ''
    language = data.get('language', 'python')
    content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()

    # Check for actual cached draft (needed both for broadcast + fallback SHA)
    cache_entry = None
    if project_path and new_path:
        cache_entry = _history_store.get_cached_document(project_path, new_path)

    # Backend Safeguard: If frontend sends disk content but we have a draft, force the draft.
    if cache_entry and cache_entry.get('unsaved'):
        cached_base = cache_entry.get('base_sha256')
        if cached_base and content_sha256 == cached_base:
            print(f"[SET_CONTENT] SAFEGUARD: Overriding disk content with cached draft for {new_path}", file=sys.stderr)
            content = cache_entry.get('content', '')
            content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
            has_draft = True # Ensure we treat this as a restore

    provided_base_sha = data.get('sha256')
    
    cached_base = cache_entry.get('base_sha256') if cache_entry else None
    print(f"[SET_CONTENT] SHAs: provided={provided_base_sha} cached_base={cached_base} content_sha={content_sha256}", file=sys.stderr)

    base_sha256 = (
        provided_base_sha
        or cached_base
        or content_sha256
    )
    set_current_file(new_path, base_sha256)

    remote_apply = bool(data.get("remote_apply"))
    if remote_apply:
        # Prevent this apply from immediately persisting/re-broadcasting via on_change.
        _suppress_on_change_until = time.time() + 1.0

    # LSP: connect or disconnect based on the newly active file
    try:
        if project_path and new_path:
            project_root_path = Path(project_path).expanduser()
            _maybe_connect_lsp(editor, Path(new_path), project_root_path)
        else:
            _maybe_connect_lsp(editor, None, None)
    except Exception as exc:
        print(f"[LSP] Failed to update LSP on set_content for {new_path}: {exc}", file=sys.stderr)
    
    for ed in editors:
        try:
            ed.set_value(content)
            ed._cached_content = content
            ed.set_language(language)
            ed.update()
        except Exception as exc:
            print(f"[SET_CONTENT] Failed to update editor: {exc}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        new_path,
        state='mid_session' if (cache_entry and cache_entry.get('unsaved')) else 'clean',
        unsaved=bool(cache_entry and cache_entry.get('unsaved')),
        cache_entry=cache_entry,
        reason='restore' if has_draft else 'set_content',
    )
    
    project_root = get_project_root()
    init_watcher(project_root)
    
    def on_file_change(event):
        if event.get('type') == 'replace_full':
            new_content, new_sha256 = event.get('content', ''), event.get('sha256')
            print(f"[SET_CONTENT][WATCHER] replace_full path={new_path!r} sha={new_sha256}", file=sys.stderr)
            _apply_watcher_replace(
                path=new_path,
                content=new_content,
                sha256=new_sha256,
                project_path=project_path,
            )
            
            # Refresh diffs (Combined)
            try:
                current_content = editor.value or ''
                _schedule_diff_refresh(project_root, new_path, current_content, editor, "set_content_watcher")
            except Exception as e:
                print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)

    # Cleanup old subscription
    if _current_watcher_token:
        try:
            from app.apps.file_editor_cm6.core_read import unsubscribe
            unsubscribe(_current_watcher_token)
        except Exception as e:
            print(f"[SET_CONTENT] Failed to unsubscribe old token: {e}", file=sys.stderr)
            
    _current_watcher_token = subscribe(new_path, 'nicegui_backend_set_content', on_file_change)
    
    # Apply ALL preferences from disk to ensure consistency (Single Source of Truth)
    # These are applied every time content changes to maintain consistent editor state
    # NOTE: theme and line_wrapping are constructor-only, don't re-apply here
    editor_prefs = _preferences_store.get_preferences().get('editor', {})
    font_scale_pref = _resolve_font_scale(editor_prefs.get('fontScale'))
    
    editor.set_zebra_stripes(editor_prefs.get('showShading'))
    editor.set_font_scale(font_scale_pref)
    editor.set_indent_guides(editor_prefs.get('showIndentGuides'))
    editor.toggle_color_picker(editor_prefs.get('colorPicker'))
    editor.set_read_only(editor_prefs.get('readOnly', False))
    editor.set_sticky_scroll(editor_prefs.get('stickyScroll', False))  # Added: 2025-12-03 by vectorArc - TE2 Team
    # Single update() call after all preferences applied
    editor.update()
    
    print(f"[SET_CONTENT] Applied all preferences from disk", file=sys.stderr)
    
    # Load Diffs (Combined)
    if new_path:
        try:
            # On set_content, editor content == disk content (unless restored elsewhere, but set_content clobbers).
            # So draft diffs will be empty. Git diffs will show if enabled.
            # _get_combined_diffs handles the preferences check.
            project_path = _history_store.get_active_project() or str(get_project_root())
            hunks = await _get_combined_diffs_async(Path(project_path).expanduser(), new_path, content)
            editor.set_diff_decorations(hunks)
        except Exception as e: 
            print(f"[SET_CONTENT] Failed to load diffs: {e}", file=sys.stderr)
            editor.set_diff_decorations([])
    else: 
        editor.set_diff_decorations([])
    
    return {"ok": True, "sha256": content_sha256}

@editor_router.post('/refresh_diffs')
async def refresh_diffs(data: dict = Body(...)):
    path = data.get('path')
    if not path: return {"ok": False, "error": "No path provided"}
    editors = get_active_editors()
    if not editors:
        return {"ok": False, "error": "Editor not ready"}
    
    try:
        project_path = _history_store.get_active_project() or str(get_project_root())
        if not project_path: return {"ok": False, "error": "No project selected"}
        
        project_root = Path(project_path).expanduser()
        rel = _normalize_rel_path(project_root, path)
        diff_data = await anyio.to_thread.run_sync(
            lambda: collect_diff(project_root, rel, base_ref=_current_diff_base(project_path))
        )
        hunks = diff_data.get('hunks', [])
        for editor in editors:
            try:
                editor.set_diff_decorations(hunks)
            except Exception:
                pass
        return {"ok": True, "hunks_count": len(hunks)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@editor_router.post('/toggle_edit_tracking')
async def toggle_edit_tracking(data: dict = Body(...)):
    enabled = data.get('enabled', False)
    if enabled: enable_edit_tracking()
    else: disable_edit_tracking()
    _preferences_store.update_preferences(editor={'trackAgentEdits': enabled})
    return {"ok": True, "enabled": enabled}

@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict = Body(...)):
    """Jump to a line in the currently loaded file. Does NOT load new files.
    
    Args (in data):
        line: Target line number (1-based)
        focus: Whether to focus editor (default: True)
        scroll_to_top: If True, position line at viewport top (for scroll restore).
                      If False, uses default scrollIntoView behavior. (default: False)
        scroll_y: Optional scroll mode. Use 'center' to center the target line in the viewport.
    """
    editors = get_active_editors()
    primary = get_active_editor()
    if not editors or not primary:
        return {"ok": False, "error": "Editor not ready"}

    try:
        target_line = int(data.get('line', 1))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid line number"}

    focus_flag = data.get('focus')
    should_focus = True if focus_flag is None else bool(focus_flag)
    
    # scroll_to_top: position line at viewport top (symmetrical with scroll recording)
    scroll_to_top = bool(data.get('scroll_to_top') or data.get('scrollToTop'))

    scroll_y = data.get('scroll_y') or data.get('scrollY')
    if isinstance(scroll_y, str):
        scroll_y = scroll_y.strip()
    else:
        scroll_y = None
    if scroll_to_top:
        # scroll_to_top is a special mode; ignore scroll_y to avoid conflicting semantics
        scroll_y = None

    print(
        f"[JUMP_TO_LINE] Scrolling to line {target_line}, scroll_to_top={scroll_to_top}, scroll_y={scroll_y}",
        file=sys.stderr,
    )

    for editor in editors:
        try:
            # Avoid focusing multiple clients (esp. mobile keyboard popups).
            focus_this = should_focus if editor is primary else False
            editor.jump_to_line(target_line, focus=focus_this, scroll_to_top=scroll_to_top, scroll_y=scroll_y)
        except Exception as exc:
            print(f"[JUMP_TO_LINE] Failed: {exc}", file=sys.stderr)

    return {
        "ok": True,
        "line": target_line,
        "focus": should_focus,
        "scroll_to_top": scroll_to_top,
        "scroll_y": scroll_y,
    }

@editor_router.post('/search/open')
async def editor_search_open(data: dict = Body(...)):
    """Open the CodeMirror search panel when user presses Ctrl+F."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404, 
            detail="Editor not initialized. Open a file first."
        )
    
    try:
        editor.open_search_panel()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to open search panel: {str(e)}"
        )

@editor_router.post('/color_picker/toggle')
async def editor_toggle_color_picker(data: dict = Body(...)):
    """Toggle CSS color picker extension."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404,
            detail="Editor not initialized. Open a file first."
        )
    
    enabled = data.get('enabled', False)
    
    try:
        editor.toggle_color_picker(enabled)
        return {"ok": True, "enabled": enabled}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to toggle color picker: {str(e)}"
        )

@editor_router.post('/read_only/set')
async def editor_set_read_only(data: dict = Body(...)):
    """Set editor read-only mode."""
    editor = get_active_editor()
    
    if not editor:
        raise HTTPException(
            status_code=404,
            detail="Editor not initialized. Open a file first."
        )
    
    readonly = data.get('readonly', False)
    
    try:
        editor.set_read_only(readonly)
        return {"ok": True, "readonly": readonly}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to set read-only mode: {str(e)}"
        )

@editor_router.post('/minimap/mode')
async def editor_minimap_mode(data: dict = Body(...)):
    """Set the minimap mode for the current editor."""
    mode = data.get('mode', 'off')
    editor = get_active_editor()
    if not editor:
        raise HTTPException(status_code=404, detail='Editor not initialized')
    try:
        editor.set_minimap_mode(mode)
        return {'ok': True, 'mode': mode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to set minimap mode: {e}')


# --- Helper Function for View State ---
def _get_view_state_dict() -> dict:
    """Helper to get current view state from preferences (single source of truth)."""
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    lsp_state = {
        "enableLsp": False,
        "enableLspPyright": False,
        "enableLspTypescript": False,
        "enableLspClangd": False,
        "enableLspKotlin": False,
        "enableLspKotlinAndroid": False,
        "lspPyrightConfigMode": "root",
    }
    try:
        project_path = _history_store.get_active_project() or str(get_project_root())
        if project_path:
            lsp_state = _history_store.get_lsp_state_payload(project_path)
    except Exception:
        pass
    return {
        "showLineNumbers": editor_prefs.get('showLineNumbers'),
        "showSyntax": editor_prefs.get('showSyntax'),
        "showShading": editor_prefs.get('showShading'),
        "wordWrap": editor_prefs.get('wordWrap'),
        "autoCloseBrackets": editor_prefs.get('autoCloseBrackets'),
        "autocompletion": editor_prefs.get('autocompletion'),
        "theme": editor_prefs.get('theme'),
        "autoSave": editor_prefs.get('autoSave'),
        "showInlineDiffs": editor_prefs.get('showInlineDiffs'),
        "trackAgentEdits": editor_prefs.get('trackAgentEdits'),
        "fontScale": editor_prefs.get('fontScale'),
        "showIndentGuides": editor_prefs.get('showIndentGuides'),
        "colorPicker": editor_prefs.get('colorPicker'),
        "readOnly": editor_prefs.get('readOnly'),
        "showMinimap": editor_prefs.get('showMinimap'),
        "showDraftDiffs": editor_prefs.get('showDraftDiffs'),
        "stickyScroll": editor_prefs.get('stickyScroll'),  # Added: 2025-12-03 by vectorArc - TE2 Team
        **lsp_state,
    }


@editor_router.get('/view_state')
async def get_view_state():
    """Return current editor view settings for frontend display (menu checkmarks)."""
    return {"ok": True, "data": _get_view_state_dict()}


@editor_router.post('/update_preference')
async def update_preference(data: dict = Body(...)):
    """
    Update a single preference and apply it to the editor immediately.
    This is the ONLY way frontend should change preferences.
    Returns full view state to eliminate double round-trip (Jimmy's optimization). (also a new thing here... test)
    """
    key = data.get('key')
    value = data.get('value')
    source_client = data.get('nicegui_client_id')
    
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    
    editors = get_active_editors()
    if not editors:
        raise HTTPException(status_code=404, detail="Editor not initialized")
    editor = editors[0]
    
    # Validate key. Most preferences are editor-scoped in PreferencesStore, but
    # LSP config is project-scoped (sidecar SSOT via HistoryStore facade).
    LSP_KEYS = {
        'enableLsp', 'enableLspPyright', 'enableLspTypescript', 'enableLspClangd', 'enableLspKotlin', 'enableLspKotlinAndroid',
        'lspRootRelPyright', 'lspRootRelTypescript', 'lspRootRelClangd', 'lspRootRelKotlin', 'lspRootRelKotlinAndroid',
        'lspKotlinAndroidModule', 'lspKotlinAndroidVariant',
        'lspPyrightConfigMode',
    }
    if key not in LSP_KEYS:
        from app.apps.file_editor_cm6.preferences_store import DEFAULT_EDITOR_PREFS
        if key not in DEFAULT_EDITOR_PREFS:
            raise HTTPException(status_code=400, detail=f"Invalid preference key: {key}")
    
    # Apply to editor immediately based on key; persist only after success
    try:
        print(f"[PREFERENCE] Incoming update key={key} value={value}", file=sys.stderr)
        if key == 'wordWrap':
            for ed in editors:
                ed.set_line_wrapping(bool(value))
            # If turning word wrap ON and diffs are showing, refresh them
            # Deletion widgets don't auto-adapt to word wrap changes
            if value and get_current_file():
                current_prefs = _preferences_store.get_preferences().get('editor', {})
                if current_prefs.get('showInlineDiffs', False):
                    project_path = _history_store.get_active_project() or str(get_project_root())
                    if project_path:
                        try:
                            rel = _normalize_rel_path(Path(project_path).expanduser(), get_current_file())
                            diff_data = collect_diff(Path(project_path).expanduser(), rel, base_ref=_current_diff_base(project_path))
                            hunks = diff_data.get('hunks', [])
                            for ed in editors:
                                ed.set_diff_decorations(hunks)
                            print(f"[PREFERENCE] Refreshed diffs after word wrap enabled", file=sys.stderr)
                        except Exception as e:
                            print(f"[PREFERENCE] Failed to refresh diffs: {e}", file=sys.stderr)
        elif key == 'showShading':
            for ed in editors:
                ed.set_zebra_stripes(bool(value))
        elif key == 'showIndentGuides':
            for ed in editors:
                ed.set_indent_guides(bool(value))
        elif key == 'theme':
            theme_value = str(value)
            try:
                mapped_theme = _resolve_theme_preference(theme_value)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            value = theme_value
            for ed in editors:
                ed.set_theme(mapped_theme)
        elif key == 'fontScale':
            try:
                scale = _resolve_font_scale(value)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            value = scale
            for ed in editors:
                ed.set_font_scale(scale)
        elif key == 'colorPicker':
            for ed in editors:
                ed.toggle_color_picker(bool(value))
        elif key == 'readOnly':
            for ed in editors:
                ed.set_read_only(bool(value))
        elif key == 'showMinimap':
            # Use prop setter to trigger client-side auto-detect logic
            for ed in editors:
                ed.show_minimap = bool(value)
        elif key == 'stickyScroll':
            # Added: 2025-12-03 by vectorArc - TE2 Team
            for ed in editors:
                ed.set_sticky_scroll(bool(value))
        elif key in (
            'enableLsp', 'enableLspPyright', 'enableLspTypescript', 'enableLspClangd', 'enableLspKotlin', 'enableLspKotlinAndroid',
            'lspRootRelPyright', 'lspRootRelTypescript', 'lspRootRelClangd', 'lspRootRelKotlin', 'lspRootRelKotlinAndroid',
            'lspKotlinAndroidModule', 'lspKotlinAndroidVariant',
            'lspPyrightConfigMode',
        ):
            # LSP preferences are project-scoped (sidecar SSOT via HistoryStore facade).
            # Persist + apply after success below.
            pass
        elif key == 'showInlineDiffs':
            pass  # handled after preference persistence via _refresh_active_diffs
        elif key == 'showDraftDiffs':
            pass
        elif key == 'autoSave':
            project_path = _history_store.get_active_project() or str(get_project_root())
            current_file = get_current_file()
            # When enabling autosave, drop any cached drafts for the active document
            if value and project_path and current_file:
                try:
                    _history_store.clear_cached_document(project_path, current_file)
                    # Notify explorer of draft state change
                    from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
                    notify_draft_state_changed(project_path)
                except Exception as exc:
                    print(f"[PREFERENCE] Failed to clear cache on autosave enable: {exc}", file=sys.stderr)
                _broadcast_cache_state(
                    project_path,
                    current_file,
                    state='clean',
                    unsaved=False,
                    cache_entry=None,
                    reason='autosave_on',
                )
            # Refresh handled below after persistence

        elif key == 'trackAgentEdits':
            if value:
                enable_edit_tracking()
            else:
                disable_edit_tracking()
        elif key in ['showLineNumbers', 'showSyntax', 'autoCloseBrackets', 'autocompletion', 'autoSave']:
            # These require frontend to rebuild view (legacy behavior)
            # Persistence happens after this block once runtime updates succeed
            pass
        
        for ed in editors:
            ed.update()

        if key in (
            'enableLsp', 'enableLspPyright', 'enableLspTypescript', 'enableLspClangd', 'enableLspKotlin', 'enableLspKotlinAndroid',
            'lspRootRelPyright', 'lspRootRelTypescript', 'lspRootRelClangd', 'lspRootRelKotlin', 'lspRootRelKotlinAndroid',
            'lspKotlinAndroidModule', 'lspKotlinAndroidVariant',
            'lspPyrightConfigMode',
        ):
            project_path = _history_store.get_active_project() or str(get_project_root())
            if not project_path:
                raise HTTPException(status_code=400, detail="No active project for LSP preference")
            if key == 'enableLsp':
                if not _history_store.set_lsp_enabled(project_path, bool(value)):
                    raise RuntimeError("Failed to persist LSP enablement")
            elif key in ('enableLspPyright', 'enableLspTypescript', 'enableLspClangd', 'enableLspKotlin', 'enableLspKotlinAndroid'):
                server_map = {
                    'enableLspPyright': 'pyright',
                    'enableLspTypescript': 'typescript',
                    'enableLspClangd': 'clangd',
                    'enableLspKotlin': 'kotlin',
                    'enableLspKotlinAndroid': 'kotlin-android',
                }
                server_id = server_map.get(key)
                if server_id:
                    if not _history_store.set_lsp_server_enabled(project_path, server_id, bool(value)):
                        raise RuntimeError("Failed to persist LSP server enablement")
            elif key in ('lspRootRelKotlinAndroid', 'lspKotlinAndroidModule', 'lspKotlinAndroidVariant'):
                # Persist kotlin-android config into .code_cm6/lang/android/android_build_config.json (SSOT).
                try:
                    from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_lsp_config

                    root_path = Path(project_path)
                    if key == 'lspRootRelKotlinAndroid':
                        update_android_lsp_config(root_path, root_rel=str(value))
                    elif key == 'lspKotlinAndroidModule':
                        update_android_lsp_config(root_path, module=str(value))
                    else:
                        update_android_lsp_config(root_path, variant=str(value))
                except Exception as exc:
                    raise HTTPException(status_code=400, detail=f"Failed to persist kotlin-android config: {exc}")
            elif key == 'lspPyrightConfigMode':
                mode = str(value or "").strip().lower()
                if not _history_store.set_lsp_pyright_config_mode(project_path, mode):
                    raise RuntimeError("Failed to persist Pyright config mode")

                # Restart Pyright LSP on next open/start.
                from app.apps.file_editor_cm6.lsp_shell_manager import shutdown_lsp_shell

                try:
                    await shutdown_lsp_shell("python")
                except Exception:
                    pass

            else:
                root_map = {
                    'lspRootRelPyright': 'pyright',
                    'lspRootRelTypescript': 'typescript',
                    'lspRootRelClangd': 'clangd',
                    'lspRootRelKotlin': 'kotlin',
                }
                server_id = root_map.get(key)
                if not server_id:
                    raise RuntimeError("Unknown LSP root override key")

                # Root overrides are strings. Empty/"." means "use project root".
                try:
                    root_rel = str(value).strip() if value is not None else ""
                except Exception:
                    root_rel = ""

                if not _history_store.set_lsp_server_root_rel(project_path, server_id, root_rel):
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid LSP project root: must be a relative directory within the project",
                    )

                # If the server is running, shut it down. Do NOT auto-restart; it
                # restarts when a supported file is entered or when manually started.
                from app.apps.file_editor_cm6.lsp_shell_manager import shutdown_lsp_shell

                server_languages = {
                    "pyright": ["python"],
                    "typescript": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
                    "clangd": ["c", "cpp"],
                    "kotlin": ["kotlin"],
                }
                for lang in server_languages.get(server_id, []):
                    try:
                        await shutdown_lsp_shell(lang)
                    except Exception:
                        pass

                # If the active document uses this server, disconnect the client now.
                try:
                    current_file = get_current_file()
                    if current_file:
                        current_lang = LSP_LANGUAGE_MAP.get(Path(current_file).suffix)
                        if current_lang in server_languages.get(server_id, []):
                            for ed in editors:
                                ed.disconnect_lsp()
                except Exception:
                    pass

            # Apply LSP connect/disconnect after persistence so the SSOT is consistent.
            # Root changes intentionally do NOT auto-restart; they take effect on next entry/manual start.
            try:
                if key.startswith('lspRootRel'):
                    pass
                else:
                    current_file = get_current_file()
                    if current_file:
                        for ed in editors:
                            _maybe_connect_lsp(ed, Path(current_file), Path(project_path))
                    else:
                        if key == 'enableLsp' and not bool(value):
                            for ed in editors:
                                ed.disconnect_lsp()
            except Exception as exc:
                print(f"[PREFERENCE] LSP reconnect after {key} failed: {exc}", file=sys.stderr)
        else:
            _preferences_store.update_preferences(editor={key: value})
        
        if key in ('showInlineDiffs', 'showDraftDiffs', 'autoSave'):
            _refresh_active_diffs()
        
        print(f"[PREFERENCE] Updated {key}={value}", file=sys.stderr)

        # Broadcast preference changes so other connected host shells converge immediately.
        # (This is separate from cm6-cache-state, which is primarily about doc cache telemetry.)
        try:
            project_path = _history_store.get_active_project() or str(get_project_root())
            proj_norm = str(Path(project_path).expanduser().resolve(strict=False)) if project_path else None
            if proj_norm:
                view_state = _get_view_state_dict()
                from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager
                asyncio.create_task(
                    _explorer_manager.broadcast(
                        proj_norm,
                        {
                            "type": "editor:prefs_changed",
                            "payload": {
                                "project_path": proj_norm,
                                "key": key,
                                "value": value,
                                "view_state": view_state,
                                "source_client": source_client,
                            },
                        },
                    )
                )
        except Exception:
            pass
        
        # Return full state (Jimmy's optimization - single round trip)
        return {"ok": True, "data": _get_view_state_dict()}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[PREFERENCE] Failed to apply {key}={value}: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to apply preference: {e}")


@editor_router.get('/cache_state')
def get_cache_state(project: str | None = Query(None), path: str | None = Query(None)):
    project_path = project or _history_store.get_active_project()
    current_file = path or get_current_file()
    if not project_path or not current_file:
        return {"ok": True, "data": None}

    cached = _history_store.get_cached_document(project_path, current_file)
    if not cached:
        return {"ok": True, "data": {"state": "clean"}}

    runtime = _get_runtime_metadata()
    state = "mid_session" if cached.get('run_id') == runtime.get('run_id') else "crashed"
    return {
        "ok": True,
        "data": {
            "state": state,
            "unsaved": cached.get('unsaved', False),
            "content_sha256": cached.get('content_sha256'),
            "base_sha256": cached.get('base_sha256'),
            "updated_at": cached.get('updated_at'),
            "run_id": cached.get('run_id'),
        }
    }

@editor_router.get('/debug/state')
def debug_editor_state():
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready", "current_file": get_current_file(), "editor_exists": False}
    content = editor.value or ''
    return {"ok": True, "editor_exists": True, "current_file": get_current_file(), "content_length": len(content), "content_hash": hashlib.sha256(content.encode('utf-8')).hexdigest()}


async def _write_editor_buffer_to_disk(*, client_id: str, op_id: Optional[str]) -> dict:
    editor = get_active_editor()
    if not editor:
        raise SaveValidationError("Editor not ready")

    current_file = get_current_file()
    if not current_file:
        raise SaveValidationError("No file is currently open")

    content = editor.value or ''
    base_sha256 = get_current_file_sha256()
    op_identifier = op_id or f"op_{int(time.time() * 1000)}"
    project_root = get_project_root()
    print(f"[SAVE] Attempting path={current_file!r} len={len(content)} base={base_sha256}", file=sys.stderr)

    rel_path = _normalize_rel_path(project_root, current_file)

    target_path = project_root.joinpath(rel_path).resolve()
    orig_mode = None
    if target_path.exists() and target_path.is_file():
        try:
            orig_mode = target_path.stat().st_mode & 0o777
            print(f"[SAVE] Preserving mode {oct(orig_mode)} for {current_file!r}", file=sys.stderr)
        except OSError:
            pass

    init_watcher(project_root)

    file_meta = await anyio.to_thread.run_sync(
        lambda: write_full(
            project_root,
            str(rel_path),
            content,
            base_sha256=base_sha256,
            mode=orig_mode,
        )
    )

    push_save_ack(str(rel_path), op_identifier, client_id, file_meta)
    emit_diff_changed(str(rel_path), file_meta["sha256"])
    mark_git_cache_dirty(project_root)
    invalidate_diff_cache(project_root, str(rel_path))
    set_current_file(current_file, file_meta["sha256"])

    project_path = _history_store.get_active_project()
    if project_path and current_file:
        runtime_meta = _get_runtime_metadata()
        cache_entry = _history_store.upsert_cached_document(
            project_path=project_path,
            file_path=current_file,
            content=content,
            base_sha256=file_meta["sha256"],
            run_id=runtime_meta.get('run_id'),
            shell_id=runtime_meta.get('shell_id'),
            shell_run_id=runtime_meta.get('shell_run_id'),
            launcher_pid=runtime_meta.get('launcher_pid'),
            worker_pid=runtime_meta.get('worker_pid'),
        )
        _broadcast_cache_state(
            project_path,
            current_file,
            state='clean',
            unsaved=cache_entry.get('unsaved', False),
            cache_entry=cache_entry,
            reason='save',
        )
        removed_clean = _history_store.prune_clean_drafts(project_path)
        if removed_clean:
            try:
                from app.apps.file_editor_cm6.explorer_ws import notify_draft_state_changed
                notify_draft_state_changed(project_path)
            except Exception:
                pass

    # Refresh Diffs (Combined)
    try:
        hunks = await _get_combined_diffs_async(project_root, current_file, content)
        editor.set_diff_decorations(hunks)
    except Exception as e:
        print(f"[SAVE] Failed to refresh diffs: {e}", file=sys.stderr)

    print(f"[SAVE] Success path={current_file!r} sha={file_meta['sha256']}", file=sys.stderr)
    return file_meta

@editor_router.post('/save')
async def save_current_file(data: dict = Body(...)):
    client_id = data.get('client_id', 'unknown')
    nicegui_client_id = data.get('nicegui_client_id')
    op_id = data.get('op_id')
    current_file = get_current_file()
    base_snapshot = get_current_file_sha256()
    try:
        file_meta = await _write_editor_buffer_to_disk(client_id=client_id, op_id=op_id)

        # Notify kotlin-android LSP that a real disk save occurred (iframe save path).
        # IMPORTANT: use the same effective project root (rootRel override) that connect_lsp uses,
        # otherwise repoFingerprint won't match the LSP sidecar and cache replay will fail.
        try:
            from ..lsp_ws import send_android_did_save_for_path

            base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
            effective_project_root = base_project_root
            cfg = _get_android_lsp_config(base_project_root)
            rel_root = str(cfg.get("rootRel") or "").strip()
            if rel_root:
                candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
                if candidate.exists() and candidate.is_dir():
                    effective_project_root = candidate

            if current_file:
                ok = await send_android_did_save_for_path(project_root=effective_project_root, abs_path=Path(current_file))
                if not ok:
                    print(f"[LSP SAVE HOOK] didSave injection failed path={current_file}", file=sys.stderr)

            # Sprint A: persist TE2-side Android sidecar (dependency model skeleton + fingerprints).
            try:
                base_project_path = str(base_project_root)
                if _history_store.get_lsp_enabled(base_project_path) and _history_store.get_lsp_server_enabled(base_project_path, "kotlin-android"):
                    from app.apps.file_editor_cm6.android_lang.android_lsp_bridge import update_android_sidecar_for_project

                    async def _update_android_sidecar_bg() -> None:
                        try:
                            # 1) Update Sprint A sidecar (disk)
                            cfg = _get_android_lsp_config(base_project_root)

                            sidecar_path = await anyio.to_thread.run_sync(
                                lambda: update_android_sidecar_for_project(
                                    project_root=base_project_root,
                                    effective_project_root=effective_project_root,
                                    module=str((cfg or {}).get('module') or 'app'),
                                    variant=str((cfg or {}).get('variant') or 'GeckoDebug'),
                                )
                            )

                            # 2) Sprint B: publish conservative draft diagnostics (WARNING-level)
                            if not current_file:
                                return
                            if Path(current_file).suffix not in ('.kt', '.kts'):
                                return

                            from app.apps.file_editor_cm6.android_lang.draft_diagnostics import build_draft_diagnostics
                            from ..lsp_ws import publish_draft_diagnostics_to_client

                            uri = f"file://{current_file}"

                            def _load_sidecar_json() -> dict:
                                try:
                                    if sidecar_path and Path(sidecar_path).exists():
                                        return json.loads(Path(sidecar_path).read_text(encoding='utf-8'))
                                except Exception:
                                    return {}
                                return {}

                            te2_sidecar = await anyio.to_thread.run_sync(_load_sidecar_json)

                            # Sprint E: build/refresh dependency index on save (authoritative, may spawn Gradle).
                            try:
                                from app.apps.file_editor_cm6.android_lang.dependency_index import ensure_compiled_dependency_index

                                busy_token = await _lsp_busy_begin(
                                    project_path=base_project_root,
                                    language_id="kotlin-android",
                                    activity="gradle_dependency_index",
                                    detail="Refreshing dependency index (Gradle)…",
                                )
                                ok = True
                                err = ""
                                try:
                                    te2_sidecar = await anyio.to_thread.run_sync(
                                        lambda: ensure_compiled_dependency_index(
                                            sidecar_path=Path(sidecar_path),
                                            te2_sidecar=te2_sidecar or {},
                                            effective_project_root=effective_project_root,
                                            allow_gradle_resolve=True,
                                        )
                                    )
                                except Exception as exc:
                                    ok = False
                                    err = str(exc)
                                finally:
                                    try:
                                        await _lsp_busy_end(token=busy_token, ok=ok, error=err)
                                    except Exception:
                                        pass
                            except Exception:
                                pass

                            # Include current file content so we don't accidentally wipe draft import
                            # diagnostics (which are content-derived) during the save path.
                            try:
                                current_content = Path(current_file).read_text(encoding='utf-8', errors='replace')
                            except Exception:
                                current_content = None
                            diags = build_draft_diagnostics(te2_sidecar=te2_sidecar or {}, uri=uri, content=current_content)

                            dep = (te2_sidecar or {}).get('dependencyModel') or {}
                            android_jar = ((dep.get('androidSdk') or {}).get('androidJar') or '')
                            java_home = ((dep.get('jvm') or {}).get('javaHome') or '')
                            sync_fp = (te2_sidecar or {}).get('syncFingerprint') or ''

                            sig = f"{sync_fp}|aj={bool(android_jar)}|jh={bool(java_home)}|n={len(diags)}"
                            sig_key = f"{effective_project_root}::{uri}"
                            if _android_draft_diag_sig.get(sig_key) == sig:
                                return
                            _android_draft_diag_sig[sig_key] = sig

                            await publish_draft_diagnostics_to_client(
                                language_id='kotlin-android',
                                project_root=effective_project_root,
                                uri=uri,
                                draft_diagnostics=diags,
                                has_drafts=False,  # Just saved, no unsaved changes
                            )
                        except Exception as exc:
                            print(f"[ANDROID SIDECAR] update/publish failed: {exc}", file=sys.stderr)

                    asyncio.create_task(_update_android_sidecar_bg())
            except Exception:
                pass
        except Exception as e:
            print(f"[LSP SAVE HOOK] exception: {e}", file=sys.stderr)

        # Live autosave propagation: in autosave mode, broadcast the saved buffer
        # to other host shells via the explorer bus (SSOT active file only).
        try:
            editor_prefs = _preferences_store.get_preferences().get('editor', {})
            if editor_prefs.get('autoSave', False):
                project_path = _history_store.get_active_project()
                if project_path and current_file:
                    try:
                        editor = get_active_editor()
                        content = _get_cached_editor_content(editor) if editor else None
                    except Exception:
                        content = None
                    if content is None:
                        try:
                            content = Path(current_file).read_text(encoding='utf-8', errors='replace')
                        except Exception:
                            content = ''

                    content_hash = hashlib.sha256(content.encode('utf-8')).hexdigest() if content else ''
                    proj_norm = str(Path(project_path).expanduser().resolve(strict=False))
                    payload = {
                        "path": str(current_file),
                        "project_path": proj_norm,
                        "content": content,
                        "base_sha256": (file_meta or {}).get("sha256") or '',
                        "content_sha256": content_hash or '',
                        "source_client": nicegui_client_id,
                    }
                    from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager
                    asyncio.create_task(
                        _explorer_manager.broadcast(
                            proj_norm,
                            {"type": "autosave:content", "payload": payload},
                        )
                    )
        except Exception:
            pass

        return {"ok": True, "data": file_meta}
    except SaveValidationError as e:
        return {"ok": False, "error": e.message}
    except BaseMismatchError as e:
        print(f"[SAVE] BASE_MISMATCH path={current_file!r} expected={base_snapshot} actual={e.current_meta.get('sha256') if getattr(e, 'current_meta', None) else 'unknown'}", file=sys.stderr)
        return Response(status_code=409, content=json.dumps({"ok": False, "error": "BASE_MISMATCH", "data": {"current": e.current_meta}}), media_type="application/json")
    except Exception as e:
        print(f"[SAVE] ERROR path={current_file!r} error={e}", file=sys.stderr)
        return {"ok": False, "error": str(e)}


# --- Sprint D: Android Sync Endpoint ---

@editor_router.post('/android/sync')
async def android_sync_project(data: dict = Body(...)):
    """Sync Project with Gradle Files: rebuild dependency model + notify LSP.
    
    This is a fast, synchronous operation that:
    1. Rebuilds te2_android_sidecar.json with fresh dependency model
    2. Sends workspace/didChangeConfiguration to kotlin-android LSP
    
    Does NOT trigger a Gradle compile (that's a future sprint).
    """
    
    # 1) Get project roots (same logic as save path)
    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    effective_project_root = base_project_root
    cfg = _get_android_lsp_config(base_project_root)
    rel_root = str(cfg.get("rootRel") or "").strip()
    if rel_root:
        candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
        if candidate.exists() and candidate.is_dir():
            effective_project_root = candidate
    
    # 2) Acquire per-project lock to prevent concurrent sync requests
    lock_key = str(base_project_root)
    if lock_key not in _android_sync_locks:
        _android_sync_locks[lock_key] = asyncio.Lock()
    
    async with _android_sync_locks[lock_key]:
        try:
            # 3) Rebuild dependency model (fast, <1s)
            from app.apps.file_editor_cm6.android_lang.android_lsp_bridge import update_android_sidecar_for_project
            sidecar_path = await anyio.to_thread.run_sync(
                lambda: (
                    lambda _cfg: update_android_sidecar_for_project(
                        project_root=base_project_root,
                        effective_project_root=effective_project_root,
                        module=str((_cfg or {}).get('module') or 'app'),
                        variant=str((_cfg or {}).get('variant') or 'GeckoDebug'),
                    )
                )(
                    _get_android_lsp_config(base_project_root)
                )
            )

            # Sprint E: build dependency index once on explicit sync (may spawn Gradle).
            try:
                from app.apps.file_editor_cm6.android_lang.dependency_index import ensure_compiled_dependency_index

                def _load_sidecar_json() -> dict:
                    try:
                        return json.loads(Path(sidecar_path).read_text(encoding='utf-8'))
                    except Exception:
                        return {}

                te2_sidecar = await anyio.to_thread.run_sync(_load_sidecar_json)
                busy_token = await _lsp_busy_begin(
                    project_path=base_project_root,
                    language_id="kotlin-android",
                    activity="gradle_dependency_index",
                    detail="Syncing Android dependencies (Gradle)…",
                )
                ok = True
                err = ""
                try:
                    await anyio.to_thread.run_sync(
                        lambda: ensure_compiled_dependency_index(
                            sidecar_path=Path(sidecar_path),
                            te2_sidecar=te2_sidecar or {},
                            effective_project_root=effective_project_root,
                            allow_gradle_resolve=True,
                        )
                    )
                except Exception as exc:
                    ok = False
                    err = str(exc)
                finally:
                    try:
                        await _lsp_busy_end(token=busy_token, ok=ok, error=err)
                    except Exception:
                        pass
            except Exception:
                pass
            
            # 4) Compute repo fingerprint for LSP notification
            from ..lsp_ws import send_lsp_notification, _compute_repo_fingerprint
            
            repo_fp = await anyio.to_thread.run_sync(
                lambda: _compute_repo_fingerprint(effective_project_root)
            )
            
            # 5) Collect dirty files from ProjectSidecar
            # NOTE: Temporarily disabled until Sprint E draft-buffer diagnostics land.
            dirty_files: list[str] = []
            
            # 6) Notify kotlin-android LSP so it consumes updated model
            lsp_notified = await send_lsp_notification(
                language_id="kotlin-android",
                project_root=effective_project_root,
                message={
                    "jsonrpc": "2.0",
                    "method": "workspace/didChangeConfiguration",
                    "params": {
                        "settings": {
                            "te2Android": {
                                "repoFingerprint": repo_fp,
                                "dirtyFiles": dirty_files,
                            }
                        }
                    },
                },
                spawn_if_missing=False,
            )
            
            print(f"[ANDROID SYNC] OK sidecar={sidecar_path} lsp_notified={lsp_notified}", file=sys.stderr)
            return {
                "ok": True,
                "sidecar_path": str(sidecar_path),
                "lsp_notified": lsp_notified,
            }
        except Exception as e:
            print(f"[ANDROID SYNC] ERROR: {e}", file=sys.stderr)
            return {"ok": False, "error": str(e)}


# --- Pyright Workspace Scan Endpoint (repo-wide diagnostics dots) ---

@editor_router.post('/pyright/scan')
async def pyright_scan_project(data: dict = Body(...)):
    """Run Pyright (CLI) across the configured Pyright workspace root.

    This populates explorer warning/error dots for *all* Python files under the
    effective Pyright root, and persists a lightweight summary in ProjectSidecar
    so dots survive worker restarts.
    """

    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    effective_project_root = base_project_root
    try:
        rel_root = _history_store.get_lsp_server_root_rel(str(base_project_root), "pyright")
        if rel_root:
            candidate = (base_project_root / rel_root).expanduser().resolve(strict=False)
            if candidate.exists() and candidate.is_dir():
                effective_project_root = candidate
    except Exception:
        pass

    pyright_mode = "root"
    try:
        pyright_mode = _history_store.get_lsp_pyright_config_mode(str(base_project_root))
    except Exception:
        pyright_mode = "root"

    worker_entries = []
    try:
        from app.apps.file_editor_cm6.python_lang.worker_registry import list_python_worker_roots

        if pyright_mode == "workers":
            worker_entries = list_python_worker_roots(base_project_root)
    except Exception:
        worker_entries = []

    lock_key = str(base_project_root)

    # Supersede any in-flight scan for this project.
    try:
        existing = _pyright_scan_tasks.get(lock_key)
        if existing and not existing.done():
            existing.cancel()
    except Exception:
        pass

    async def _scan_bg() -> None:
        busy_token = await _lsp_busy_begin(
            project_path=base_project_root,
            language_id="python",
            activity="pyright_scan",
            detail="Scanning workspace (pyright)…",
        )
        ok = True
        err = ""
        try:
            from app.apps.file_editor_cm6.python_lang.pyright_workspace_scan import run_pyright_workspace_scan
            from app.apps.file_editor_cm6.project_sidecar import ProjectSidecar
            from app.apps.file_editor_cm6.explorer_ws import manager as _explorer_manager
            from app.apps.file_editor_cm6.lsp_ws import get_diagnostics_summary_for_project, _compute_repo_fingerprint

            summary_by_rel: dict[str, dict[str, int]] = {}
            if worker_entries:
                for entry in worker_entries:
                    project_path = entry.pyright_project or entry.root
                    scan = await run_pyright_workspace_scan(
                        base_project_root=base_project_root,
                        effective_project_root=entry.root,
                        project_path=project_path,
                        timeout_s=180.0,
                    )
                    for rel, counts in (scan.summary_by_rel or {}).items():
                        bucket = summary_by_rel.get(rel)
                        if not bucket:
                            bucket = {"errors": 0, "warnings": 0}
                            summary_by_rel[rel] = bucket
                        try:
                            bucket["errors"] += int((counts or {}).get("errors") or 0)
                            bucket["warnings"] += int((counts or {}).get("warnings") or 0)
                        except Exception:
                            continue
            else:
                scan = await run_pyright_workspace_scan(
                    base_project_root=base_project_root,
                    effective_project_root=effective_project_root,
                    timeout_s=180.0,
                )
                summary_by_rel = scan.summary_by_rel or {}

            repo_fp = ""
            try:
                fp_root = base_project_root if worker_entries else effective_project_root
                repo_fp = await anyio.to_thread.run_sync(lambda: _compute_repo_fingerprint(fp_root))
            except Exception:
                repo_fp = ""

            sidecar = ProjectSidecar.load_or_create(str(base_project_root))
            sidecar.set_pyright_diagnostics_summary(
                summary_by_rel=summary_by_rel,
                effective_root=str(base_project_root if worker_entries else effective_project_root),
                repo_fingerprint=repo_fp or None,
            )
            try:
                sidecar.save()
            except Exception:
                pass

            # Reconcile any stale in-memory LSP diagnostics cache for Python so explorer dots clear
            # after a scan even if the pyright LSP hasn't re-published empty diagnostics for a file.
            try:
                import app.apps.file_editor_cm6.lsp_ws as _lsp_ws_mod

                ns = getattr(_lsp_ws_mod, "_LSP_NAMESPACE_INSTANCE", None)
                if ns is not None:
                    base_root = base_project_root.expanduser().resolve(strict=False)
                    # Build a set of file:// URIs that should remain flagged after this scan.
                    keep_uris: set[str] = set()
                    for rel, counts in (summary_by_rel or {}).items():
                        try:
                            e = int((counts or {}).get("errors") or 0)
                            w = int((counts or {}).get("warnings") or 0)
                        except Exception:
                            e = 0
                            w = 0
                        if e <= 0 and w <= 0:
                            continue
                        if not isinstance(rel, str) or not rel:
                            continue
                        try:
                            abs_p = (base_root / rel).expanduser().resolve(strict=False)
                            keep_uris.add(f"file://{str(abs_p)}")
                        except Exception:
                            continue

                    for (_lang, sess_root), sess in list(getattr(ns, "backend_sessions", {}).items()):
                        try:
                            if str(_lang) not in ("python", "pyright"):
                                continue
                            if not isinstance(sess, dict):
                                continue
                            sess_root_p = Path(str(sess_root)).expanduser().resolve(strict=False)
                            # Only reconcile sessions under this base project root.
                            try:
                                sess_root_p.relative_to(base_root)
                            except ValueError:
                                continue

                            cache = sess.get("diagnostics_by_uri")
                            if not isinstance(cache, dict) or not cache:
                                continue

                            # Clear anything not present in the scan results set.
                            for uri in list(cache.keys()):
                                if not isinstance(uri, str) or not uri.startswith("file://"):
                                    continue
                                abs_path = uri[7:]
                                try:
                                    Path(abs_path).expanduser().resolve(strict=False).relative_to(base_root)
                                except Exception:
                                    continue
                                if uri not in keep_uris:
                                    cache.pop(uri, None)
                        except Exception:
                            continue
            except Exception:
                pass

            # Trigger an immediate explorer refresh (the periodic loop will also pick it up).
            try:
                summary = get_diagnostics_summary_for_project(project_root=str(base_project_root))
                await _explorer_manager.broadcast(
                    str(base_project_root),
                    {"type": "explorer:updateDiagnostics", "payload": {"diagnostics": summary}},
                )
            except Exception:
                pass
        except asyncio.CancelledError:
            ok = False
            err = "superseded"
        except Exception as exc:
            ok = False
            err = str(exc)
        finally:
            try:
                await _lsp_busy_end(token=busy_token, ok=ok, error=err)
            except Exception:
                pass

    task = asyncio.create_task(_scan_bg())
    _pyright_scan_tasks[lock_key] = task

    return {
        "ok": True,
        "started": True,
        "baseProjectRoot": str(base_project_root),
        "effectiveProjectRoot": str(effective_project_root),
    }


# --- Pyright worker registry endpoints (repo-scoped config) ---

@editor_router.get('/pyright/workers')
async def pyright_workers_get():
    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    try:
        from app.apps.file_editor_cm6.python_lang.worker_registry import (
            load_python_worker_registry,
            serialize_worker_entries,
            get_registry_path,
        )

        entries = load_python_worker_registry(base_project_root)
        payload = serialize_worker_entries(base_project_root, entries)
        mode = _history_store.get_lsp_pyright_config_mode(str(base_project_root))
        return {
            "ok": True,
            "data": {
                "projectRoot": str(base_project_root),
                "registryPath": str(get_registry_path(base_project_root)),
                "mode": mode,
                "workers": payload,
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@editor_router.post('/pyright/workers/save')
async def pyright_workers_save(data: dict = Body(...)):
    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    items = data.get("workers", [])
    try:
        from app.apps.file_editor_cm6.python_lang.worker_registry import (
            normalize_worker_payload,
            save_python_worker_registry,
            serialize_worker_entries,
        )

        entries, errors = normalize_worker_payload(base_project_root, items if isinstance(items, list) else [])
        path = save_python_worker_registry(base_project_root, entries, generated=False)
        payload = serialize_worker_entries(base_project_root, entries)
        return {
            "ok": True,
            "data": {
                "projectRoot": str(base_project_root),
                "path": str(path),
                "workers": payload,
                "errors": errors,
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@editor_router.post('/pyright/workers/generate')
async def pyright_workers_generate(data: dict = Body(...)):
    base_project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    save = bool(data.get("save", False))
    try:
        from app.apps.file_editor_cm6.python_lang.worker_registry import (
            discover_python_worker_entries,
            save_python_worker_registry,
            serialize_worker_entries,
        )

        entries = discover_python_worker_entries(base_project_root)
        if save:
            save_python_worker_registry(base_project_root, entries, generated=True)
        payload = serialize_worker_entries(base_project_root, entries)
        return {
            "ok": True,
            "data": {
                "projectRoot": str(base_project_root),
                "workers": payload,
                "saved": save,
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# --- Pyright config endpoints (pyrightconfig.json / pyproject.toml) ---

_PYRIGHT_SIMPLE_KEYS = (
    "typeCheckingMode",
    "pythonVersion",
    "pythonPlatform",
    "include",
    "exclude",
    "ignore",
    "venvPath",
    "venv",
)


def _resolve_project_file(project_root: Path, raw_path: str) -> Path:
    rel = _normalize_rel_path(project_root, raw_path)
    return (project_root / rel).expanduser().resolve(strict=False)


def _toml_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _toml_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        items = []
        for item in value:
            if isinstance(item, (int, float)):
                items.append(str(item))
            else:
                items.append(f"\"{_toml_escape(str(item))}\"")
        return f"[{', '.join(items)}]"
    return f"\"{_toml_escape(str(value))}\""


def _toml_block_lines(config: dict) -> list[str]:
    lines = ["[tool.pyright]"]
    for key in _PYRIGHT_SIMPLE_KEYS:
        if key not in config:
            continue
        val = config.get(key)
        if val is None:
            continue
        if isinstance(val, str) and not val.strip():
            continue
        if isinstance(val, list) and not val:
            continue
        lines.append(f"{key} = {_toml_value(val)}")
    return lines


def _update_pyright_toml(text: str, config: dict) -> str:
    import re

    pattern = re.compile(r"(?ms)^\\[tool\\.pyright\\]\\s*$.*?(?=^\\[[^\\]]+\\]\\s*$|\\Z)")
    match = pattern.search(text or "")
    new_lines = _toml_block_lines(config)

    if match:
        block = match.group(0)
        block_lines = block.splitlines()
        kept = [block_lines[0]]
        for line in block_lines[1:]:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith(";"):
                kept.append(line)
                continue
            key = stripped.split("=", 1)[0].strip()
            if key in _PYRIGHT_SIMPLE_KEYS:
                continue
            kept.append(line)

        # Ensure a blank line before new keys if existing content present.
        if len(kept) > 1 and kept[-1].strip():
            kept.append("")
        kept.extend(new_lines[1:])

        replacement = "\n".join(kept).rstrip() + "\n"
        return text[: match.start()] + replacement + text[match.end() :]

    # No existing block: append one.
    base = text or ""
    if base and not base.endswith("\n"):
        base += "\n"
    if base and not base.endswith("\n\n"):
        base += "\n"
    return base + "\n".join(new_lines).rstrip() + "\n"


@editor_router.get('/pyright/config')
async def pyright_config_get(path: str = Query(...)):
    project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    try:
        abs_path = _resolve_project_file(project_root, path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    kind = "toml" if abs_path.suffix.lower() == ".toml" else "json"
    config: dict = {}

    if abs_path.exists():
        try:
            raw = abs_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            raw = ""
        if kind == "json":
            try:
                config = json.loads(raw) if raw.strip() else {}
            except Exception:
                config = {}
        else:
            try:
                import tomllib  # Python 3.11+

                data = tomllib.loads(raw) if raw.strip() else {}
                tool = data.get("tool") if isinstance(data, dict) else None
                if isinstance(tool, dict):
                    pyright_cfg = tool.get("pyright")
                    if isinstance(pyright_cfg, dict):
                        config = dict(pyright_cfg)
            except Exception:
                config = {}

    return {
        "ok": True,
        "data": {
            "path": str(abs_path),
            "kind": kind,
            "config": config or {},
        },
    }


@editor_router.post('/pyright/config/save')
async def pyright_config_save(data: dict = Body(...)):
    project_root = Path(_history_store.get_active_project() or str(get_project_root()))
    raw_path = data.get("path") or ""
    config_in = data.get("config") or {}
    if not isinstance(config_in, dict):
        raise HTTPException(status_code=400, detail="config must be an object")

    try:
        abs_path = _resolve_project_file(project_root, raw_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    kind = "toml" if abs_path.suffix.lower() == ".toml" else "json"

    if kind == "json":
        abs_path.write_text(json.dumps(config_in, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return {"ok": True, "data": {"path": str(abs_path), "kind": kind, "config": config_in}}

    # TOML (pyproject.toml): update [tool.pyright] block
    existing = ""
    try:
        if abs_path.exists():
            existing = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        existing = ""

    # Keep only known simple keys (others stay in file untouched).
    config: dict = {}
    for key in _PYRIGHT_SIMPLE_KEYS:
        if key in config_in:
            config[key] = config_in.get(key)

    updated = _update_pyright_toml(existing, config)
    abs_path.write_text(updated, encoding="utf-8")
    return {"ok": True, "data": {"path": str(abs_path), "kind": kind, "config": config}}


# --- Android config endpoints (Gradle/LSP support) ---

def _get_android_lsp_config(base_root: Path) -> dict:
    try:
        from app.apps.file_editor_cm6.android_lang.android_lsp_config import get_android_lsp_config

        return get_android_lsp_config(base_root)
    except Exception:
        return {"rootRel": "", "module": "app", "variant": "GeckoDebug"}

def _resolve_android_roots() -> tuple[Path, Path, str]:
    base_root = Path(_history_store.get_active_project() or str(get_project_root()))
    effective_root = base_root
    cfg = _get_android_lsp_config(base_root)
    root_rel = str(cfg.get("rootRel") or "").strip()
    if root_rel:
        candidate = (base_root / root_rel).expanduser().resolve(strict=False)
        if candidate.exists() and candidate.is_dir():
            effective_root = candidate

    module = str(cfg.get("module") or "app")

    return base_root, effective_root, module


@editor_router.get('/android/config')
async def android_config_get():
    base_root, effective_root, module = _resolve_android_roots()
    data = collect_android_config(effective_root=effective_root, module=module)
    data["projectRoot"] = str(base_root)
    data["effectiveRoot"] = str(effective_root)
    data["module"] = module
    try:
        from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_autodetect

        autodetect = {
            "files": data.get("files") or {},
            "gradleProperties": data.get("gradleProperties") or {},
            "localProperties": data.get("localProperties") or {},
            "buildConfig": data.get("buildConfig") or {},
            "modules": data.get("modules") or [],
            "variants": data.get("variants") or {},
            "sourceSets": data.get("sourceSets") or [],
            "termuxAapt2Path": data.get("termuxAapt2Path") or "",
            "importantGradleProperties": data.get("importantGradleProperties") or [],
        }
        update_android_autodetect(base_root, autodetect)
    except Exception:
        pass
    return {"ok": True, "data": data}


@editor_router.post('/set_active_project')
async def set_active_project(payload: dict = Body(...)):
    project_path = payload.get("projectPath") if isinstance(payload, dict) else None
    if not project_path:
        raise HTTPException(status_code=400, detail="projectPath required")
    try:
        from app.apps.file_editor_cm6.explorer_helper import set_project_root
        from app.apps.file_editor_cm6.core_read import init_watcher

        normalized = _history_store.set_active_project(str(project_path))
        if not normalized:
            raise ValueError("invalid project path")
        root = set_project_root(normalized)
        init_watcher(root)
        return {"ok": True, "projectRoot": str(root)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@editor_router.post('/android/config/save')
async def android_config_save(payload: dict = Body(...)):
    base_root, effective_root, module_default = _resolve_android_roots()
    module = str(payload.get("module") or module_default).strip() or module_default
    create_missing = bool(payload.get("createMissing", False))

    cfg = collect_android_config(effective_root=effective_root, module=module)
    files = cfg.get("files") or {}

    gradle_updates = payload.get("gradleProperties") or {}
    local_updates = payload.get("localProperties") or {}
    build_updates = payload.get("buildGradle") or {}

    if not isinstance(gradle_updates, dict) or not isinstance(local_updates, dict) or not isinstance(build_updates, dict):
        raise HTTPException(status_code=400, detail="updates must be objects")

    if "sdkDir" in local_updates and "sdk.dir" not in local_updates:
        local_updates["sdk.dir"] = local_updates.get("sdkDir")

    results = {"gradleProperties": {}, "localProperties": {}, "buildGradle": {}}

    gradle_props_path = Path(files.get("gradleProperties", {}).get("path") or (effective_root / "gradle.properties"))
    if gradle_updates:
        results["gradleProperties"] = update_properties_file(
            gradle_props_path,
            gradle_updates,
            create_missing=create_missing,
        )

    local_props_path = Path(files.get("localProperties", {}).get("path") or (effective_root / "local.properties"))
    if local_updates:
        results["localProperties"] = update_properties_file(
            local_props_path,
            local_updates,
            create_missing=create_missing,
        )

    build_path = None
    module_build = files.get("moduleBuildGradle", {}).get("path")
    root_build = files.get("rootBuildGradle", {}).get("path")
    if module_build:
        build_path = Path(module_build)
    elif root_build:
        build_path = Path(root_build)

    if build_updates:
        results["buildGradle"] = update_build_gradle(build_path, build_updates)

    updated = collect_android_config(effective_root=effective_root, module=module)
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module
    try:
        from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_lsp_config, update_android_autodetect

        update_android_lsp_config(base_root, module=module)
        autodetect = {
            "files": updated.get("files") or {},
            "gradleProperties": updated.get("gradleProperties") or {},
            "localProperties": updated.get("localProperties") or {},
            "buildConfig": updated.get("buildConfig") or {},
            "modules": updated.get("modules") or [],
            "variants": updated.get("variants") or {},
            "sourceSets": updated.get("sourceSets") or [],
            "termuxAapt2Path": updated.get("termuxAapt2Path") or "",
            "importantGradleProperties": updated.get("importantGradleProperties") or [],
        }
        update_android_autodetect(base_root, autodetect)
    except Exception:
        pass

    return {"ok": True, "data": {"results": results, "config": updated}}


def _normalize_android_source_set_name(name: object) -> str:
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    import re
    raw = str(name).strip()
    if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", raw):
        raw = re.sub(r"[^A-Za-z0-9_]", "_", raw)
        raw = re.sub(r"_+", "_", raw).strip("_")
        if not raw or not re.match(r"^[A-Za-z]", raw):
            raise HTTPException(status_code=400, detail="invalid source set name")
    return raw


def _create_android_source_set_dirs(
    *,
    effective_root: Path,
    module_name: str,
    name: object,
    include: dict | None,
) -> tuple[str, list[str], list[str]]:
    include = include if isinstance(include, dict) else {}
    include_code = bool(include.get("code", True))
    include_res = bool(include.get("res", True))
    include_manifest = bool(include.get("manifest", False))

    name = _normalize_android_source_set_name(name)

    created: list[str] = []
    existing: list[str] = []

    src_root = (effective_root / module_name / "src").expanduser().resolve(strict=False)
    target_root = (src_root / name).expanduser().resolve(strict=False)
    if not str(target_root).startswith(str(effective_root.expanduser().resolve(strict=False))):
        raise HTTPException(status_code=400, detail="invalid source set path")

    def _touch_dir(path: Path) -> None:
        if path.exists():
            existing.append(str(path))
            return
        path.mkdir(parents=True, exist_ok=True)
        created.append(str(path))

    def _touch_file(path: Path, content: str) -> None:
        if path.exists():
            existing.append(str(path))
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        created.append(str(path))

    _touch_dir(target_root)
    if include_code:
        _touch_dir(target_root / "java")
        _touch_dir(target_root / "kotlin")
    if include_res:
        _touch_dir(target_root / "res")
    if include_manifest:
        _touch_file(
            target_root / "AndroidManifest.xml",
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\n"
            "</manifest>\n",
        )

    return name, created, existing


@editor_router.post('/android/source_set/create')
async def android_source_set_create(payload: dict = Body(...)):
    base_root, effective_root, module_default = _resolve_android_roots()
    name = payload.get("name") if isinstance(payload, dict) else None
    module_name = str(payload.get("module") or module_default or "app").strip() or "app"
    include = payload.get("include") if isinstance(payload, dict) else None
    name, created, existing = _create_android_source_set_dirs(
        effective_root=effective_root,
        module_name=module_name,
        name=name,
        include=include,
    )

    updated = collect_android_config(effective_root=effective_root, module=module_name)
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module_name
    try:
        from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_autodetect

        autodetect = {
            "files": updated.get("files") or {},
            "gradleProperties": updated.get("gradleProperties") or {},
            "localProperties": updated.get("localProperties") or {},
            "buildConfig": updated.get("buildConfig") or {},
            "modules": updated.get("modules") or [],
            "variants": updated.get("variants") or {},
            "sourceSets": updated.get("sourceSets") or [],
            "termuxAapt2Path": updated.get("termuxAapt2Path") or "",
            "importantGradleProperties": updated.get("importantGradleProperties") or [],
        }
        update_android_autodetect(base_root, autodetect)
    except Exception:
        pass

    return {"ok": True, "data": {"created": created, "existing": existing, "name": name, "config": updated}}


@editor_router.post('/android/variant/create')
async def android_variant_create(payload: dict = Body(...)):
    base_root, effective_root, module_default = _resolve_android_roots()
    name = payload.get("name") if isinstance(payload, dict) else None
    kind = str(payload.get("type") or "").strip()
    if kind not in ("buildType", "flavor"):
        raise HTTPException(status_code=400, detail="invalid variant type")
    module_name = str(payload.get("module") or module_default or "app").strip() or "app"
    dimension = str(payload.get("dimension") or "").strip() or None
    create_source_set = bool(payload.get("createSourceSet", False)) if isinstance(payload, dict) else False

    name = _normalize_android_source_set_name(name)

    cfg = collect_android_config(effective_root=effective_root, module=module_name)
    files = cfg.get("files") or {}
    module_build = files.get("moduleBuildGradle", {}).get("path")
    root_build = files.get("rootBuildGradle", {}).get("path")
    build_path = Path(module_build or root_build or "")
    if not build_path or not build_path.is_file():
        raise HTTPException(status_code=400, detail="build.gradle not found")

    from app.apps.file_editor_cm6.android_lang.android_config import update_build_gradle_variants

    result = update_build_gradle_variants(
        build_path,
        kind=kind,
        name=name,
        flavor_dimension=dimension,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    created = []
    existing = []
    if create_source_set:
        _, created, existing = _create_android_source_set_dirs(
            effective_root=effective_root,
            module_name=module_name,
            name=name,
            include={"code": True, "res": True, "manifest": False},
        )

    updated = collect_android_config(effective_root=effective_root, module=module_name)
    updated["projectRoot"] = str(base_root)
    updated["effectiveRoot"] = str(effective_root)
    updated["module"] = module_name
    try:
        from app.apps.file_editor_cm6.android_lang.android_lsp_config import update_android_autodetect

        autodetect = {
            "files": updated.get("files") or {},
            "gradleProperties": updated.get("gradleProperties") or {},
            "localProperties": updated.get("localProperties") or {},
            "buildConfig": updated.get("buildConfig") or {},
            "modules": updated.get("modules") or [],
            "variants": updated.get("variants") or {},
            "sourceSets": updated.get("sourceSets") or [],
            "termuxAapt2Path": updated.get("termuxAapt2Path") or "",
            "importantGradleProperties": updated.get("importantGradleProperties") or [],
        }
        update_android_autodetect(base_root, autodetect)
    except Exception:
        pass

    return {
        "ok": True,
        "data": {
            "result": result,
            "created": created,
            "existing": existing,
            "name": name,
            "config": updated,
        },
    }


@editor_router.post('/set_view_settings')
async def set_view_settings(data: dict = Body(...)):
    # This endpoint handles live updates to the editor's visual settings.
    editor = get_active_editor()
    editor_updates = {}
    
    if 'word_wrap' in data:
        word_wrap = bool(data['word_wrap'])
        editor_updates['wordWrap'] = word_wrap
        if editor: editor.set_line_wrapping(word_wrap); editor.update()
    
    if 'line_shading' in data:
        line_shading = bool(data['line_shading'])
        editor_updates['showShading'] = line_shading
        if editor: editor.set_zebra_stripes(line_shading)

    if 'indent_guides' in data:
        show_guides = bool(data['indent_guides'])
        editor_updates['showIndentGuides'] = show_guides
        if editor: editor.set_indent_guides(show_guides)
    
    if 'show_inline_diffs' in data:
        show_diffs = bool(data['show_inline_diffs'])
        editor_updates['showInlineDiffs'] = show_diffs
        if show_diffs and editor and 'current_path' in data:
            try:
                project_path = _history_store.get_active_project() or str(get_project_root())
                rel = _normalize_rel_path(Path(project_path).expanduser(), data['current_path'])
                diff_data = collect_diff(Path(project_path).expanduser(), rel, base_ref=_current_diff_base(project_path))
                editor.set_diff_decorations(diff_data.get('hunks', []))
            except Exception as e:
                print(f"[DIFF] Failed to load diffs on toggle: {e}", file=sys.stderr)
        elif not show_diffs and editor:
            editor.set_diff_decorations([])
            
    if 'theme' in data:
        theme_name = str(data['theme'])
        editor_updates['theme'] = theme_name
        try:
            mapped_theme = _resolve_theme_preference(theme_name)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if editor:
            editor.set_theme(mapped_theme)
        
    if editor_updates:
        _preferences_store.update_preferences(editor=editor_updates)
    
    return {"ok": True}

@editor_router.post('/set_font_scale')
async def set_font_scale_endpoint(data: dict = Body(...)):
    """Set editor font scale from one of three presets: 0.70, 0.85, 1.0"""
    try:
        editor = get_active_editor()
        
        # Validate input (reuse preference helper for consistent messaging)
        try:
            scale = _resolve_font_scale(data.get('scale'))
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        
        # Apply to editor
        if editor:
            try:
                editor.set_font_scale(scale)
                print(f"[EDITOR] Font scale changed to: {scale}", file=sys.stderr)
            except Exception as e:
                print(f"[EDITOR] Failed to set font scale: {e}", file=sys.stderr)
                raise HTTPException(status_code=500, detail=f"Failed to apply font scale: {e}")
        
        # Persist preference (GLOBALLY, not per-project)
        try:
            _preferences_store.update_preferences(
                editor={"fontScale": scale}
            )
            print(f"[EDITOR] Persisted font scale: {scale} globally", file=sys.stderr)
        except Exception as e:
            print(f"[EDITOR] Failed to persist font scale: {e}", file=sys.stderr)
            raise HTTPException(status_code=500, detail=f"Failed to persist font scale: {e}")
        
        return {"ok": True, "data": {"fontScale": scale}}
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[EDITOR] Unexpected error in set_font_scale: {e}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Internal error: {e}")
def handle_external_discard(project_path: str, file_path: str):
    """
    Handle a discard event triggered externally (e.g. from Review panel).
    If the discarded file is currently open, revert the editor content to disk.
    """
    editor = get_active_editor()
    current = get_current_file()
    
    # Check if the discarded file is the one currently open
    if editor and current and os.path.abspath(file_path) == os.path.abspath(current):
        print(f"[EDITOR] External discard detected for active file: {file_path}", file=sys.stderr)
        
        # Read from disk
        try:
            if os.path.exists(file_path):
                content = Path(file_path).read_text(encoding='utf-8', errors='replace')
                # Calculate disk SHA
                sha = hashlib.sha256(content.encode('utf-8')).hexdigest()
            else:
                content = ''
                sha = None
                
            # Update editor (revert)
            editor.set_value(content)
            editor._cached_content = content
            set_current_file(file_path, sha)
            
            # Broadcast clean state
            _broadcast_cache_state(
                project_path,
                file_path,
                state='clean',
                unsaved=False,
                reason='discard_external'
            )
            
            # Notify user
            editor.notify_parent('notification', {
                'message': 'Draft discarded from Review panel',
                'type': 'info'
            })
            
            # Refresh diffs (now clean)
            editor.set_diff_decorations([])
            
        except Exception as e:
            print(f"[EDITOR] Failed to revert active file: {e}", file=sys.stderr)

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
