"""Simple layout manager for Phase 1."""

from __future__ import annotations

from typing import Iterable

from nicegui import ui

from .module import Module


class LayoutManager:
    """Phase 1 layout manager that renders placeholder regions."""

    def __init__(self, modules: Iterable[Module]):
        self.modules = list(modules)

    def render(self, container: ui.element) -> None:
        """Render the high-level frame and ask modules to populate regions."""
        container.classes("flex h-full w-full flex-col gap-3")
        with container:
            headers = ui.column().classes("w-full gap-2")
            with headers:
                file_header_zone = ui.element().classes(
                    "w-full rounded-lg bg-slate-900/80 px-4 py-2"
                )
                menu_header_zone = ui.element().classes(
                    "w-full rounded-lg bg-slate-900/80 px-4 py-2"
                )

            grid = ui.element().classes(
                "grid flex-1 w-full gap-3 grid-cols-1 auto-rows-min"
                " md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(220px,280px)]"
                " md:grid-rows-[minmax(0,1fr)_minmax(180px,auto)]"
            )
            with grid:
                explorer_zone = ui.element().classes(
                    "flex h-full flex-col md:col-span-1 md:row-start-1 md:row-span-2"
                )
                editor_zone = ui.element().classes(
                    "flex h-full flex-col md:col-start-2 md:row-start-1"
                )
                agent_zone = ui.element().classes(
                    "flex h-full flex-col md:col-start-3 md:row-start-1 md:row-span-2"
                )
                terminal_zone = ui.element().classes(
                    "flex h-full flex-col w-full md:col-start-2 md:row-start-2"
                )

            misc_zone = ui.element().classes("w-full")

            zones = {
                "file_header": file_header_zone,
                "menu_header": menu_header_zone,
                "explorer": explorer_zone,
                "editor": editor_zone,
                "agent_drawer": agent_zone,
                "terminal": terminal_zone,
            }

            header_children = {"file_header", "menu_header"}

            for module in self.modules:
                zone = zones.get(module.key, misc_zone)
                # Ensure header zones render inside headers column
                if module.key in header_children:
                    module.render(zone)
                elif zone in {explorer_zone, editor_zone, agent_zone, terminal_zone}:
                    module.render(zone)
                else:
                    module.render(zone)
