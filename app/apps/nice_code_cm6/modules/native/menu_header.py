"""Menu header module."""

from nicegui import ui

from ...core.module import Module


class MenuHeaderModule(Module):
    @property
    def key(self) -> str:
        return "menu_header"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.row().classes("gap-2"):
                ui.button("File").props("flat")
                ui.button("Edit").props("flat")
                ui.button("View").props("flat")
                ui.button("Theme").props("flat")
