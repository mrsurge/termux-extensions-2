# app/apps/file_editor_cm6/nicegui_editor/__init__.py

# Initialize NiceGUI with proper event loop configuration
from nicegui import core

def init_nicegui():
    """Initialize NiceGUI's core without calling ui.run()"""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.get_event_loop()
    
    # Set NiceGUI's event loop
    core.loop = loop
    
    # Initialize all required app config attributes
    if not hasattr(core.app.config, 'title'):
        core.app.config.title = 'NiceGUI Editor'
    if not hasattr(core.app.config, 'viewport'):
        core.app.config.viewport = 'width=device-width, initial-scale=1'
    if not hasattr(core.app.config, 'favicon'):
        core.app.config.favicon = None
    if not hasattr(core.app.config, 'dark'):
        core.app.config.dark = None
    if not hasattr(core.app.config, 'language'):
        core.app.config.language = 'en'
    if not hasattr(core.app.config, 'binding_refresh_interval'):
        core.app.config.binding_refresh_interval = 0.1
    
    # Import pages after core is initialized
    from . import editor_app

__all__ = ['init_nicegui']
