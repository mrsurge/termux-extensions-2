"""Project context ensuring all activity stays within a single root."""

from __future__ import annotations

import os
from contextlib import suppress
from pathlib import Path
from typing import Optional

from ..helpers.state_store import StateStore


PROJECT_ROOT_ENV = "TE_NICECODE_PROJECT_ROOT"


class ProjectContext:
    """Resolve, persist, and guard access to the active project directory."""

    def __init__(self, state_store: StateStore):
        self._state_store = state_store
        self._root: Path = Path()
        self._load_initial_root()

    # ------------------------------------------------------------------ internals
    def _load_initial_root(self) -> None:
        env_override = os.getenv(PROJECT_ROOT_ENV)
        stored_root = self._state_store.get_value("project", "root")
        candidate = env_override or stored_root
        try:
            root = self._normalize(candidate) if candidate else self._normalize(Path.cwd())
        except FileNotFoundError:
            root = self._normalize(Path.cwd())
        self._apply_root(root, persist=env_override is None)

    def _normalize(self, path_like: Optional[str | Path]) -> Path:
        if not path_like:
            raise FileNotFoundError("Project root not provided")
        path = Path(path_like).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Project root not found: {path}")
        if not path.is_dir():
            raise NotADirectoryError(f"Project root is not a directory: {path}")
        return path

    def _apply_root(self, root: Path, *, persist: bool) -> None:
        self._root = root
        if persist:
            self._state_store.set_value("project", "root", str(root))
        self._notify_backend(root)

    @staticmethod
    def _notify_backend(root: Path) -> None:
        """Inform the legacy explorer helpers which project root to use."""
        from ..helpers.explorer_backend import set_project_root  # lazy import

        with suppress(Exception):
            set_project_root(str(root))

    # -------------------------------------------------------------------- public
    @property
    def root_path(self) -> Path:
        return self._root

    def set_root(self, path_like: str | Path) -> Path:
        """Change the active project root."""
        root = self._normalize(path_like)
        self._apply_root(root, persist=True)
        return root

    def ensure_within_root(self, path_like: str | Path) -> Path:
        """Resolve a path ensuring it resides within the project root."""
        candidate = Path(path_like)
        resolved = (
            candidate.expanduser().resolve()
            if candidate.is_absolute()
            else (self._root / candidate).expanduser().resolve()
        )
        if not self._contains(resolved):
            raise ValueError(f"Path {resolved} is outside project root {self._root}")
        return resolved

    def to_relative(self, path_like: str | Path) -> Path:
        """Translate an absolute project path to its relative representation."""
        resolved = self.ensure_within_root(path_like)
        return resolved.relative_to(self._root)

    def _contains(self, path: Path) -> bool:
        try:
            path.relative_to(self._root)
            return True
        except ValueError:
            return False

