"""Editor placeholder module."""

from nicegui import ui

from ...core.module import Module


class EditorModule(Module):
    @property
    def key(self) -> str:
        return "editor"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.card().classes("h-full bg-slate-900/60"):
                ui.label("CodeMirror 6 Viewport").classes("text-sm text-slate-200")
                ui.separator()
                ui.label("(CM6 integration coming soon)").classes("text-xs text-slate-400")
