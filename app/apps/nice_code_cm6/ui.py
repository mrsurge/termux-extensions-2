"""NiceGUI UI bootstrap for Code CM6."""

from nicegui import ui

from .core.layout_manager import LayoutManager
from .core.module_loader import load_native_modules


def build_ui(context) -> None:
    """Populate the shared shell container with the composed layout."""
    manager = LayoutManager([])
    modules = load_native_modules(layout_manager=manager)
    manager.modules = modules
    manager.render(
        body_container=context.body,
        header_secondary=context.header_secondary,
        header_tertiary=context.header_tertiary,
    )
