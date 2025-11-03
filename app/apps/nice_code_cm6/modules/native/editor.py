"""Editor module with CodeMirror 6."""

from nicegui import ui

from ...core.module import Module


class EditorModule(Module):
    @property
    def key(self) -> str:
        return "editor"

    def render(self, container: ui.element) -> None:
        with container:
            # Full width editor with CodeMirror - must fill container exactly
            editor_card = ui.card().classes("h-full w-full bg-slate-900/60 p-0 m-0 flex flex-col overflow-hidden min-h-0")
            with editor_card:
                # Small header with file info
                with ui.row().classes("w-full items-center px-4 py-2 border-b border-slate-700 flex-shrink-0"):
                    ui.label("Untitled").classes("text-sm text-slate-300")
                
                # CodeMirror container (fills remaining space, constrain height)
                editor_container = ui.element().classes("flex-1 w-full overflow-hidden min-h-0 relative")
                with editor_container:
                    # CodeMirror instance - absolute positioning to fill container
                    editor = ui.codemirror(
                        value='# Welcome to Code CM6!\n\n# This is a Python-first code editor\n# Built with NiceGUI and CodeMirror 6\n\ndef hello_world():\n    print("Hello from NiceGUI!")\n\nif __name__ == "__main__":\n    hello_world()\n',
                        language='python',
                    ).classes('absolute inset-0 w-full h-full')
                    
                    # Apply dark theme and configure
                    editor.props('dark')
                    editor.props('line-numbers')
