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
                
                # Add diff styling
                ui.add_head_html('''
                <style>
                .cm-diff-line-added {
                    background-color: rgba(0, 255, 0, 0.15);
                    border-left: 3px solid rgba(0, 255, 0, 0.6);
                }
                .cm-diff-removed {
                    background-color: rgba(255, 0, 0, 0.15);
                    border-left: 3px solid rgba(255, 0, 0, 0.6);
                    padding: 2px 0;
                    margin: 2px 0;
                }
                .cm-diff-removed-line {
                    padding-left: 4px;
                    white-space: pre;
                    font-family: monospace;
                    opacity: 0.7;
                }
                </style>
                ''')
                
                # Bind to reactive state
                editor.bind_value(state, 'content')

                view_cache = {
                    'word_wrap': bool(state.get('word_wrap', False)),
                    'line_shading': bool(state.get('line_shading', False)),
                    'theme': str(state.get('theme', 'oneDark')),
                    'language': str(state.get('language', 'python')),
                    'diff_hunks': [],  # Store current diff hunks
                }

                def _sync_view_settings() -> None:
                    editor_instance = get_active_editor()
                    if not editor_instance or not getattr(editor_instance, 'client', None):
                        return
                    
                    # Debug: check what we're syncing
                    current_shade = bool(state.get('line_shading', False))
                    if current_shade != view_cache['line_shading']:
                        print(f"[DEBUG TIMER] line_shading changed: {view_cache['line_shading']} → {current_shade}", file=sys.stderr)

                    target_wrap = bool(state.get('word_wrap', False))
                    if target_wrap != view_cache['word_wrap']:
                        view_cache['word_wrap'] = target_wrap
                        editor_instance.set_line_wrapping(target_wrap)
                        editor_instance.update()

                    target_shade = bool(state.get('line_shading', False))
                    if target_shade != view_cache['line_shading']:
                        view_cache['line_shading'] = target_shade
                        print(f"[DEBUG] Calling set_zebra_stripes: {target_shade}", file=sys.stderr)
                        editor_instance.set_zebra_stripes(target_shade)


                    target_theme = str(state.get('theme', 'oneDark'))
                    if target_theme != view_cache['theme']:
                        view_cache['theme'] = target_theme
                        editor_instance.set_theme(target_theme)
                        editor_instance.update()

                    target_language = str(state.get('language', 'python'))
                    if target_language != view_cache['language']:
                        view_cache['language'] = target_language
                        editor_instance.set_language(target_language)
                        editor_instance.update()

                    # Sync diff decorations
                    # Note: Diffs come from editor_state['diff_hunks'] which should be
                    # populated by the host page or another mechanism
                    target_hunks = state.get('diff_hunks', [])
                    if target_hunks != view_cache['diff_hunks']:
                        view_cache['diff_hunks'] = target_hunks
                        print(f"[DEBUG] Applying {len(target_hunks)} diff hunks", file=sys.stderr)
                        editor_instance.set_diff_decorations(target_hunks)

                ui.timer(0.3, _sync_view_settings)
