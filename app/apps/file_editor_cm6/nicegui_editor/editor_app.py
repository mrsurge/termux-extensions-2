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
                    theme='oneDark',
                    line_wrapping=state.get('word_wrap', False),
                ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
                
                # Store global reference
                _active_editor = editor
                
                # Install CM6 zebra stripes (logical lines) with a safe mount wait
                ui.run_javascript(f"""
                (async () => {{
                  const root = getElement('{editor.id}');
                  const el = root?.$el || root;
                  if (!el || !el.querySelector) return console.error('[ZebraStripes] host el not found');

                  // wait for CM6 to mount
                  function getView() {{
                    return el.querySelector('.cm-editor')?.cmView?.view || null;
                  }}
                  async function waitForView(timeout=4000) {{
                    const v = getView();
                    if (v) return v;
                    return new Promise(resolve => {{
                      const obs = new MutationObserver(() => {{
                        const vv = getView();
                        if (vv) {{ obs.disconnect(); resolve(vv); }}
                      }});
                      obs.observe(el, {{childList:true, subtree:true}});
                      setTimeout(() => {{ obs.disconnect(); resolve(getView()); }}, timeout);
                    }});
                  }}
                  const view = await waitForView();
                  if (!view) return console.error('[ZebraStripes] EditorView not found after wait');
                  
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

                  // optional: tag content node in case you want CSS hooks later
                  el.querySelector('.cm-content')?.classList.add('cm-zebraActive');
                  
                  console.log('[ZebraStripes] Extension installed');
                }})();
                """)
                
                # Bind to reactive state
                editor.bind_value(state, 'content')



