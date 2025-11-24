# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

import json
import sys
import os
import hashlib
import time
import shlex
from pathlib import Path
from typing import Optional
import anyio

from nicegui import ui, app as nicegui_app
from fastapi import APIRouter, Body, HTTPException, Query, Response

# --- Local Imports ---
# Import stores as singletons from the new stores module
from app.apps.file_editor_cm6.stores import _history_store, _preferences_store
from app.apps.file_editor_cm6.preferences_store import ALLOWED_FONT_SCALES
# Import helpers
from app.apps.file_editor_cm6.explorer_helper import get_project_root, _normalize_rel_path, mark_git_cache_dirty
from app.apps.file_editor_cm6.core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe
from app.apps.file_editor_cm6.core_write import write_full, BaseMismatchError
from app.apps.file_editor_cm6.terminal_shell import create_editor_shell
from app.libs.framework_shells import get_manager
from app.apps.file_editor_cm6.diff_helper import invalidate_diff_cache, collect_diff


# --- FastAPI Router ---
editor_router = APIRouter(prefix="/editor")

# --- Global State ---
_active_editor = None
_current_file_path = None
_current_file_sha256 = None
_edit_tracker_subscription = None
_cache_persist_timer = None
_cache_persist_debounce_ms = 1000  # 1 second debounce

# --- Constants ---
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

RUNNABLE_COMMANDS = {
    '.py': ['python3'],
    '.pyw': ['python3'],
    '.sh': ['bash'],
    '.bash': ['bash'],
    '.zsh': ['zsh'],
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

def set_current_file(path: str, sha256: str = None):
    global _current_file_path, _current_file_sha256
    _current_file_path = path
    _current_file_sha256 = sha256

def get_current_file():
    return _current_file_path

def get_current_file_sha256():
    return _current_file_sha256

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

    payload = {
        "path": resolved_path or None,
        "project_path": project_path,
        "relative_path": rel_path,
        "file_label": file_label,
        "directory_label": rel_path or directory or None,
        "absolute_directory": directory or None,
        "state": state,
        "unsaved": bool(unsaved),
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
    editor = get_active_editor()
    if not editor or not file_path:
        return
    payload = _build_cache_state_payload(
        project_path,
        file_path,
        state=state,
        unsaved=unsaved,
        cache_entry=cache_entry,
        reason=reason,
    )
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

    Returns True when an external change forced the cached draft to be cleared.
    """
    editor = get_active_editor()
    if not editor or not path:
        return False

    editor.set_value(content)
    editor._cached_content = content
    set_current_file(path, sha256)

    cache_entry = None
    external_change = False
    if project_path:
        cache_entry = _history_store.get_cached_document(project_path, path)
        cached_sha = cache_entry.get('content_sha256') if cache_entry else None
        if cache_entry and cached_sha and sha256 and cached_sha != sha256:
            print(f"[SESSION_CACHE] External edit detected for {path}; clearing cached draft", file=sys.stderr)
            _history_store.clear_cached_document(project_path, path)
            cache_entry = None
            external_change = True

    _broadcast_cache_state(
        project_path,
        path,
        state='clean',
        unsaved=False,
        cache_entry=cache_entry,
        reason='watcher_external' if external_change else reason,
    )

    if external_change:
        try:
            editor.set_diff_decorations([])
        except Exception as err:
            print(f"[DIFF] Failed to clear decorations after external edit: {err}", file=sys.stderr)

    return external_change


def _persist_to_cache_debounced():
    """Debounced cache persistence called on editor change."""
    global _cache_persist_timer
    
    editor = get_active_editor()
    current_file = get_current_file()
    current_sha = get_current_file_sha256()
    
    if not editor or not current_file:
        return
    
    project_path = _history_store.get_active_project()
    if not project_path:
        return
    
    current_content = _get_cached_editor_content(editor)
    print(f"[SESSION_CACHE] snapshot path={current_file} len={len(current_content)} sha256={hashlib.sha256(current_content.encode('utf-8')).hexdigest() if current_content else '0'*64}", file=sys.stderr)
    
    # Collect runtime metadata
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
    
    print(f"[SESSION_CACHE] Persisted draft for {current_file}", file=sys.stderr)

    _broadcast_cache_state(
        project_path,
        current_file,
        state='mid_session',
        unsaved=cache_entry.get('unsaved', False),
        cache_entry=cache_entry,
        reason='persist',
    )

def _schedule_cache_persist():
    """Schedule debounced cache persistence."""
    global _cache_persist_timer
    
    if _cache_persist_timer:
        _cache_persist_timer.cancel()
    
    _cache_persist_timer = ui.timer(
        _cache_persist_debounce_ms / 1000,
        _persist_to_cache_debounced,
        once=True
    )

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
@ui.page('/nc', reconnect_timeout=3.0)
async def editor_page():
    global _active_editor
    
    print(f"[EDITOR_APP] ==================== PAGE LOAD ====================", file=sys.stderr)
    
    # 1. Load Preferences and History
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    font_scale_pref = _resolve_font_scale(editor_prefs.get('fontScale'))
    
    # 2. Determine and Load Initial File
    project_path = _history_store.get_active_project()
    last_file = _history_store.get_last_file(project_path) if project_path else None
    
    initial_content = ''
    initial_language = 'text'
    initial_path = None
    initial_sha256 = None
    restored_state = None

    if last_file and Path(last_file).is_file():
        try:
            content_bytes = Path(last_file).read_bytes()
            initial_content = content_bytes.decode('utf-8', errors='replace')
            initial_path = last_file
            initial_sha256 = hashlib.sha256(content_bytes).hexdigest()
            
            if last_file.endswith(('.py', '.pyw')): initial_language = 'python'
            elif last_file.endswith('.js'): initial_language = 'javascript'
            elif last_file.endswith('.ts'): initial_language = 'typescript'
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
        if cached_entry and isinstance(cached_entry.get('content'), str):
            runtime_meta = _get_runtime_metadata()
            cached_run = cached_entry.get('run_id', 'unknown')
            restored_state = 'mid_session' if cached_run == runtime_meta.get('run_id') else 'crashed'
            initial_content = cached_entry.get('content')
            initial_sha256 = cached_entry.get('base_sha256') or hashlib.sha256(initial_content.encode('utf-8')).hexdigest()
            cached_was_restored = True
            print(f"[EDITOR_APP] Restored cached session ({restored_state}) for {initial_path}", file=sys.stderr)

    # 3. Set up UI
    ui.add_head_html('''
    <style>
      html, body, #q-app, .q-page-container, .q-page, .nicegui-content { margin:0 !important; padding:0 !important; height:100%; }
      body { overflow: hidden; }
    </style>
    ''')
    
    with ui.element('div').style('width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #0b0f1a; color: #e5e7eb; overflow: hidden;'):
        with ui.element('div').style('flex: 1; display: flex; flex-direction: column; overflow: hidden;').classes('editor-wrapper w-full h-full'):
            
            # 4. Create Editor with Auto-Loaded Content
            def _on_editor_change(event):
                # Use the authoritative backend value; event.value can lag during init.
                value = editor.value or ''
                print(f"[ON_CHANGE] len={len(value)} sha={hashlib.sha256(value.encode('utf-8')).hexdigest() if value else '0'*64}", file=sys.stderr)
                editor._cached_content = value
                _schedule_cache_persist()
            
            # Debug: What are we passing to the editor?
            theme_from_prefs = editor_prefs.get('theme')
            theme_mapped = _resolve_theme_preference(theme_from_prefs)
            print(
                f"[EDITOR_APP] Theme loading: file={theme_from_prefs} -> mapped={theme_mapped}; fontScale={font_scale_pref}",
                file=sys.stderr,
            )
            
            editor = ui.codemirror(
                value=initial_content,
                language=initial_language,
                theme=theme_mapped,
                line_wrapping=editor_prefs.get('wordWrap'),
                font_scale=font_scale_pref,
                on_change=_on_editor_change,
            ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
            editor._cached_content = initial_content

            # 5. Set Global State and Apply ALL Settings (Single Source of Truth)
            _active_editor = editor
            set_current_file(initial_path, initial_sha256)
            
            # Apply runtime-only preferences (not available in constructor)
            # NOTE: theme and line_wrapping already set in constructor above
            print(f"[EDITOR_APP] Editor created with theme={theme_from_prefs}, wrap={editor_prefs.get('wordWrap')}", file=sys.stderr)
            
            editor.set_zebra_stripes(editor_prefs.get('showShading', False))
            editor.set_font_scale(font_scale_pref)
            editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
            # Theme and line wrapping already applied in constructor - don't re-apply
            editor.toggle_color_picker(editor_prefs.get('colorPicker', True))
            editor.set_read_only(editor_prefs.get('readOnly', False))
            
            print(f"[EDITOR_APP] Applied runtime preferences: shading={editor_prefs.get('showShading')}, guides={editor_prefs.get('showIndentGuides')}, fontScale={editor_prefs.get('fontScale')}, colorPicker={editor_prefs.get('colorPicker')}, readOnly={editor_prefs.get('readOnly')}", file=sys.stderr)

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
                ui.notify(
                    'Restored unsaved draft' if restored_state == 'mid_session' else 'Recovered changes from prior crash',
                    color='orange',
                    position='top',
                )
            
            # 6. Load Diffs if Enabled
            if editor_prefs.get('showInlineDiffs', False) and initial_path and project_path:
                try:
                    project_root = Path(project_path).expanduser()
                    rel = _normalize_rel_path(project_root, initial_path)
                    diff_data = collect_diff(project_root, rel, base_ref=_current_diff_base(project_path))
                    editor.set_diff_decorations(diff_data.get('hunks', []))
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
                        _apply_watcher_replace(
                            path=initial_path,
                            content=new_content,
                            sha256=new_sha256,
                            project_path=project_path,
                        )
                        if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
                            try:
                                rel_path = _normalize_rel_path(project_root, initial_path)
                                diff_data = collect_diff(project_root, rel_path, base_ref=_current_diff_base(project_path))
                                editor.set_diff_decorations(diff_data.get('hunks', []))
                            except Exception as e:
                                print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)
                
                subscribe(initial_path, 'nicegui_backend', on_file_change)

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
    /* tint the fold/twisty gutter for  deletion rows */
    .cm-foldGutter .cm-gutterElement.cm-diff-deleted-lineno {
       background-color: var(--diff-del-bg);
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
      background-color: var(--diff-del-bg);
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

    if cleared and path == get_current_file():
        _broadcast_cache_state(
            project_path,
            path,
            state='clean',
            unsaved=False,
            reason='discard',
        )
    
    return {"ok": True, "data": {"cleared": cleared}}

@editor_router.post('/set_content')
async def set_editor_content(data: dict = Body(...)):
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    
    new_path = data.get('path', '')
    old_path = get_current_file()
    project_path = _history_store.get_active_project()
    
    print(f"[SET_CONTENT] path={new_path!r} old={old_path!r}", file=sys.stderr)

    # NEW: Clear cache for old document if switching
    if old_path and old_path != new_path and project_path:
        _history_store.clear_cached_document(project_path, old_path)
    
    content = data.get('content')
    if content is None:
        content = ''
    language = data.get('language', 'python')
    content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
    set_current_file(new_path, content_sha256)
    
    editor.set_value(content)
    editor._cached_content = content
    editor.set_language(language)
    editor.update()

    _broadcast_cache_state(
        project_path,
        new_path,
        state='clean',
        unsaved=False,
        reason='set_content',
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
            if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
                try:
                    rel_path = _normalize_rel_path(project_root, new_path)
                    diff_data = collect_diff(project_root, rel_path, base_ref=_current_diff_base(project_path))
                    editor.set_diff_decorations(diff_data.get('hunks', []))
                except Exception as e:
                    print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)

    subscribe(new_path, 'nicegui_backend_set_content', on_file_change)
    
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
    # Single update() call after all preferences applied
    editor.update()
    
    print(f"[SET_CONTENT] Applied all preferences from disk", file=sys.stderr)
    
    if editor_prefs.get('showInlineDiffs', False) and new_path:
        try:
            project_path = _history_store.get_active_project() or str(get_project_root())
            rel = _normalize_rel_path(Path(project_path).expanduser(), new_path)
            diff_data = collect_diff(Path(project_path).expanduser(), rel, base_ref=_current_diff_base(project_path))
            editor.set_diff_decorations(diff_data.get('hunks', []))
        except Exception: editor.set_diff_decorations([])
    else: editor.set_diff_decorations([])
    
    return {"ok": True, "sha256": content_sha256}

@editor_router.post('/refresh_diffs')
async def refresh_diffs(data: dict = Body(...)):
    path = data.get('path')
    if not path: return {"ok": False, "error": "No path provided"}
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    
    try:
        project_path = _history_store.get_active_project() or str(get_project_root())
        if not project_path: return {"ok": False, "error": "No project selected"}
        
        project_root = Path(project_path).expanduser()
        rel = _normalize_rel_path(project_root, path)
        diff_data = collect_diff(project_root, rel, base_ref=_current_diff_base(project_path))
        hunks = diff_data.get('hunks', [])
        editor.set_diff_decorations(hunks)
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
    """Jump to a line in the currently loaded file. Does NOT load new files."""
    target_line = data.get('line', 1)
    editor = get_active_editor()
    if not editor: 
        return {"ok": False, "error": "Editor not ready"}
    
    print(f"[JUMP_TO_LINE] Scrolling to line {target_line}", file=sys.stderr)
    
    # Use the vendored CodeMirror jump_to_line method
    editor.jump_to_line(target_line)
    
    return {"ok": True, "line": target_line}

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


# --- Helper Function for View State ---
def _get_view_state_dict() -> dict:
    """Helper to get current view state from preferences (single source of truth)."""
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
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
    
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    
    editor = get_active_editor()
    if not editor:
        raise HTTPException(status_code=404, detail="Editor not initialized")
    
    # Validate key is in DEFAULT_EDITOR_PREFS
    from app.apps.file_editor_cm6.preferences_store import DEFAULT_EDITOR_PREFS
    if key not in DEFAULT_EDITOR_PREFS:
        raise HTTPException(status_code=400, detail=f"Invalid preference key: {key}")
    
    # Apply to editor immediately based on key; persist only after success
    try:
        if key == 'wordWrap':
            editor.set_line_wrapping(bool(value))
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
                            editor.set_diff_decorations(diff_data.get('hunks', []))
                            print(f"[PREFERENCE] Refreshed diffs after word wrap enabled", file=sys.stderr)
                        except Exception as e:
                            print(f"[PREFERENCE] Failed to refresh diffs: {e}", file=sys.stderr)
        elif key == 'showShading':
            editor.set_zebra_stripes(bool(value))
        elif key == 'showIndentGuides':
            editor.set_indent_guides(bool(value))
        elif key == 'theme':
            theme_value = str(value)
            try:
                mapped_theme = _resolve_theme_preference(theme_value)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            value = theme_value
            editor.set_theme(mapped_theme)
        elif key == 'fontScale':
            try:
                scale = _resolve_font_scale(value)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            value = scale
            editor.set_font_scale(scale)
        elif key == 'colorPicker':
            editor.toggle_color_picker(bool(value))
        elif key == 'readOnly':
            editor.set_read_only(bool(value))
        elif key == 'showInlineDiffs':
            if value and get_current_file():
                # Load and apply diffs
                project_path = _history_store.get_active_project() or str(get_project_root())
                if project_path:
                    try:
                        rel = _normalize_rel_path(Path(project_path).expanduser(), get_current_file())
                        diff_data = collect_diff(Path(project_path).expanduser(), rel, base_ref=_current_diff_base(project_path))
                        editor.set_diff_decorations(diff_data.get('hunks', []))
                    except Exception as e:
                        print(f"[PREFERENCE] Failed to load diffs: {e}", file=sys.stderr)
            else:
                editor.set_diff_decorations([])
        elif key == 'trackAgentEdits':
            if value:
                enable_edit_tracking()
            else:
                disable_edit_tracking()
        elif key in ['showLineNumbers', 'showSyntax', 'autoCloseBrackets', 'autocompletion', 'autoSave']:
            # These require frontend to rebuild view (legacy behavior)
            # Persistence happens after this block once runtime updates succeed
            pass
        
        editor.update()
        _preferences_store.update_preferences(editor={key: value})
        
        print(f"[PREFERENCE] Updated {key}={value}", file=sys.stderr)
        
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

    if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
        diff_data = collect_diff(project_root, str(rel_path), base_ref=_current_diff_base(project_path))
        editor.set_diff_decorations(diff_data.get('hunks', []))

    print(f"[SAVE] Success path={current_file!r} sha={file_meta['sha256']}", file=sys.stderr)
    return file_meta

@editor_router.post('/save')
async def save_current_file(data: dict = Body(...)):
    client_id = data.get('client_id', 'unknown')
    op_id = data.get('op_id')
    current_file = get_current_file()
    base_snapshot = get_current_file_sha256()
    try:
        file_meta = await _write_editor_buffer_to_disk(client_id=client_id, op_id=op_id)
        return {"ok": True, "data": file_meta}
    except SaveValidationError as e:
        return {"ok": False, "error": e.message}
    except BaseMismatchError as e:
        print(f"[SAVE] BASE_MISMATCH path={current_file!r} expected={base_snapshot} actual={e.current_meta.get('sha256') if getattr(e, 'current_meta', None) else 'unknown'}", file=sys.stderr)
        return Response(status_code=409, content=json.dumps({"ok": False, "error": "BASE_MISMATCH", "data": {"current": e.current_meta}}), media_type="application/json")
    except Exception as e:
        print(f"[SAVE] ERROR path={current_file!r} error={e}", file=sys.stderr)
        return {"ok": False, "error": str(e)}


@editor_router.post('/run_active_file')
async def run_active_file():
    current_file = get_current_file()
    if not current_file:
        raise HTTPException(status_code=400, detail="No file is currently open")

    try:
        await _write_editor_buffer_to_disk(client_id='run_active_file', op_id=f"run_{int(time.time() * 1000)}")
    except SaveValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except BaseMismatchError as e:
        raise HTTPException(status_code=409, detail={"error": "BASE_MISMATCH", "current": e.current_meta})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file before running: {e}")

    path_obj = Path(current_file).expanduser().resolve(strict=False)

    ext = path_obj.suffix.lower()
    runner = RUNNABLE_COMMANDS.get(ext)
    if not runner:
        raise HTTPException(status_code=400, detail="Only Python and shell scripts can be executed")

    workdir = str(path_obj.parent)
    cmd_tokens = runner + [str(path_obj)]
    command_preview = ' '.join(shlex.quote(part) for part in cmd_tokens)

    mgr = await get_manager()
    shell_id = _history_store.get_terminal_shell_id()
    if shell_id:
        rec = await mgr.get_shell(shell_id)
        if not rec or rec.status != 'running':
            _history_store.set_terminal_shell_id(None)
            shell_id = None

    if not shell_id:
        project_path = _history_store.get_active_project()
        preferred_cwd = project_path if project_path and Path(project_path).is_dir() else workdir
        shell_info = await create_editor_shell(cwd=preferred_cwd)
        shell_id = shell_info['id']
        _history_store.set_terminal_shell_id(shell_id)

    try:
        await mgr.write_to_pty(shell_id, command_preview + "\n")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dispatch command: {e}")

    return {
        "ok": True,
        "data": {
            "shell_id": shell_id,
            "command_preview": command_preview,
            "working_dir": workdir,
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
