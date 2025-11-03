"""NiceGUI UI bootstrap for Code CM6."""

from nicegui import ui

from .core.layout_manager import LayoutManager
from .core.module_loader import load_native_modules


def build_ui(container) -> None:
    """Populate the shared shell container with the composed layout."""
    modules = load_native_modules()
    manager = LayoutManager(modules)
    manager.render(container)
