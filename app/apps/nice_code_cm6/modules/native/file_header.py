"""Top file/path header module."""

from nicegui import ui

from ...core.module import Module


class FileHeaderModule(Module):
    @property
    def key(self) -> str:
        return "file_header"

    @property
    def label(self) -> str:
        return "File Header"

    def render(self, container: ui.element) -> None:
        with container:
            ui.label("Untitled • No file selected").classes("text-xs text-slate-300")
