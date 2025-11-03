"""Responsive layout manager with mobile drawers."""

from __future__ import annotations

from typing import Iterable

from nicegui import ui

from .module import Module


class LayoutManager:
    """Layout manager with mobile-first drawer architecture."""

    def __init__(self, modules: Iterable[Module]):
        self.modules = list(modules)
        self.explorer_visible = False
        self.agent_visible = False
        self.terminal_visible = False  # Default to closed
        self._explorer_drawer = None
        self._agent_drawer = None
        self._backdrop = None

    def render(self, *, header_container: ui.element, body_container: ui.element) -> None:
        """Render responsive layout with a unified header and scrollable body."""
        header_container.clear()
        body_container.clear()

        with header_container:
            header_row = ui.row().classes(
                "w-full items-center justify-between gap-2 px-3 py-1.5 text-xs md:text-sm"
            )
            with header_row:
                file_header_zone = ui.element().classes("flex items-center gap-2 min-w-0 truncate")
                controls_row = ui.row().classes("items-center gap-1 md:gap-2")
                with controls_row:
                    explorer_btn = ui.button(
                        icon="folder_open",
                        on_click=lambda: self.toggle_explorer(),
                    ).props("flat dense size=sm").classes("md:hidden")
                    explorer_btn.tooltip("Toggle Explorer")
                    menu_header_zone = ui.element().classes("flex items-center gap-1 md:gap-2")
                    agent_btn = ui.button(
                        icon="smart_toy",
                        on_click=lambda: self.toggle_agent(),
                    ).props("flat dense size=sm")
                    agent_btn.tooltip("Toggle Agent")

        with body_container:
            body_container.classes("relative flex-1 flex flex-col overflow-hidden")
            main_container = ui.element().classes("relative flex flex-1 w-full min-h-0")
            with main_container:
                content_row = ui.element().classes("relative flex-1 flex flex-row min-h-0 overflow-hidden")
                with content_row:
                    # Explorer drawer (mobile: full-screen overlay, desktop: static tile)
                    explorer_drawer = ui.element()
                    explorer_drawer.classes(
                        "fixed md:relative inset-0 md:inset-auto z-50 "
                        "w-full md:w-auto "
                        "h-full md:h-auto "
                        "flex flex-col overflow-y-auto md:overflow-visible "
                        "transform transition-transform duration-300 "
                        "md:translate-x-0 "
                        "md:flex md:flex-shrink-0 "
                        "bg-slate-950 md:bg-transparent "
                        "shadow-2xl md:shadow-none "
                        "te-mobile-header-offset te-mobile-drawer-padding "
                        "md:pointer-events-auto"
                    )
                    # Custom width for desktop only
                    ui.add_head_html("""
                        <style>
                        @media (min-width: 768px) {
                            .explorer-drawer-width { width: 384px !important; }
                        }
                        </style>
                    """)
                    explorer_drawer.classes("explorer-drawer-width")
                    self._explorer_drawer = explorer_drawer
                    
                    # Main editor area with terminal
                    editor_container = ui.column().classes("flex-1 flex flex-col overflow-hidden gap-0 min-h-0 min-w-0")
                    with editor_container:
                        # Editor zone (takes remaining space, must have min-h-0 for flex)
                        editor_zone = ui.element().classes("flex-1 w-full overflow-hidden min-h-0")
                        
                        # Terminal zone (collapsible, normally closed)
                        terminal_zone = ui.element().classes("flex-shrink-0 overflow-auto w-full")
                        terminal_zone.bind_visibility_from(self, "terminal_visible")
                        # Set height when visible
                        terminal_zone.style("height: 240px")

                    # Agent drawer (mobile: full-screen overlay, desktop: hidden)
                    agent_drawer = ui.element()
                    agent_drawer.classes(
                        "fixed md:relative inset-0 md:inset-auto z-50 "
                        "w-full md:w-auto "
                        "h-full md:h-auto "
                        "flex flex-col overflow-y-auto md:overflow-visible "
                        "transform transition-transform duration-300 "
                        "md:translate-x-0 "
                        "md:flex md:flex-shrink-0 "
                        "bg-slate-950 md:bg-transparent "
                        "shadow-2xl md:shadow-none "
                        "te-mobile-header-offset te-mobile-drawer-padding "
                        "md:pointer-events-auto"
                    )
                    # Custom width for desktop if/when agent shows (future feature)
                    ui.add_head_html("""
                        <style>
                        @media (min-width: 768px) {
                            .agent-drawer-width { width: 346px !important; }
                        }
                        </style>
                    """)
                    agent_drawer.classes("agent-drawer-width")
                    self._agent_drawer = agent_drawer

                # Mobile drawer backdrop (only visible when drawers open)
                backdrop = ui.element()
                backdrop.classes(
                    "md:hidden fixed inset-0 bg-black/50 z-40 "
                    "opacity-0 pointer-events-none transition-opacity duration-200 "
                    "te-mobile-header-offset"
                )
                self._backdrop = backdrop
                backdrop.on("click", lambda: self.close_all_drawers())

            # Zone mapping
            zones = {
                "file_header": file_header_zone,
                "menu_header": menu_header_zone,
                "explorer": explorer_drawer,
                "editor": editor_zone,
                "agent_drawer": agent_drawer,
                "terminal": terminal_zone,
            }

            # Render modules into zones
            for module in self.modules:
                zone = zones.get(module.key)
                if zone is not None:
                    module.render(zone)

        self._apply_explorer_state()
        self._apply_agent_state()
        self._update_backdrop()

    def toggle_explorer(self) -> None:
        """Toggle explorer drawer visibility."""
        self.explorer_visible = not self.explorer_visible
        if self.explorer_visible:
            self.agent_visible = False  # Close other drawer
        self._apply_explorer_state()
        self._apply_agent_state()

    def toggle_agent(self) -> None:
        """Toggle agent drawer visibility."""
        self.agent_visible = not self.agent_visible
        if self.agent_visible:
            self.explorer_visible = False  # Close other drawer
        self._apply_agent_state()
        self._apply_explorer_state()

    def toggle_terminal(self) -> None:
        """Toggle terminal visibility."""
        self.terminal_visible = not self.terminal_visible

    def close_all_drawers(self) -> None:
        """Close all mobile drawers."""
        self.explorer_visible = False
        self.agent_visible = False
        self._apply_explorer_state()
        self._apply_agent_state()

    def _apply_explorer_state(self) -> None:
        if not self._explorer_drawer:
            return
        if self.explorer_visible:
            self._explorer_drawer.classes(
                add="translate-x-0 pointer-events-auto",
                remove="-translate-x-full pointer-events-none",
            )
        else:
            self._explorer_drawer.classes(
                add="-translate-x-full pointer-events-none",
                remove="translate-x-0 pointer-events-auto",
            )
        self._update_backdrop()

    def _apply_agent_state(self) -> None:
        if not self._agent_drawer:
            return
        if self.agent_visible:
            self._agent_drawer.classes(
                add="translate-x-0 pointer-events-auto md:flex md:flex-shrink-0 md:opacity-100 md:pointer-events-auto",
                remove="translate-x-full pointer-events-none md:hidden md:opacity-0 md:pointer-events-none",
            )
        else:
            self._agent_drawer.classes(
                add="translate-x-full pointer-events-none md:hidden md:opacity-0 md:pointer-events-none",
                remove="translate-x-0 pointer-events-auto md:flex md:flex-shrink-0 md:opacity-100 md:pointer-events-auto",
            )
        self._update_backdrop()

    def _update_backdrop(self) -> None:
        if not self._backdrop:
            return
        if self.explorer_visible or self.agent_visible:
            self._backdrop.classes(
                add="opacity-100 pointer-events-auto",
                remove="opacity-0 pointer-events-none",
            )
        else:
            self._backdrop.classes(
                add="opacity-0 pointer-events-none",
                remove="opacity-100 pointer-events-auto",
            )
