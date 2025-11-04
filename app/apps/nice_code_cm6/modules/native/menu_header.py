"""Menu header module."""

from __future__ import annotations

import json
from typing import Optional

from nicegui import ui

from ...core.module import Module
from ...core.project_context import ProjectContext


class MenuHeaderModule(Module):
    _styles_injected = False

    def __init__(self, layout_manager=None, project_context: Optional[ProjectContext] = None):
        self.layout_manager = layout_manager
        self.project_context = project_context
        self._explorer_module = None
        self._editor_module = None

    @property
    def key(self) -> str:
        return "menu_header"

    # ----------------------------------------------------------------- wiring
    def attach_explorer(self, explorer_module) -> None:
        self._explorer_module = explorer_module

    def attach_editor(self, editor_module) -> None:
        self._editor_module = editor_module

    def attach_project_context(self, project_context: ProjectContext | None) -> None:
        self.project_context = project_context

    # ---------------------------------------------------------------- renderers
    def render(self, container: ui.element) -> None:
        self._ensure_styles()
        with container:
            with ui.row().classes("gap-1 items-center text-xs justify-end"):
                with ui.button("File").props("flat dense size=sm").classes("text-slate-200"):
                    with ui.menu().props("auto-close").classes("nc-menu bg-slate-800"):
                        ui.menu_item("Open Project...", on_click=self._open_project_via_prompt).classes("text-xs nc-menu-item")
                        ui.menu_item("Refresh Explorer", on_click=self._refresh_explorer).classes("text-xs nc-menu-item")
                        ui.separator()
                        ui.menu_item("Autosave", on_click=self._toggle_autosave).classes("text-xs nc-menu-item")
                        ui.separator()
                        ui.menu_item("Exit", on_click=lambda: ui.notify("Exit not implemented")).classes("text-xs nc-menu-item")

                with ui.button("Edit").props("flat dense size=sm").classes("text-slate-200"):
                    with ui.menu().props("auto-close").classes("nc-menu bg-slate-800"):
                        ui.menu_item("Find/Replace", on_click=self._show_find_replace).classes("text-xs nc-menu-item")

                with ui.button("View").props("flat dense size=sm").classes("text-slate-200"):
                    with ui.menu().classes("nc-menu bg-slate-800"):
                        ui.menu_item("Word Wrap", on_click=self._toggle_word_wrap).classes("text-xs nc-menu-item")
                        ui.menu_item("Line Shading", on_click=self._toggle_zebra_stripes).classes("text-xs nc-menu-item")
                        ui.separator()
                        ui.menu_item("Live Updates", on_click=self._toggle_live_updates).classes("text-xs nc-menu-item")
                        ui.menu_item("Edit Tracker", on_click=self._toggle_edit_tracker).classes("text-xs nc-menu-item")
                        ui.separator()
                        ui.menu_item("Toggle Terminal", on_click=self._toggle_terminal).classes("text-xs nc-menu-item")

                with ui.button("Theme").props("flat dense size=sm").classes("text-slate-200"):
                    with ui.menu().props("auto-close").classes("nc-menu bg-slate-800"):
                        self._render_theme_menu()

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

    def _toggle_word_wrap(self) -> None:
        """Toggle word wrap in editor."""
        if self._editor_module and hasattr(self._editor_module, "toggle_word_wrap"):
            self._editor_module.toggle_word_wrap()
        else:
            ui.notify("Editor not available", type="warning")

    def _toggle_zebra_stripes(self) -> None:
        """Toggle zebra stripe line shading in editor."""
        if self._editor_module and hasattr(self._editor_module, "toggle_zebra_stripes"):
            self._editor_module.toggle_zebra_stripes()
        else:
            ui.notify("Editor not available", type="warning")

    def _toggle_live_updates(self) -> None:
        """Toggle live file updates in editor."""
        if self._editor_module and hasattr(self._editor_module, "toggle_live_updates"):
            self._editor_module.toggle_live_updates()
        else:
            ui.notify("Editor not available", type="warning")

    def _toggle_autosave(self) -> None:
        """Toggle autosave in editor."""
        if self._editor_module and hasattr(self._editor_module, "toggle_autosave"):
            self._editor_module.toggle_autosave()
        else:
            ui.notify("Editor not available", type="warning")

    def _toggle_edit_tracker(self) -> None:
        """Toggle edit tracker in editor."""
        if self._editor_module and hasattr(self._editor_module, "toggle_edit_tracker"):
            self._editor_module.toggle_edit_tracker()
        else:
            ui.notify("Editor not available", type="warning")

    def _render_theme_menu(self) -> None:
        """Render theme selection menu."""
        if not self._editor_module:
            ui.menu_item("Editor not loaded", on_click=lambda: None).props("disable").classes("text-xs nc-menu-item")
            return
        
        from .editor import EditorModule
        
        # Group themes
        ui.label("Dark Themes").classes("text-xs font-semibold text-slate-400 px-3 py-1")
        for display_name, theme_id in EditorModule.THEMES[:6]:
            ui.menu_item(
                display_name,
                on_click=lambda t=theme_id: self._set_theme(t)
            ).classes("text-xs nc-menu-item")
        
        ui.separator()
        ui.label("Light Themes").classes("text-xs font-semibold text-slate-400 px-3 py-1")
        for display_name, theme_id in EditorModule.THEMES[6:]:
            ui.menu_item(
                display_name,
                on_click=lambda t=theme_id: self._set_theme(t)
            ).classes("text-xs nc-menu-item")

    def _set_theme(self, theme_name: str) -> None:
        """Apply theme to editor."""
        if self._editor_module and hasattr(self._editor_module, "set_theme"):
            self._editor_module.set_theme(theme_name)
        else:
            ui.notify("Editor not available", type="warning")

    def _show_find_replace(self) -> None:
        """Show find/replace dialog."""
        with ui.dialog() as dialog, ui.card().classes("w-96 bg-slate-800 p-4"):
            ui.label("Find & Replace").classes("text-lg font-semibold text-slate-100 mb-3")
            
            find_input = ui.input("Find").classes("w-full mb-2").props("dark outlined dense")
            replace_input = ui.input("Replace with").classes("w-full mb-3").props("dark outlined dense")
            
            with ui.row().classes("w-full justify-end gap-2"):
                ui.button("Cancel", on_click=dialog.close).props("flat").classes("text-slate-300")
                ui.button("Replace All", on_click=lambda: self._replace_all(
                    find_input.value, replace_input.value, dialog
                )).props("flat").classes("text-blue-400")
                ui.button("Find", on_click=lambda: self._find_text(
                    find_input.value, dialog
                )).props("unelevated").classes("bg-blue-600")
        
        dialog.open()

    def _find_text(self, text: str, dialog) -> None:
        """Trigger find in editor (placeholder - needs CM6 search integration)."""
        if not text:
            ui.notify("Enter text to find", type="warning")
            return
        ui.notify(f"Find: '{text}' - CM6 search integration pending", type="info")
        dialog.close()

    def _replace_all(self, find_text: str, replace_text: str, dialog) -> None:
        """Trigger replace all (placeholder - needs CM6 integration)."""
        if not find_text:
            ui.notify("Enter text to find", type="warning")
            return
        ui.notify(f"Replace all '{find_text}' with '{replace_text}' - pending", type="info")
        dialog.close()

    # ---------------------------------------------------------------- styles
    def _ensure_styles(self) -> None:
        if MenuHeaderModule._styles_injected:
            return
        ui.add_head_html(
            """
            <style>
            .nc-menu {
                background: rgb(30 41 59) !important;
                color: rgb(226 232 240) !important;
            }
            .nc-menu .q-item,
            .nc-menu-item {
                color: rgb(226 232 240) !important;
            }
            .nc-menu .q-item:hover,
            .nc-menu-item:hover {
                background: rgba(148, 163, 184, 0.15) !important;
                color: rgb(248 250 252) !important;
            }
            .nc-menu .q-separator {
                background: rgba(148, 163, 184, 0.2) !important;
            }
            </style>
            """
        )
        MenuHeaderModule._styles_injected = True
