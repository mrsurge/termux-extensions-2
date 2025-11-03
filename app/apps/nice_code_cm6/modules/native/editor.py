"""Editor module with CodeMirror 6."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from nicegui import ui
from nicegui.elements.codemirror import CodeMirror

from ...core.module import Module
from ...core.project_context import ProjectContext
from ...helpers.state_store import StateStore


class EditorModule(Module):
    def __init__(
        self,
        project_context: Optional[ProjectContext] = None,
        state_store: Optional[StateStore] = None,
    ):
        self.project_context = project_context
        self.state_store = state_store
        self._editor: Optional[CodeMirror] = None
        self._file_label: Optional[ui.label] = None
        self._current_file: Optional[Path] = None
        self._pending_open: Optional[str] = None

    @property
    def key(self) -> str:
        return "editor"

    # ---------------------------------------------------------------- rendering
    def render(self, container: ui.element) -> None:
        with container:
            editor_card = (
                ui.card()
                .classes("h-full w-full bg-slate-900/60 p-0 m-0 flex flex-col overflow-hidden min-h-0")
            )
            with editor_card:
                header = ui.row().classes(
                    "items-center justify-between gap-2 px-3 py-2 border-b border-slate-800/70 bg-slate-900/80"
                )
                with header:
                    self._file_label = ui.label("No file open").classes("text-xs text-slate-300 truncate")
                    ui.label("UTF-8").classes("text-[10px] text-slate-500")

                editor_container = ui.element().classes("flex-1 w-full overflow-hidden min-h-0 relative")
                with editor_container:
                    editor = ui.codemirror(
                        value="# Welcome to Code CM6!\n\n# Use the explorer to open a file.\n",
                        language="python",
                    ).classes("absolute inset-0 w-full h-full")
                    editor.props("dark")
                    editor.props("line-numbers")

                self._editor = editor
                self._load_initial_document()
                self._apply_pending_open()

    # ----------------------------------------------------------------- workflow
    def open_file(self, relative_path: str | Path) -> None:
        """Load a project file into the editor."""
        if not self.project_context:
            ui.notify("No project selected", type="warning")
            return
        if not self._editor:
            self._pending_open = str(relative_path)
            return

        try:
            absolute = self.project_context.ensure_within_root(relative_path)
        except ValueError as exc:
            ui.notify(str(exc), type="negative")
            return

        try:
            content = absolute.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = absolute.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:  # pragma: no cover - IO errors surface to user
            ui.notify(f"Failed to open {absolute.name}: {exc}", type="negative")
            return

        self._editor.value = content
        self._current_file = absolute
        if self._file_label:
            self._file_label.text = str(absolute.relative_to(self.project_context.root_path))
        if self.state_store:
            self.state_store.set_value(
                "editor",
                "last_file",
                str(absolute.relative_to(self.project_context.root_path)),
            )

    # ----------------------------------------------------------------- helpers
    def _load_initial_document(self) -> None:
        if not (self.project_context and self.state_store):
            return
        last_file = self.state_store.get_value("editor", "last_file")
        if last_file:
            self._pending_open = last_file

    def _apply_pending_open(self) -> None:
        if not self._pending_open:
            return
        pending = self._pending_open
        self._pending_open = None
        self.open_file(pending)
