"""Backend logic for the explorer module."""

from __future__ import annotations

import sys
from contextlib import suppress
from pathlib import Path
from typing import List, Optional

from typing import TYPE_CHECKING

from .state_store import StateStore

if TYPE_CHECKING:  # pragma: no cover - type hint convenience
    from ..core.project_context import ProjectContext

# Import the battle-tested helpers from file_editor_cm6
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "file_editor_cm6"))
try:
    from explorer_helper import (
        list_dir,
        set_project_root,
        mark_git_cache_dirty,
    )
    from git_helper import GitStatus, get_status, GitError
except ImportError as exc:  # pragma: no cover - best effort
    print(f"[explorer_backend] Warning: Could not import file_editor_cm6 helpers: {exc}")

    def list_dir(rel: str = ".") -> dict:
        return {"cwd": ".", "entries": []}

    def set_project_root(path: str) -> Path:
        return Path(path).expanduser().resolve()

    def mark_git_cache_dirty(project_root: Optional[Path] = None) -> None:
        return None

    class GitError(RuntimeError):
        pass

    class GitStatus:
        def __init__(self) -> None:
            self.branch = "main"
            self.detached = False
            self.ahead = 0
            self.behind = 0
            self.staged = []
            self.unstaged = []
            self.untracked = []

    def get_status(project_root: Path) -> GitStatus:
        return GitStatus()


class ExplorerState:
    """Global explorer state shared by the NiceGUI app."""

    def __init__(self) -> None:
        self.project_context: Optional[ProjectContext] = None
        self.state_store: Optional[StateStore] = None
        self.expanded_dirs: set[str] = set()
        self.recent_files: List[str] = []
        self.max_recents = 10
        self._bound = False

    # ----------------------------------------------------------------- binding
    def bind(self, project_context: "ProjectContext", state_store: StateStore) -> None:
        if self._bound and self.project_context is project_context and self.state_store is state_store:
            return
        self.project_context = project_context
        self.state_store = state_store
        data = state_store.get_section("explorer", {})
        self.expanded_dirs = set(data.get("expanded_dirs", []))
        self.recent_files = data.get("recent_files", [])
        self._bound = True
        self._apply_project_root(project_context.root_path)

    def _apply_project_root(self, root: Path) -> None:
        with suppress(Exception):
            set_project_root(str(root))

    def _persist(self) -> None:
        if not self.state_store:
            return
        payload = {
            "expanded_dirs": sorted(self.expanded_dirs),
            "recent_files": list(self.recent_files),
        }
        self.state_store.update_section("explorer", payload)

    # ----------------------------------------------------------------- project
    def set_project(self, path: str) -> Path:
        if not self.project_context:
            raise RuntimeError("Project context not bound")
        root = self.project_context.set_root(path)
        self.expanded_dirs.clear()
        self.recent_files.clear()
        self._persist()
        self._apply_project_root(root)
        return root

    def get_project(self) -> Path:
        if not self.project_context:
            raise RuntimeError("Project context not bound")
        return self.project_context.root_path

    # ---------------------------------------------------------------- directory
    def list_directory(self, rel: str = ".") -> dict:
        return list_dir(rel)

    def toggle_expand(self, rel_path: str) -> None:
        if rel_path in self.expanded_dirs:
            self.expanded_dirs.discard(rel_path)
            to_remove = {p for p in self.expanded_dirs if p.startswith(f"{rel_path}/")}
            self.expanded_dirs -= to_remove
        else:
            self.expanded_dirs.add(rel_path)
        self._persist()

    def is_expanded(self, rel_path: str) -> bool:
        return rel_path in self.expanded_dirs

    # ------------------------------------------------------------------- recents
    def add_recent_file(self, relative_path: str) -> None:
        rel = relative_path.replace("\\", "/")
        if rel in self.recent_files:
            self.recent_files.remove(rel)
        self.recent_files.insert(0, rel)
        self.recent_files = self.recent_files[: self.max_recents]
        self._persist()

    def clear_recents(self) -> None:
        self.recent_files.clear()
        self._persist()

    def recent_absolute_paths(self) -> List[Path]:
        if not self.project_context:
            return []
        return [self.project_context.ensure_within_root(rel) for rel in self.recent_files]

    # ---------------------------------------------------------------------- git
    def get_git_status(self) -> Optional[GitStatus]:
        try:
            return get_status(self.get_project())
        except (GitError, Exception):
            return None

    def refresh_git_cache(self) -> None:
        mark_git_cache_dirty(self.get_project())


_state = ExplorerState()


def get_explorer_state() -> ExplorerState:
    return _state
