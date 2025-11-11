# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/nicegui_editor/editor_app.py
# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

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
        
        # Remove default page padding/margins and set dark background
        ui.query('body').style('margin: 0; padding: 0; overflow: hidden;')
        
        # Add zebra stripes CSS
        ui.add_head_html('''
        <style>
        /* Zebra stripes are installed via CM6 extension, this just controls visibility */
        .cm-content:not(.cm-zebraActive) .cm-zebraStripe {
            background-color: transparent !important;
        }
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
                    theme='oneDark',
                    line_wrapping=state.get('word_wrap', False),
                ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
                
                # Store global reference
                _active_editor = editor
                
                # Install zebra stripes extension
                ui.run_javascript(f"""
                (async () => {{
                  const root = getElement('{editor.id}');
                  const view = root.querySelector('.cm-content')?.cmView?.view;
                  if (!view) return console.error('[ZebraStripes] EditorView not found');
                  
                  if (view.__ngZebraInstalled) return;
                  view.__ngZebraInstalled = true;
                  
                  const [viewMod, stateMod] = await Promise.all([
                    import('https://esm.sh/@codemirror/view@6'),
                    import('https://esm.sh/@codemirror/state@6'),
                  ]);
                  const {{EditorView, Decoration, ViewPlugin}} = viewMod;
                  const {{Facet, RangeSetBuilder, StateEffect}} = stateMod;
                  
                  const baseTheme = EditorView.baseTheme({{
                    "&light .cm-zebraStripe": {{ backgroundColor: "rgba(0,0,0,.035)" }},
                    "&dark  .cm-zebraStripe": {{ backgroundColor: "rgba(255,255,255,.06)" }},
                  }});
                  
                  const stepSize = Facet.define({{ combine: v => v.length ? v[0] : 2 }});
                  
                  const stripe = Decoration.line({{ attributes: {{ class: "cm-zebraStripe" }} }});
                  function stripeDeco(v) {{
                    const step = v.state.facet(stepSize);
                    const b = new RangeSetBuilder();
                    for (let {{from, to}} of v.visibleRanges) {{
                      for (let pos = from; pos <= to;) {{
                        const line = v.state.doc.lineAt(pos);
                        if ((line.number % step) === 0) b.add(line.from, line.from, stripe);
                        pos = line.to + 1;
                      }}
                    }}
                    return b.finish();
                  }}
                  
                  const zebraPlugin = ViewPlugin.fromClass(class {{
                    constructor(v) {{ this.decorations = stripeDeco(v); }}
                    update(u) {{
                      if (u.docChanged || u.viewportChanged) this.decorations = stripeDeco(u.view);
                    }}
                  }}, {{ decorations: v => v.decorations }});
                  
                  view.dispatch({{
                    effects: StateEffect.appendConfig.of([baseTheme, stepSize.of(2), zebraPlugin])
                  }});
                  
                  console.log('[ZebraStripes] Extension installed');
                }})();
                """)
                
                # Bind to reactive state
                editor.bind_value(state, 'content')



