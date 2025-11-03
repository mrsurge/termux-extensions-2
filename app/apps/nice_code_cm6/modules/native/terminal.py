"""Terminal placeholder module."""

from nicegui import ui

from ...core.module import Module


class TerminalModule(Module):
    @property
    def key(self) -> str:
        return "terminal"

    def render(self, container: ui.element) -> None:
        with container:
            # Full width terminal with no padding
            with ui.card().classes("h-full w-full bg-slate-900/70 p-0 m-0"):
                ui.label("Terminal").classes("text-sm text-slate-200 p-4")
                ui.separator()
                ui.label("(Terminal streaming coming soon)").classes("text-xs text-slate-400 p-4")
