"""Menu header module."""

from nicegui import ui

from ...core.module import Module


class MenuHeaderModule(Module):
    def __init__(self, layout_manager=None):
        self.layout_manager = layout_manager
    
    @property
    def key(self) -> str:
        return "menu_header"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.row().classes("gap-2"):
                ui.button("File").props("flat")
                ui.button("Edit").props("flat")
                
                # View menu with dropdown
                with ui.button("View").props("flat"):
                    with ui.menu() as view_menu:
                        ui.menu_item(
                            "Toggle Terminal",
                            on_click=lambda: self._toggle_terminal()
                        )
                
                ui.button("Theme").props("flat")
    
    def _toggle_terminal(self) -> None:
        """Toggle terminal visibility via layout manager."""
        if self.layout_manager:
            self.layout_manager.toggle_terminal()
