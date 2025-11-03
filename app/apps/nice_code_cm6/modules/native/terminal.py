"""Terminal placeholder module."""

from nicegui import ui

from ...core.module import Module


class TerminalModule(Module):
    @property
    def key(self) -> str:
        return "terminal"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.card().classes("flex h-full flex-col bg-slate-900/70"):
                ui.label("Terminal").classes("text-sm text-slate-200")
                ui.separator()
                ui.label("(Terminal streaming coming soon)").classes("text-xs text-slate-400")
