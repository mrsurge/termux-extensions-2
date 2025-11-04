"""Editor module with CodeMirror 6."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from nicegui import ui
from nicegui.elements.codemirror import CodeMirror

from ...core.module import Module
from ...core.project_context import ProjectContext
from ...helpers.state_store import StateStore
from ...helpers.file_watcher import FileSubscription
from ...helpers.autosave import AutosaveManager
from ...helpers.core_read import init_watcher
from ...helpers.core_write import _get_file_meta


class EditorModule(Module):
    # Available themes (6 dark + 6 light)
    THEMES = [
        ("Abyss", "abyss"),
        ("Atom One Dark", "atomone"),
        ("Dracula", "dracula"),
        ("GitHub Dark", "githubDark"),
        ("Material Dark", "materialDark"),
        ("Tokyo Night", "tokyoNight"),
        ("Basic Light", "basicLight"),
        ("GitHub Light", "github"),
        ("Solarized Light", "solarizedLight"),
        ("Eclipse", "eclipse"),
        ("BBEdit", "bbedit"),
        ("Quiet Light", "quietlight"),
    ]

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
        self._current_theme: str = "basicLight"
        self._word_wrap_enabled: bool = False
        self._zebra_stripes_enabled: bool = False
        
        # Live streaming components
        self._file_subscription: Optional[FileSubscription] = None
        self._autosave_manager: Optional[AutosaveManager] = None
        self._live_updates_enabled: bool = True
        self._autosave_enabled: bool = False
        self._edit_tracker_enabled: bool = False
        self._current_base_sha256: Optional[str] = None
        self._is_dirty: bool = False
        self._client_id: str = f"nicegui-{uuid.uuid4().hex[:8]}"

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
                    
                    # Hook up change event for dirty tracking and autosave
                    editor.on_value_change(self._on_editor_change)

                self._editor = editor
                
                # Initialize autosave manager
                if self.project_context:
                    self._autosave_manager = AutosaveManager(self.project_context.root_path)
                
                self._load_initial_document()
                self._load_theme()
                self._load_preferences()
                self._apply_pending_open()

    # ----------------------------------------------------------------- workflow
    def set_theme(self, theme_name: str) -> None:
        """Change the editor theme."""
        if not self._editor:
            return
        
        # Update editor theme
        self._editor._props["theme"] = theme_name
        self._editor.update()
        self._current_theme = theme_name
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "theme", theme_name)
        
        ui.notify(f"Theme changed to {theme_name}", type="positive", timeout=1500)

    def toggle_word_wrap(self) -> None:
        """Toggle word wrap."""
        if not self._editor:
            return
        
        self._word_wrap_enabled = not self._word_wrap_enabled
        self._editor.set_line_wrapping(self._word_wrap_enabled)
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "word_wrap", self._word_wrap_enabled)
        
        status = "enabled" if self._word_wrap_enabled else "disabled"
        ui.notify(f"Word wrap {status}", type="positive", timeout=1500)

    def toggle_zebra_stripes(self) -> None:
        """Toggle zebra stripe line shading."""
        if not self._editor:
            return
        
        self._zebra_stripes_enabled = not self._zebra_stripes_enabled
        self._apply_zebra_stripes()
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "zebra_stripes", self._zebra_stripes_enabled)
        
        status = "enabled" if self._zebra_stripes_enabled else "disabled"
        ui.notify(f"Line shading {status}", type="positive", timeout=1500)

    def toggle_live_updates(self) -> None:
        """Toggle live file updates."""
        self._live_updates_enabled = not self._live_updates_enabled
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "live_updates", self._live_updates_enabled)
        
        status = "enabled" if self._live_updates_enabled else "disabled"
        ui.notify(f"Live updates {status}", type="positive", timeout=1500)
        
        # Stop subscription if disabling
        if not self._live_updates_enabled and self._file_subscription:
            self._file_subscription.stop()
            self._file_subscription = None

    def toggle_autosave(self) -> None:
        """Toggle autosave."""
        self._autosave_enabled = not self._autosave_enabled
        
        if self._autosave_manager:
            self._autosave_manager.set_enabled(self._autosave_enabled)
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "autosave", self._autosave_enabled)
        
        status = "enabled" if self._autosave_enabled else "disabled"
        ui.notify(f"Autosave {status}", type="positive", timeout=1500)

    def toggle_edit_tracker(self) -> None:
        """Toggle edit tracker (for agent/terminal tracking)."""
        self._edit_tracker_enabled = not self._edit_tracker_enabled
        
        # Persist to state
        if self.state_store:
            self.state_store.set_value("editor", "edit_tracker", self._edit_tracker_enabled)
        
        status = "enabled" if self._edit_tracker_enabled else "disabled"
        ui.notify(f"Edit tracker {status} (requires terminal/agent)", type="info", timeout=2000)

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
        self._is_dirty = False
        
        # Detect and set language based on file extension
        language = self._detect_language(absolute.name)
        self._editor.set_language(language)
        
        # Get file metadata
        file_meta = _get_file_meta(absolute)
        self._current_base_sha256 = file_meta.get("sha256")
        
        if self._file_label:
            self._file_label.text = str(absolute.relative_to(self.project_context.root_path))
        if self.state_store:
            self.state_store.set_value(
                "editor",
                "last_file",
                str(absolute.relative_to(self.project_context.root_path)),
            )
        
        # Initialize watcher and subscribe to file changes
        if self._live_updates_enabled and self.project_context:
            try:
                init_watcher(self.project_context.root_path)
                
                # Stop previous subscription if any
                if self._file_subscription:
                    self._file_subscription.stop()
                
                # Subscribe to file changes
                self._file_subscription = FileSubscription(
                    str(absolute),
                    self._client_id,
                    self._handle_file_update
                )
                self._file_subscription.start()
            except Exception as e:
                print(f"[EditorModule] Failed to start file watcher: {e}")

    # ----------------------------------------------------------------- helpers
    def _detect_language(self, filename: str) -> str:
        """Detect language based on file extension."""
        ext_to_lang = {
            # Python
            '.py': 'python',
            '.pyw': 'python',
            '.pyi': 'python',
            # JavaScript/TypeScript
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.mjs': 'javascript',
            '.cjs': 'javascript',
            # Web
            '.html': 'html',
            '.htm': 'html',
            '.css': 'css',
            '.scss': 'css',
            '.sass': 'css',
            '.less': 'css',
            # Markup
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.toml': 'toml',
            '.md': 'markdown',
            '.markdown': 'markdown',
            # Shell
            '.sh': 'shell',
            '.bash': 'shell',
            '.zsh': 'shell',
            # C/C++
            '.c': 'c',
            '.h': 'c',
            '.cpp': 'cpp',
            '.hpp': 'cpp',
            '.cc': 'cpp',
            '.cxx': 'cpp',
            # Java/Kotlin
            '.java': 'java',
            '.kt': 'kotlin',
            # Go
            '.go': 'go',
            # Rust
            '.rs': 'rust',
            # Ruby
            '.rb': 'ruby',
            # PHP
            '.php': 'php',
            # SQL
            '.sql': 'sql',
            # Config files
            '.conf': 'shell',
            '.cfg': 'shell',
            '.ini': 'shell',
        }
        
        # Get extension (lowercase)
        ext = '.' + filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        
        return ext_to_lang.get(ext, 'plaintext')

    def _load_initial_document(self) -> None:
        if not (self.project_context and self.state_store):
            return
        last_file = self.state_store.get_value("editor", "last_file")
        if last_file:
            self._pending_open = last_file

    def _load_theme(self) -> None:
        """Load saved theme preference."""
        if not self.state_store:
            return
        saved_theme = self.state_store.get_value("editor", "theme")
        if saved_theme:
            self._current_theme = saved_theme
            if self._editor:
                self._editor._props["theme"] = saved_theme
                self._editor.update()
        
        # Load word wrap preference
        word_wrap = self.state_store.get_value("editor", "word_wrap")
        if word_wrap is not None:
            self._word_wrap_enabled = bool(word_wrap)
            if self._editor:
                self._editor.set_line_wrapping(self._word_wrap_enabled)
        
        # Load zebra stripes preference
        zebra_stripes = self.state_store.get_value("editor", "zebra_stripes")
        if zebra_stripes is not None:
            self._zebra_stripes_enabled = bool(zebra_stripes)
            self._apply_zebra_stripes()

    def _load_preferences(self) -> None:
        """Load live streaming preferences."""
        if not self.state_store:
            return
        
        # Load live updates preference (default ON)
        live_updates = self.state_store.get_value("editor", "live_updates")
        if live_updates is not None:
            self._live_updates_enabled = bool(live_updates)
        
        # Load autosave preference (default OFF)
        autosave = self.state_store.get_value("editor", "autosave")
        if autosave is not None:
            self._autosave_enabled = bool(autosave)
            if self._autosave_manager:
                self._autosave_manager.set_enabled(self._autosave_enabled)
        
        # Load edit tracker preference (default OFF)
        edit_tracker = self.state_store.get_value("editor", "edit_tracker")
        if edit_tracker is not None:
            self._edit_tracker_enabled = bool(edit_tracker)

    def _on_editor_change(self, e) -> None:
        """Handle editor content changes."""
        if not self._editor or not self._current_file:
            return
        
        # Mark as dirty
        self._is_dirty = True
        
        # Schedule autosave if enabled
        if self._autosave_enabled and self._autosave_manager and self.project_context:
            rel_path = str(self._current_file.relative_to(self.project_context.root_path))
            op_id = uuid.uuid4().hex[:8]
            
            self._autosave_manager.schedule_save(
                path=rel_path,
                content=self._editor.value,
                base_sha256=self._current_base_sha256,
                client_id=self._client_id,
                op_id=op_id,
                on_success=self._on_save_success,
                on_conflict=self._on_save_conflict,
                on_error=self._on_save_error
            )

    def _handle_file_update(self, event: dict) -> None:
        """Handle file system events from watcher."""
        if not self._editor:
            return
        
        event_type = event.get("type")
        
        if event_type == "replace_full":
            # Initial snapshot or external change
            new_content = event.get("content", "")
            new_sha256 = event.get("sha256")
            
            # Check if this is different from what we have
            if new_sha256 and new_sha256 != self._current_base_sha256:
                if self._is_dirty:
                    # User has unsaved changes - show conflict dialog
                    self._show_conflict_dialog(new_content, new_sha256)
                else:
                    # No local changes - silently reload
                    self._reload_with_content(new_content, new_sha256)
        
        elif event_type == "save_ack":
            # Our save was acknowledged
            new_meta = event.get("meta", {})
            new_sha256 = new_meta.get("sha256")
            if new_sha256:
                self._current_base_sha256 = new_sha256
                self._is_dirty = False
                ui.notify("Saved", type="positive", timeout=1000)
        
        elif event_type == "edit_tracked" and self._edit_tracker_enabled:
            # Agent/terminal edited file - jump to line
            line = event.get("line")
            if line:
                ui.notify(f"Edit detected at line {line}", type="info", timeout=2000)
                # TODO: Scroll to line when we have the API

    def _reload_with_content(self, content: str, sha256: str) -> None:
        """Silently reload editor with new content."""
        if self._editor:
            self._editor.value = content
            self._current_base_sha256 = sha256
            self._is_dirty = False

    def _show_conflict_dialog(self, new_content: str, new_sha256: str) -> None:
        """Show conflict resolution dialog."""
        with ui.dialog() as dialog, ui.card().classes("w-96 bg-slate-800 p-4"):
            ui.label("File Changed Externally").classes("text-lg font-semibold text-slate-100 mb-2")
            
            if self._current_file:
                filename = self._current_file.name
                ui.label(f'"{filename}" was modified outside the editor.').classes("text-sm text-slate-300 mb-3")
            
            ui.label("You have unsaved changes.").classes("text-sm text-yellow-400 mb-4")
            
            with ui.row().classes("w-full justify-end gap-2"):
                ui.button("Keep Mine", on_click=lambda: (dialog.close(), None)).props("flat").classes("text-slate-300")
                ui.button("Reload (Discard)", on_click=lambda: (
                    self._reload_with_content(new_content, new_sha256),
                    dialog.close(),
                    ui.notify("File reloaded", type="info")
                )).props("unelevated").classes("bg-blue-600")
        
        dialog.open()

    def _on_save_success(self, meta: dict) -> None:
        """Handle successful save."""
        new_sha256 = meta.get("sha256")
        if new_sha256:
            self._current_base_sha256 = new_sha256
            self._is_dirty = False

    def _on_save_conflict(self, current_meta: dict) -> None:
        """Handle save conflict."""
        ui.notify("Save conflict - file was modified externally", type="warning", timeout=3000)
        # The file update event will trigger the conflict dialog

    def _on_save_error(self, error: str) -> None:
        """Handle save error."""
        ui.notify(f"Save failed: {error}", type="negative", timeout=3000)

    def _apply_zebra_stripes(self) -> None:
        """Apply or remove zebra stripe styling."""
        if not self._editor:
            return
        
        # Inject CSS for zebra stripes
        style_id = "cm6-zebra-stripes"
        if self._zebra_stripes_enabled:
            ui.run_javascript(f'''
                const styleId = "{style_id}";
                if (!document.getElementById(styleId)) {{
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.textContent = `
                        .cm-line:nth-child(even) {{ 
                            background-color: rgba(128, 128, 128, 0.1) !important;
                        }}
                        .cm-dark .cm-line:nth-child(even) {{
                            background-color: rgba(255, 255, 255, 0.05) !important;
                        }}
                    `;
                    document.head.appendChild(style);
                }}
            ''')
        else:
            ui.run_javascript(f'''
                const styleId = "{style_id}";
                const existingStyle = document.getElementById(styleId);
                if (existingStyle) {{
                    existingStyle.remove();
                }}
            ''')

    def _apply_pending_open(self) -> None:
        if not self._pending_open:
            return
        pending = self._pending_open
        self._pending_open = None
        self.open_file(pending)
