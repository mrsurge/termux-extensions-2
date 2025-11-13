# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/nicegui_editor/editor_app.py
# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

import json
import sys

from nicegui import ui, app as nicegui_app

# Global reference to the active editor instance and current file
_active_editor = None
_current_file_path = None
_current_file_sha256 = None  # Track SHA256 of file when loaded/saved

def get_active_editor():
    """Get the currently active editor instance"""
    return _active_editor

def set_current_file(path: str, sha256: str = None):
    """Set the currently open file path and its SHA256"""
    global _current_file_path, _current_file_sha256
    _current_file_path = path
    _current_file_sha256 = sha256

def get_current_file():
    """Get the currently open file path"""
    return _current_file_path

def get_current_file_sha256():
    """Get the SHA256 of the currently open file when it was loaded/saved"""
    return _current_file_sha256

# Register NiceGUI page - will be imported after ui.run_with() is called
# reconnect_timeout=0 forces fresh page load on every browser refresh
# This ensures settings are always loaded from disk, not cached from old client state
@ui.page('/nc', reconnect_timeout=0)
async def editor_page():
        """Main editor page"""
        global _active_editor
        
        import sys
        print(f"[EDITOR_APP] ==================== PAGE LOAD ====================", file=sys.stderr)
        print(f"[EDITOR_APP] Old editor reference: {_active_editor}", file=sys.stderr)
        
        # Load preferences from disk (THE ONLY SOURCE OF TRUTH)
        from app.apps.file_editor_cm6.main import _preferences_store
        prefs = _preferences_store.get_preferences()
        editor_prefs = prefs.get('editor', {})
        
        print(f"[EDITOR_APP] Loading editor with prefs: {editor_prefs}", file=sys.stderr)
        
        # Hard CSS reset for full-bleed content (removes Quasar/NiceGUI default padding)
        ui.add_head_html('''
        <style>
          html, body, #q-app, .q-page-container, .q-page, .nicegui-content {
            margin:0 !important; padding:0 !important; height:100%;
          }
          body { overflow: hidden; }
        </style>
        ''')
        
        # Basic page structure
        with ui.element('div').style('width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #0b0f1a; color: #e5e7eb; overflow: hidden;'):
            
            # Editor container
            with ui.element('div').style('flex: 1; display: flex; flex-direction: column; overflow: hidden;').classes('editor-wrapper w-full h-full'):
                # Initialize editor with preferences from disk
                theme_val = editor_prefs.get('theme', 'cm6-dark')
                wrap_val = editor_prefs.get('wordWrap', False)
                print(f"[EDITOR_APP] Creating editor: theme={theme_val}, wordWrap={wrap_val}", file=sys.stderr)
                
                editor = ui.codemirror(
                    value='',  # Blank until file opens
                    language='python',  # Default, will be set when file opens
                    theme=theme_val,
                    line_wrapping=wrap_val,
                ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
                
                # Store global reference (ALWAYS create fresh editor on page load)
                _active_editor = editor
                print(f"[EDITOR_APP] New editor reference: {_active_editor}", file=sys.stderr)
                
                # Apply initial zebra stripes and diffs settings
                show_shading = editor_prefs.get('showShading', False)
                show_diffs = editor_prefs.get('showInlineDiffs', False)
                print(f"[EDITOR_APP] Applying initial settings: showShading={show_shading}, showInlineDiffs={show_diffs}", file=sys.stderr)
                editor.set_zebra_stripes(show_shading)
                if show_diffs:
                    editor.set_diff_decorations([])  # Will be populated when file loads
                
                # Add diff styling (complete CSS from old architecture)
                ui.add_head_html('''
                <style>
                :root {
                  --diff-marker-width: 1.65rem;
                  --diff-add-bg: rgba(52, 211, 153, 0.22);
                  --diff-add-border: rgba(52, 211, 153, 0.75);
                  --diff-add-marker: rgba(52, 211, 153, 0.9);
                  --diff-context-border: rgba(148, 163, 184, 0.35);
                  --diff-context-marker: rgba(148, 163, 184, 0.55);
                  --diff-del-bg: rgba(248, 113, 113, 0.18);
                  --diff-del-border: rgba(248, 113, 113, 0.7);
                  --diff-del-fg: rgba(248, 113, 113, 0.95);
                  --diff-del-marker: rgba(248, 113, 113, 0.85);
                  --diff-del-gap: 0;
                }
                
                .cm-line.cm-diff-line { 
                  position: relative; 
                  padding-left: calc(var(--diff-marker-width) + 0.35rem); 
                }
                
                .cm-line.cm-diff-line::before {
                  content: attr(data-diff-marker);
                  position: absolute;
                  left: 0;
                  width: var(--diff-marker-width);
                  text-align: center;
                  font-weight: 600;
                  opacity: 0.85;
                  color: rgba(148, 163, 184, 0.65);
                  user-select: none;
                  -webkit-user-select: none;
                }
                
                .cm-line.cm-diff-line-added { 
                  background: var(--diff-add-bg) !important; 
                  border-left: 3px solid var(--diff-add-border) !important; 
                }
                .cm-line.cm-diff-line-added::before { 
                  color: var(--diff-add-marker); 
                }
                
                .cm-line.cm-diff-line-context { 
                  border-left: 3px solid var(--diff-context-border); 
                }
                .cm-line.cm-diff-line-context::before { 
                  color: var(--diff-context-marker); 
                }
                
                .cm-line.cm-diff-line-plain { 
                  border-left: 3px solid transparent; 
                }
                
                .cm-diff-line-removed {
                  position: relative;
                  margin: 0 0 var(--diff-del-gap, 0);
                  padding: 0 10px 0 calc(var(--diff-marker-width) + 6px);
                  border-left: 3px solid var(--diff-del-border);
                  background: var(--diff-del-bg);
                  color: var(--diff-del-fg);
                  font: inherit;
                  white-space: pre;
                  line-height: inherit;
                  user-select: none;
                  -webkit-user-select: none;
                  contain: layout paint;
                }
                
                .cm-diff-line-removed::before {
                  content: attr(data-diff-marker);
                  position: absolute;
                  left: 0;
                  width: var(--diff-marker-width);
                  text-align: center;
                  font-weight: 600;
                  color: var(--diff-del-marker);
                  user-select: none;
                  -webkit-user-select: none;
                }
                
                .cm-diff-removed-text { 
                  display: block; 
                  white-space: pre; 
                }
                
                .cm-diff-line-removed.cm-diff-wrap { 
                  white-space: pre-wrap; 
                  word-break: break-word; 
                }
                .cm-diff-line-removed.cm-diff-wrap .cm-diff-removed-text { 
                  white-space: pre-wrap; 
                  word-break: break-word; 
                }
                </style>
                ''')
                
