"""Menu header module."""

from __future__ import annotations

import json
from typing import Optional

from nicegui import ui

from ...core.module import Module
from ...core.project_context import ProjectContext


class MenuHeaderModule(Module):
    def __init__(self, layout_manager=None, project_context: Optional[ProjectContext] = None):
        self.layout_manager = layout_manager
        self.project_context = project_context
        self._explorer_module = None

    @property
    def key(self) -> str:
        return "menu_header"

    # ----------------------------------------------------------------- wiring
    def attach_explorer(self, explorer_module) -> None:
        self._explorer_module = explorer_module

    def attach_project_context(self, project_context: ProjectContext | None) -> None:
        self.project_context = project_context

    # ---------------------------------------------------------------- renderers
    def render(self, container: ui.element) -> None:
        with container:
            with ui.row().classes("gap-1 items-center text-xs justify-end"):
                with ui.button("File").props("flat dense size=sm"):
                    with ui.menu().props("auto-close"):
                        ui.menu_item("Open Project...", on_click=self._open_project_via_prompt).classes("text-xs")
                        ui.menu_item("Refresh Explorer", on_click=self._refresh_explorer).classes("text-xs")
                        ui.separator()
                        ui.menu_item("Exit", on_click=lambda: ui.notify("Exit not implemented")).classes("text-xs")

                ui.button("Edit").props("flat dense size=sm")

                with ui.button("View").props("flat dense size=sm"):
                    with ui.menu() as view_menu:
                        ui.menu_item("Toggle Terminal", on_click=self._toggle_terminal).classes("text-xs")

                ui.button("Theme").props("flat dense size=sm")

    # ---------------------------------------------------------------- actions
    async def _open_project_via_prompt(self) -> None:
        if self._explorer_module and hasattr(self._explorer_module, "open_project_prompt"):
            await self._explorer_module.open_project_prompt()
            return
        if not self.project_context:
            ui.notify("Project context unavailable", type="warning")
            return
        current = json.dumps(str(self.project_context.root_path))
        result = await ui.run_javascript(f'prompt("Enter project path:", {current})', timeout=30.0)
        if result and self.project_context:
            try:
                self.project_context.set_root(result)
                ui.notify(f"Project changed to: {result}")
            except Exception as exc:
                ui.notify(f"Error: {exc}", type="negative")

    def _refresh_explorer(self) -> None:
        if self._explorer_module and hasattr(self._explorer_module, "refresh_view"):
            self._explorer_module.refresh_view(show_toast=True)
        else:
            ui.notify("Explorer not loaded", type="warning")

    def _toggle_terminal(self) -> None:
        if self.layout_manager:
            self.layout_manager.toggle_terminal()
