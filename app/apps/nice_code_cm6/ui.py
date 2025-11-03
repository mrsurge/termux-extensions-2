"""NiceGUI UI bootstrap for Code CM6."""

from nicegui import ui

from .core.layout_manager import LayoutManager
from .core.module_loader import load_native_modules


def build_ui(container) -> None:
    """Populate the shared shell container with the composed layout."""
    # Create layout manager first (will be passed to modules)
    manager = LayoutManager([])
    
    # Load modules and pass layout_manager to menu_header
    modules = load_native_modules(layout_manager=manager)
    
    # Set modules on manager
    manager.modules = modules
    
    # Render layout
    manager.render(container)
