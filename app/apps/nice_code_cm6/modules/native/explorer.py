"""Full-featured explorer module with file tree and git integration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from nicegui import ui

from ...core.module import Module
from ...core.project_context import ProjectContext
from ...helpers.explorer_backend import ExplorerState, get_explorer_state
from ...helpers.state_store import StateStore


class ExplorerModule(Module):
    _styles_injected = False

    def __init__(
        self,
        layout_manager=None,
        project_context: Optional[ProjectContext] = None,
        state_store: Optional[StateStore] = None,
    ):
        self.layout_manager = layout_manager
        self.project_context = project_context
        self.state_store = state_store
        self.state: ExplorerState = get_explorer_state()
        if project_context and state_store:
            self.state.bind(project_context, state_store)

        self.tree_container: Optional[ui.element] = None
        self.git_summary_container: Optional[ui.element] = None
        self.project_label: Optional[ui.label] = None
        self._editor = None

    @property
    def key(self) -> str:
        return "explorer"

    # ----------------------------------------------------------------- wiring
    def attach_editor(self, editor_module) -> None:
        self._editor = editor_module

    # ----------------------------------------------------------------- rendering
    def render(self, container: ui.element) -> None:
        self._ensure_styles()
        with container:
            with ui.card().classes(
                "h-full w-full flex flex-col bg-slate-900 p-0 m-0 overflow-hidden"
            ):
                self._render_header()
                self._render_git_summary()
                self._render_file_tree()

    def _render_header(self) -> None:
        with ui.row().classes(
            "w-full items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800"
        ):
            with ui.row().classes("flex-1 items-center gap-2 min-w-0"):
                ui.icon("folder_open").classes("text-blue-400 text-sm flex-shrink-0")
                project_text = str(self.state.get_project()) if self.project_label is None else self.project_label.text
                self.project_label = ui.label(project_text).classes("text-xs text-slate-300 truncate")

            with ui.row().classes("gap-1 flex-shrink-0"):
                with ui.button(icon="history", on_click=self._show_recents_menu).props("flat dense size=sm"):
                    ui.tooltip("Recent Files")
                with ui.button(icon="create_new_folder", on_click=self.open_project_prompt).props("flat dense size=sm"):
                    ui.tooltip("Change Project Root")
                with ui.button(icon="refresh", on_click=self._refresh_tree).props("flat dense size=sm"):
                    ui.tooltip("Refresh Explorer")

        if self.project_label:
            self.project_label.text = str(self.state.get_project())

    def _render_git_summary(self) -> None:
        with ui.column().classes("w-full border-b border-slate-700 bg-slate-850") as container:
            self.git_summary_container = container
            self._update_git_summary()

    def _update_git_summary(self) -> None:
        if not self.git_summary_container:
            return

        self.git_summary_container.clear()
        git_status = self.state.get_git_status()

        with self.git_summary_container:
            if git_status:
                with ui.row().classes("w-full items-center justify-between px-3 py-1"):
                    with ui.row().classes("items-center gap-2"):
                        ui.icon("git_branch").classes("text-purple-400 text-sm")
                        ui.label(git_status.branch).classes("text-xs text-slate-200")
                        if git_status.ahead > 0:
                            ui.label(f"↑{git_status.ahead}").classes("text-xs text-green-400")
                        if git_status.behind > 0:
                            ui.label(f"↓{git_status.behind}").classes("text-xs text-orange-400")

                    with ui.row().classes("items-center gap-2 text-xs"):
                        if git_status.staged:
                            ui.label(f"S:{len(git_status.staged)}").classes("text-green-400")
                        if git_status.unstaged:
                            ui.label(f"M:{len(git_status.unstaged)}").classes("text-yellow-400")
                        if git_status.untracked:
                            ui.label(f"U:{len(git_status.untracked)}").classes("text-gray-400")

                with ui.row().classes("w-full gap-1 px-3 py-1"):
                    ui.button("Stage", on_click=self._git_stage_all).props("dense size=xs flat").classes("text-xs")
                    ui.button("Unstage", on_click=self._git_unstage_all).props("dense size=xs flat").classes("text-xs")
                    ui.button("Commit", on_click=self._git_commit).props("dense size=xs flat").classes("text-xs")
                    ui.button("Push", on_click=self._git_push).props("dense size=xs flat").classes("text-xs")
                    ui.button("Pull", on_click=self._git_pull).props("dense size=xs flat").classes("text-xs")
            else:
                with ui.row().classes("w-full px-3 py-1"):
                    ui.label("Not a git repository").classes("text-xs text-slate-500")

    def _render_file_tree(self) -> None:
        with ui.scroll_area().classes("flex-1 w-full") as container:
            self.tree_container = container
            self._build_tree()

    def _build_tree(self) -> None:
        if not self.tree_container:
            return
        self.tree_container.clear()

        try:
            root = self.state.list_directory(".")
        except Exception as exc:  # pragma: no cover - surface to UI
            with self.tree_container:
                ui.label(f"Error loading directory: {exc}").classes("text-xs text-red-400 p-2")
            return

        with self.tree_container:
            ui.label(root.get("cwd", ".")).classes("hidden")  # maintain structure
            self._render_directory_contents(".", root.get("entries", []), level=0)

    def _render_directory_contents(self, rel_path: str, entries: list, level: int = 0) -> None:
        for entry in entries:
            self._render_entry(entry, level)

    def _compute_directory_git_status(self, entry: dict) -> str:
        """Compute inherited git status for directories based on children."""
        if entry["kind"] != "dir":
            return entry.get("gitStatus", "clean")
        
        try:
            child_data = self.state.list_directory(entry["rel"])
            children = child_data.get("entries", [])
            
            has_modified = False
            has_untracked = False
            has_staged_only = True
            
            for child in children:
                if child["kind"] == "dir":
                    child_status = self._compute_directory_git_status(child)
                else:
                    child_status = child.get("gitStatus", "clean")
                
                if child_status in ["modified", "staged_modified"]:
                    has_modified = True
                    has_staged_only = False
                elif child_status == "untracked":
                    has_untracked = True
                    has_staged_only = False
                elif child_status not in ["staged", "added", "clean"]:
                    has_staged_only = False
            
            # Priority: modified > mixed > untracked > staged
            if has_modified and has_untracked:
                return "mixed_modified_untracked"
            elif has_modified:
                return "modified"
            elif has_untracked:
                return "untracked"
            elif not has_staged_only and any(c.get("gitStatus") in ["staged", "added"] for c in children):
                return "clean"  # Mixed staged + clean = neutral
            elif any(c.get("gitStatus") in ["staged", "added"] for c in children):
                return "staged"
            
            return "clean"
        except Exception:
            return entry.get("gitStatus", "clean")

    def _get_card_background(self, git_status: str) -> str:
        """Return background gradient based on git status."""
        backgrounds = {
            "modified": "linear-gradient(145deg, rgba(249,115,22,0.35), rgba(234,88,12,0.25))",  # Orange
            "staged_modified": "linear-gradient(145deg, rgba(249,115,22,0.35), rgba(234,88,12,0.25))",  # Orange
            "untracked": "linear-gradient(145deg, rgba(168,85,247,0.30), rgba(147,51,234,0.20))",  # Purple
            "staged": "linear-gradient(145deg, rgba(34,197,94,0.30), rgba(22,163,74,0.20))",  # Green
            "added": "linear-gradient(145deg, rgba(34,197,94,0.30), rgba(22,163,74,0.20))",  # Green
            "mixed_modified_untracked": "linear-gradient(145deg, rgba(249,115,22,0.35), rgba(168,85,247,0.30))",  # Orange-purple
            "clean": "linear-gradient(145deg, rgba(30,41,59,0.97), rgba(15,23,42,0.94))",  # Default dark
        }
        return backgrounds.get(git_status, backgrounds["clean"])

    def _render_entry(self, entry: dict, level: int) -> None:
        is_dir = entry["kind"] == "dir"
        is_expanded = self.state.is_expanded(entry["rel"]) if is_dir else False

        # Compute git status (with inheritance for directories)
        git_status = self._compute_directory_git_status(entry) if is_dir else entry.get("gitStatus", "clean")
        background = self._get_card_background(git_status)

        margin_left = max(0, level * 8)
        card_style = (
            f"margin-left: {margin_left}px;"
            f"width: calc(100% - {margin_left}px);"
            f"background: {background};"
            "border: 1px solid rgba(148,163,184,0.28);"
            "border-radius: 18px;"
            "padding: 12px 14px;"
            "box-shadow: 0 18px 28px rgba(15,23,42,0.55);"
            "color: rgba(226,232,240,0.96);"
            "margin-bottom: 8px;"
            "display: flex;"
            "flex-direction: column;"
        )
        with ui.element("div").classes("nc-explorer-card w-full").style(card_style):
            with ui.row().classes("nc-explorer-card-header w-full items-center gap-2"):
                if is_dir:
                    twisty = ui.label("▾" if is_expanded else "▸").classes("nc-explorer-twisty text-xs")
                    twisty.on("click", lambda e=entry: self._toggle_directory(e))
                else:
                    ui.label("").classes("nc-explorer-twisty text-xs")

                icon_name = "folder" if is_dir else ("code" if entry.get("isExecutable") else "insert_drive_file")
                ui.icon(icon_name).classes(
                    f"text-{'blue-200' if is_dir else ('green-200' if entry.get('isExecutable') else 'slate-200')} text-sm flex-shrink-0"
                )

                with ui.row().classes("flex-1 items-center gap-2 min-w-0"):
                    label = ui.label(entry["name"]).classes("text-xs text-slate-100 truncate")
                    label.on("click", lambda e=entry: self._handle_entry_click(e))

                    git_status = entry.get("gitStatus", "clean")
                    badge_map = {
                        "modified": ("M", "bg-yellow-600"),
                        "staged": ("S", "bg-green-600"),
                        "staged_modified": ("SM", "bg-orange-600"),
                        "added": ("A", "bg-green-600"),
                        "deleted": ("D", "bg-red-600"),
                        "renamed": ("R", "bg-blue-600"),
                        "untracked": ("U", "bg-gray-600"),
                        "conflict": ("C", "bg-red-700"),
                    }
                    if git_status in badge_map:
                        badge_text, badge_color = badge_map[git_status]
                        ui.label(badge_text).classes(
                            f"text-white text-[10px] px-1 py-0.5 rounded {badge_color} flex-shrink-0 leading-none"
                        )

            if is_dir and is_expanded:
                try:
                    child_data = self.state.list_directory(entry["rel"])
                    child_style = (
                        "margin-top: 6px;"
                        "border-left: 1px solid rgba(148,163,184,0.18);"
                        "padding-left: 12px;"
                        "display: flex;"
                        "flex-direction: column;"
                        "gap: 4px;"
                    )
                    with ui.column().classes("nc-explorer-card-children").style(child_style):
                        self._render_directory_contents(entry["rel"], child_data.get("entries", []), level + 1)
                except Exception:
                    pass

    # ---------------------------------------------------------------- actions
    def _toggle_directory(self, entry: dict) -> None:
        self.state.toggle_expand(entry["rel"])
        self._build_tree()

    def _handle_entry_click(self, entry: dict) -> None:
        if entry["kind"] == "dir":
            self._toggle_directory(entry)
        else:
            self._open_relative_file(entry["rel"], display_name=entry["name"])

    def _open_relative_file(self, relative_path: str, display_name: Optional[str] = None) -> None:
        self.state.add_recent_file(relative_path)
        if self._editor:
            self._editor.open_file(relative_path)
            if display_name:
                ui.notify(f"Opened {display_name}", type="positive", timeout=2)
        else:
            ui.notify("Editor unavailable", type="warning")
        if self.layout_manager and getattr(self.layout_manager, "explorer_visible", False):
            self.layout_manager.toggle_explorer()

    def _show_recents_menu(self) -> None:
        with ui.menu() as menu:
            if not self.state.recent_files:
                ui.menu_item("No recent files").props("disable")
            else:
                for rel_path in self.state.recent_files:
                    label = Path(rel_path).name or rel_path
                    ui.menu_item(label, on_click=lambda p=rel_path: self._open_recent_file(p))
                ui.separator()
                ui.menu_item("Clear Recents", on_click=self._clear_recents)
        menu.open()

    def _open_recent_file(self, relative_path: str) -> None:
        self._open_relative_file(relative_path)

    def _clear_recents(self) -> None:
        self.state.clear_recents()
        ui.notify("Recent files cleared")

    async def open_project_prompt(self) -> None:
        current = json.dumps(str(self.state.get_project()))
        result = await ui.run_javascript(f'prompt("Enter project path:", {current})', timeout=30.0)
        if result:
            try:
                self.state.set_project(result)
                self.reload_for_new_project()
                ui.notify(f"Project changed to: {result}")
            except Exception as exc:
                ui.notify(f"Error: {exc}", type="negative")

    def reload_for_new_project(self) -> None:
        if self.project_label:
            self.project_label.text = str(self.state.get_project())
        self.refresh_view()

    def refresh_view(self, show_toast: bool = False) -> None:
        self.state.refresh_git_cache()
        self._build_tree()
        self._update_git_summary()
        if show_toast:
            ui.notify("Explorer refreshed")

    def _refresh_tree(self) -> None:
        self.refresh_view(show_toast=True)

    # ---------------------------------------------------------------- git TODOs
    def _git_stage_all(self) -> None:
        ui.notify("Stage All - Not implemented yet")

    def _git_unstage_all(self) -> None:
        ui.notify("Unstage All - Not implemented yet")

    def _git_commit(self) -> None:
        ui.notify("Commit - Not implemented yet")

    def _git_push(self) -> None:
        ui.notify("Push - Not implemented yet")

    def _git_pull(self) -> None:
        ui.notify("Pull - Not implemented yet")

    # ---------------------------------------------------------------- styles
    def _ensure_styles(self) -> None:
        if ExplorerModule._styles_injected:
            return
        ui.add_head_html(
            """
            <style>
            .nc-explorer-card-header { cursor: pointer; color: inherit; }
            .nc-explorer-card-header:hover { color: rgba(248, 250, 252, 0.98); }
            .nc-explorer-card:hover { border-color: rgba(148, 163, 184, 0.38); transform: translateY(-1px); }
            .nc-explorer-twisty {
                width: 18px;
                color: rgba(191, 219, 254, 0.8);
                cursor: pointer;
                user-select: none;
            }
            .nc-explorer-card * { color: inherit; }
            </style>
            """
        )
        ExplorerModule._styles_injected = True
