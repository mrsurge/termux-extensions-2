# /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/nicegui_editor/editor_app.py
# app/apps/file_editor_cm6/nicegui_editor/editor_app.py

from nicegui import ui

# Register NiceGUI page - will be imported after ui.run_with() is called
@ui.page('/nc')
async def editor_page():
        """Main editor page"""
        
        # Basic page structure - no borders, no scrolling
        with ui.element('div').style('width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #0b0f1a; color: #e5e7eb; margin: 0; padding: 0; overflow: hidden;'):
            
            # Header bar with toast test button
            with ui.element('div').style('padding: 8px 16px; background: #1a1f2e; display: flex; align-items: center; gap: 12px;'):
                ui.button('Test Toast', on_click=lambda: ui.notify('Toast works!', type='positive')).props('dense flat')
            
            # Editor container - fills remaining space, no overflow
            with ui.element('div').style('flex: 1; display: flex; flex-direction: column; overflow: hidden;'):
                editor = ui.codemirror(
                    value='',
                    language='python',
                    theme='oneDark',
                ).style('flex: 1; height: 100%; width: 100%;').classes('editor-content')
            
            # Status bar - no border
            with ui.element('div').style('padding: 4px 16px; background: #1a1f2e; display: flex; align-items: center; gap: 16px; font-size: 12px;'):
                ui.label('No file open').classes('file-status').style('color: #9ca3af;')
                ui.label('Lines: 0').classes('line-count').style('color: #9ca3af; margin-left: auto;')
        
        # PostMessage bridge JavaScript
        ui.run_javascript('''
            console.log('[NiceGUI Editor] Initializing postMessage bridge...');
            
            // Notify parent that editor is ready
            window.parent.postMessage({ type: 'editor_ready' }, window.location.origin);
            
            // Listen for messages from host
            window.addEventListener('message', (event) => {
                if (event.origin !== window.location.origin) return;
                
                console.log('[NiceGUI Editor] Received message:', event.data);
                
                const { type, payload } = event.data;
                
                switch (type) {
                    case 'open_file':
                        console.log('[NiceGUI Editor] Opening file:', payload.path);
                        // TODO: Update editor content
                        break;
                    
                    case 'set_theme':
                        console.log('[NiceGUI Editor] Setting theme:', payload.theme);
                        // TODO: Apply theme
                        break;
                    
                    case 'reload_content':
                        console.log('[NiceGUI Editor] Reloading content');
                        // TODO: Refresh from server
                        break;
                    
                    default:
                        console.warn('[NiceGUI Editor] Unknown message type:', type);
                }
            });
            
            // Helper to send messages to host
            window.notifyHost = function(type, payload) {
                console.log('[NiceGUI Editor] Sending to host:', type, payload);
                window.parent.postMessage({ type, payload }, window.location.origin);
            };
            
            // Example: Notify on content changes
            // TODO: Hook this to actual editor change events
            window.notifyContentChanged = function() {
                window.notifyHost('content_changed', { unsaved: true });
            };
        ''')
