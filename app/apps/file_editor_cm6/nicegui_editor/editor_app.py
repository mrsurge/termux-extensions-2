# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/nicegui_editor/editor_app.py
# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

import json
import sys

from nicegui import ui, app as nicegui_app

# Global reference to the active editor instance
_active_editor = None

def get_active_editor():
    """Get the currently active editor instance"""
    return _active_editor

# Register NiceGUI page - will be imported after ui.run_with() is called
@ui.page('/nc')
async def editor_page():
        """Main editor page"""
        global _active_editor
        
        # Get shared state from NiceGUI app storage
        from app.apps.file_editor_cm6.main import get_editor_state
        state = get_editor_state()
        
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
                # Bind editor directly to NiceGUI app storage state
                editor = ui.codemirror(
                    value=state.get('content', ''),
                    language=state.get('language', 'python'),
                    theme=state.get('theme', 'oneDark'),
                    line_wrapping=state.get('word_wrap', False),
                ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
                
                # Store global reference
                _active_editor = editor
                
                shade_pref = 'true' if state.get('line_shading', False) else 'false'
                print(f"[DEBUG] Initial line_shading from state: {state.get('line_shading', False)}, shade_pref: {shade_pref}", file=sys.stderr)
                
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
                
                # Bind to reactive state
                editor.bind_value(state, 'content')

                view_cache = {
                    'word_wrap': bool(state.get('word_wrap', False)),
                    'line_shading': bool(state.get('line_shading', False)),
                    'diff_hunks': [],  # Store current diff hunks
                    'show_inline_diffs': bool(state.get('show_inline_diffs', False)),
                }

                def _sync_view_settings() -> None:
                    """Timer-based sync - ONLY for toggleable settings from menu.
                    
                    Content, theme, and language are set directly when files open,
                    NOT polled here (prevents flash/thrash on file load).
                    """
                    editor_instance = get_active_editor()
                    if not editor_instance or not getattr(editor_instance, 'client', None):
                        return

                    # ONLY sync toggleable settings (menu checkboxes)
                    target_wrap = bool(state.get('word_wrap', False))
                    if target_wrap != view_cache['word_wrap']:
                        view_cache['word_wrap'] = target_wrap
                        editor_instance.set_line_wrapping(target_wrap)
                        editor_instance.update()

                    target_shade = bool(state.get('line_shading', False))
                    if target_shade != view_cache['line_shading']:
                        view_cache['line_shading'] = target_shade
                        editor_instance.set_zebra_stripes(target_shade)

                    # Sync diff decorations
                    show_diffs = bool(state.get('show_inline_diffs', False))
                    target_hunks = state.get('diff_hunks', []) if show_diffs else []
                    
                    if show_diffs != view_cache['show_inline_diffs'] or target_hunks != view_cache['diff_hunks']:
                        view_cache['show_inline_diffs'] = show_diffs
                        view_cache['diff_hunks'] = target_hunks
                        editor_instance.set_diff_decorations(target_hunks)

                ui.timer(0.3, _sync_view_settings)
