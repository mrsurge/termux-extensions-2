"""Explorer placeholder module."""

from nicegui import ui

from ...core.module import Module


class ExplorerModule(Module):
    @property
    def key(self) -> str:
        return "explorer"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.card().classes("flex h-full flex-col bg-slate-900/60"):
                ui.label("Explorer").classes("text-sm text-slate-200")
                ui.separator()
                ui.label("(File tree coming soon)").classes("text-xs text-slate-400")
