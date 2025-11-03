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

    def render(self, container: ui.element) -> None:
        """Render responsive layout with drawers for mobile."""
        container.classes("flex h-full w-full flex-col overflow-hidden p-0 m-0")
        
        with container:
            # Header section
            headers = ui.column().classes("w-full gap-2 flex-shrink-0 p-2")
            with headers:
                file_header_zone = ui.element().classes(
                    "w-full rounded-lg bg-slate-900/80 px-4 py-2"
                )
                
                # Menu header with drawer controls
                menu_header_container = ui.row().classes(
                    "w-full items-center justify-between rounded-lg bg-slate-900/80 px-4 py-2"
                )
                with menu_header_container:
                    # Left: Explorer toggle button (mobile only)
                    explorer_btn = ui.button(
                        icon="folder_open", 
                        on_click=lambda: self.toggle_explorer()
                    ).classes("md:hidden")
                    explorer_btn.tooltip("Toggle Explorer")
                    
                    # Center: Menu header zone
                    menu_header_zone = ui.element().classes("flex-1")
                    
                    # Right: Agent drawer toggle button (mobile only)
                    agent_btn = ui.button(
                        icon="smart_toy",
                        on_click=lambda: self.toggle_agent()
                    ).classes("md:hidden")
                    agent_btn.tooltip("Toggle Agent")

            # Main content area with drawers
            main_container = ui.element().classes("relative flex-1 flex overflow-hidden")
            with main_container:
                # Explorer drawer (mobile: overlay, desktop: static tile)
                explorer_drawer = ui.element()
                explorer_drawer.classes(
                    # Mobile: fixed overlay drawer
                    "fixed md:relative inset-y-0 left-0 z-50"
                    " w-80"
                    " transform transition-transform duration-300"
                    " -translate-x-full md:translate-x-0"
                    # Desktop: static left tile (doubled width: 512px)
                    " md:flex md:flex-shrink-0"
                    " bg-slate-950/95 md:bg-transparent"
                    " shadow-2xl md:shadow-none"
                )
                # Custom width for desktop (384px = 512px * 0.75, or 256px * 1.5)
                ui.add_head_html("""
                    <style>
                    @media (min-width: 768px) {
                        .explorer-drawer-width { width: 384px !important; }
                    }
                    </style>
                """)
                explorer_drawer.classes("explorer-drawer-width")
                explorer_drawer.bind_visibility_from(self, "explorer_visible", 
                                                      backward=lambda v: "translate-x-0" if v else "-translate-x-full")
                
                # Main editor area with terminal
                editor_container = ui.column().classes("flex-1 flex flex-col overflow-hidden gap-0 min-h-0")
                with editor_container:
                    # Editor zone (takes remaining space, must have min-h-0 for flex)
                    editor_zone = ui.element().classes("flex-1 w-full overflow-hidden min-h-0")
                    
                    # Terminal zone (collapsible, normally closed)
                    terminal_zone = ui.element().classes("flex-shrink-0 overflow-auto w-full")
                    terminal_zone.bind_visibility_from(self, "terminal_visible")
                    # Set height when visible
                    terminal_zone.style("height: 240px")

                # Agent drawer (mobile: overlay, desktop: static tile)
                agent_drawer = ui.element()
                agent_drawer.classes(
                    # Mobile: fixed overlay drawer
                    "fixed md:relative inset-y-0 right-0 z-50"
                    " w-80"
                    " transform transition-transform duration-300"
                    " translate-x-full md:translate-x-0"
                    # Desktop: static right tile (+35% width: 346px)
                    " md:flex md:flex-shrink-0"
                    " bg-slate-950/95 md:bg-transparent"
                    " shadow-2xl md:shadow-none"
                )
                # Custom width for desktop (346px = 256px * 1.35)
                ui.add_head_html("""
                    <style>
                    @media (min-width: 768px) {
                        .agent-drawer-width { width: 346px !important; }
                    }
                    </style>
                """)
                agent_drawer.classes("agent-drawer-width")
                agent_drawer.bind_visibility_from(self, "agent_visible",
                                                   backward=lambda v: "translate-x-0" if v else "translate-x-full")

            # Mobile drawer backdrop (only visible when drawers open)
            backdrop = ui.element()
            backdrop.classes(
                "md:hidden fixed inset-0 bg-black/50 z-40"
            )
            backdrop.bind_visibility_from(self, "explorer_visible", 
                                          backward=lambda v: v or self.agent_visible)
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

    def toggle_explorer(self) -> None:
        """Toggle explorer drawer visibility."""
        self.explorer_visible = not self.explorer_visible
        if self.explorer_visible:
            self.agent_visible = False  # Close other drawer

    def toggle_agent(self) -> None:
        """Toggle agent drawer visibility."""
        self.agent_visible = not self.agent_visible
        if self.agent_visible:
            self.explorer_visible = False  # Close other drawer

    def toggle_terminal(self) -> None:
        """Toggle terminal visibility."""
        self.terminal_visible = not self.terminal_visible

    def close_all_drawers(self) -> None:
        """Close all mobile drawers."""
        self.explorer_visible = False
        self.agent_visible = False
