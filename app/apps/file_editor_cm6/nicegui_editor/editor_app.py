# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

import json
import sys
import hashlib
import time
from pathlib import Path
import anyio

from nicegui import ui, app as nicegui_app
from fastapi import APIRouter, Body, HTTPException, Response

# --- Local Imports ---
# Import stores as singletons from the new stores module
from app.apps.file_editor_cm6.stores import _history_store, _preferences_store
# Import helpers
from app.apps.file_editor_cm6.explorer_helper import get_project_root, _normalize_rel_path, mark_git_cache_dirty
from app.apps.file_editor_cm6.core_read import init_watcher, push_save_ack, emit_diff_changed, subscribe
from app.apps.file_editor_cm6.core_write import write_full, BaseMismatchError
from app.apps.file_editor_cm6.diff_helper import invalidate_diff_cache, collect_diff


# --- FastAPI Router ---
editor_router = APIRouter(prefix="/editor")

# --- Global State ---
_active_editor = None
_current_file_path = None
_current_file_sha256 = None
_edit_tracker_subscription = None

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
    
    # 2. Determine and Load Initial File
    project_path = _history_store.get_active_project()
    last_file = _history_store.get_last_file(project_path) if project_path else None
    
    initial_content = ''
    initial_language = 'text'
    initial_path = None
    initial_sha256 = None

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
            editor = ui.codemirror(
                value=initial_content,
                language=initial_language,
                theme=editor_prefs.get('theme', 'cm6-dark'),
                line_wrapping=editor_prefs.get('wordWrap', False),
            ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
            
            # 5. Set Global State and Apply Settings
            _active_editor = editor
            set_current_file(initial_path, initial_sha256)
            editor.set_zebra_stripes(editor_prefs.get('showShading', False))
            editor.set_font_scale(0.85)
            
            # 6. Load Diffs if Enabled
            if editor_prefs.get('showInlineDiffs', False) and initial_path and project_path:
                try:
                    project_root = Path(project_path).expanduser()
                    rel = _normalize_rel_path(project_root, initial_path)
                    diff_data = collect_diff(project_root, rel)
                    editor.set_diff_decorations(diff_data.get('hunks', []))
                except Exception as e:
                    print(f"[DIFF] Failed to auto-load diffs on init: {e}", file=sys.stderr)

            # 7. Subscribe to File Watcher
            if initial_path:
                project_root = get_project_root()
                init_watcher(project_root)
                
                def on_file_change(event):
                    if event.get('type') == 'replace_full':
                        new_content, new_sha256 = event.get('content', ''), event.get('sha256')
                        editor.set_value(new_content)
                        set_current_file(initial_path, new_sha256)
                        if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
                            try:
                                rel_path = _normalize_rel_path(project_root, initial_path)
                                diff_data = collect_diff(project_root, rel_path)
                                editor.set_diff_decorations(diff_data.get('hunks', []))
                            except Exception as e:
                                print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)
                
                subscribe(initial_path, 'nicegui_backend', on_file_change)

    # 8. Add Diff Styling
    ui.add_head_html('''
    <style>
    :root {
      --diff-marker-width: 1.65rem; --diff-add-bg: rgba(52, 211, 153, 0.22); --diff-add-border: rgba(52, 211, 153, 0.75);
      --diff-add-marker: rgba(52, 211, 153, 0.9); --diff-context-border: rgba(148, 163, 184, 0.35); --diff-context-marker: rgba(148, 163, 184, 0.55);
      --diff-del-bg: rgba(248, 113, 113, 0.18); --diff-del-border: rgba(248, 113, 113, 0.7); --diff-del-fg: rgba(248, 113, 113, 0.95);
      --diff-del-marker: rgba(248, 113, 113, 0.85); --diff-del-gap: 0;
    }
    .cm-line.cm-diff-line { position: relative; padding-left: calc(var(--diff-marker-width) + 0.35rem); }
    .cm-line.cm-diff-line::before { content: attr(data-diff-marker); position: absolute; left: 0; width: var(--diff-marker-width); text-align: center; font-weight: 600; opacity: 0.85; color: rgba(148, 163, 184, 0.65); user-select: none; -webkit-user-select: none; }
    .cm-line.cm-diff-line-added { background: var(--diff-add-bg) !important; border-left: 3px solid var(--diff-add-border) !important; }
    .cm-line.cm-diff-line-added::before { color: var(--diff-add-marker); }
    .cm-line.cm-diff-line-context { border-left: 3px solid var(--diff-context-border); }
    .cm-line.cm-diff-line-context::before { color: var(--diff-context-marker); }
    .cm-line.cm-diff-line-plain { border-left: 3px solid transparent; }
    .cm-diff-line-removed { position: relative; margin: 0 0 var(--diff-del-gap, 0); padding: 0 10px 0 calc(var(--diff-marker-width) + 6px); border-left: 3px solid var(--diff-del-border); background: var(--diff-del-bg); color: var(--diff-del-fg); font: inherit; white-space: pre; line-height: inherit; user-select: none; -webkit-user-select: none; contain: layout paint; }
    .cm-diff-line-removed::before { content: attr(data-diff-marker); position: absolute; left: 0; width: var(--diff-marker-width); text-align: center; font-weight: 600; color: var(--diff-del-marker); user-select: none; -webkit-user-select: none; }
    .cm-diff-removed-text { display: block; white-space: pre; }
    .cm-diff-line-removed.cm-diff-wrap { white-space: pre-wrap; word-break: break-word; }
    .cm-diff-line-removed.cm-diff-wrap .cm-diff-removed-text { white-space: pre-wrap; word-break: break-word; }
    </style>
    ''')

# --- Editor API Endpoints ---

@editor_router.post('/set_content')
async def set_editor_content(data: dict = Body(...)):
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    
    content, path, language = data.get('content', ''), data.get('path', ''), data.get('language', 'python')
    content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
    set_current_file(path, content_sha256)
    
    editor.set_value(content)
    editor.set_language(language)
    editor.update()
    
    project_root = get_project_root()
    init_watcher(project_root)
    
    def on_file_change(event):
        if event.get('type') == 'replace_full':
            new_content, new_sha256 = event.get('content', ''), event.get('sha256')
            editor.set_value(new_content)
            set_current_file(path, new_sha256)
            if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
                try:
                    rel_path = _normalize_rel_path(project_root, path)
                    diff_data = collect_diff(project_root, rel_path)
                    editor.set_diff_decorations(diff_data.get('hunks', []))
                except Exception as e:
                    print(f"[FILE_WATCH] Failed to recalculate diffs: {e}", file=sys.stderr)

    subscribe(path, 'nicegui_backend_set_content', on_file_change)
    
    editor_prefs = _preferences_store.get_preferences().get('editor', {})
    editor.set_zebra_stripes(editor_prefs.get('showShading', False))
    editor.set_line_wrapping(editor_prefs.get('wordWrap', False))
    editor.set_theme(editor_prefs.get('theme', 'oneDark'))
    editor.update()
    
    if editor_prefs.get('showInlineDiffs', False) and path:
        try:
            project_path = _history_store.get_active_project() or str(get_project_root())
            rel = _normalize_rel_path(Path(project_path).expanduser(), path)
            diff_data = collect_diff(Path(project_path).expanduser(), rel)
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
        diff_data = collect_diff(project_root, rel)
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
    _preferences_store.update_preferences({'editor': {'trackAgentEdits': enabled}})
    return {"ok": True, "enabled": enabled}

@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict = Body(...)):
    target_path, target_line = data.get('path'), data.get('line', 1)
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    
    current_file = get_current_file()
    if target_path and target_path != current_file:
        try:
            content = Path(target_path).read_text(encoding='utf-8', errors='replace')
            language = 'python' if target_path.endswith('.py') else 'javascript' if target_path.endswith('.js') else 'markdown' if target_path.endswith('.md') else 'text'
            editor.set_value(content)
            editor.set_language(language)
            content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
            set_current_file(target_path, content_sha256)
            
            project_root = get_project_root()
            init_watcher(project_root)
            def on_file_change(event):
                if event.get('type') == 'replace_full':
                    editor.set_value(event.get('content', ''))
                    set_current_file(target_path, event.get('sha256'))
            subscribe(target_path, 'nicegui_backend_jump', on_file_change)
        except Exception as e:
            return {"ok": False, "error": str(e)}
            
    ui.run_javascript(f'const view = document.querySelector(".cm-editor")?.cmView.view; if(view) {{ const pos = view.state.doc.line({target_line}).from; view.dispatch({{ selection: {{ anchor: pos }}, scrollIntoView: true }}); }}')
    return {"ok": True, "file": target_path or current_file, "line": target_line}

@editor_router.get('/debug/state')
def debug_editor_state():
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready", "current_file": get_current_file(), "editor_exists": False}
    content = editor.value or ''
    return {"ok": True, "editor_exists": True, "current_file": get_current_file(), "content_length": len(content), "content_hash": hashlib.sha256(content.encode('utf-8')).hexdigest()}

@editor_router.post('/save')
async def save_current_file(data: dict = Body(...)):
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    current_file = get_current_file()
    if not current_file: return {"ok": False, "error": "No file is currently open"}
    
    content, base_sha256 = editor.value or '', get_current_file_sha256()
    client_id, op_id = data.get('client_id', 'unknown'), data.get('op_id', f"op_{int(time.time() * 1000)}")
    project_root = get_project_root()
    
    try:
        rel_path = _normalize_rel_path(project_root, current_file)
        init_watcher(project_root)
        file_meta = await anyio.to_thread.run_sync(lambda: write_full(project_root, str(rel_path), content, base_sha256=base_sha256))
        
        push_save_ack(str(rel_path), op_id, client_id, file_meta)
        emit_diff_changed(str(rel_path), file_meta["sha256"])
        mark_git_cache_dirty(project_root)
        invalidate_diff_cache(project_root, str(rel_path))
        set_current_file(current_file, file_meta["sha256"])
        
        if _preferences_store.get_preferences().get('editor', {}).get('showInlineDiffs', False):
            diff_data = collect_diff(project_root, str(rel_path))
            editor.set_diff_decorations(diff_data.get('hunks', []))
            
        return {"ok": True, "data": file_meta}
    except BaseMismatchError as e:
        return Response(status_code=409, content=json.dumps({"ok": False, "error": "BASE_MISMATCH", "data": {"current": e.current_meta}}), media_type="application/json")
    except Exception as e:
        return {"ok": False, "error": str(e)}

@editor_router.post('/set_view_settings')
async def set_view_settings(data: dict = Body(...)):
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
    
    if 'show_inline_diffs' in data:
        show_diffs = bool(data['show_inline_diffs'])
        editor_updates['showInlineDiffs'] = show_diffs
        if show_diffs and editor and 'current_path' in data:
            try:
                project_path = _history_store.get_active_project() or str(get_project_root())
                rel = _normalize_rel_path(Path(project_path).expanduser(), data['current_path'])
                diff_data = collect_diff(Path(project_path).expanduser(), rel)
                editor.set_diff_decorations(diff_data.get('hunks', []))
            except Exception as e:
                print(f"[DIFF] Failed to load diffs on toggle: {e}", file=sys.stderr)
        elif not show_diffs and editor:
            editor.set_diff_decorations([])
            
    if 'theme' in data:
        theme_name = str(data['theme'])
        editor_updates['theme'] = theme_name
        if editor: editor.set_theme(theme_name)
        
    if editor_updates:
        _preferences_store.update_preferences(editor=editor_updates)
    
    return {"ok": True}
