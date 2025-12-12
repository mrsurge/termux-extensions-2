# app/apps/file_editor_cm6/stores.py

"""
Module to hold singleton instances of data stores.
This prevents circular dependencies between main.py and other modules that need access to the stores.
"""

from pathlib import Path
from typing import Optional

from .history_store import HistoryStore
from .preferences_store import PreferencesStore
from .project_sidecar import ProjectSidecar

# Initialize singleton instances
_history_store = HistoryStore()
_preferences_store = PreferencesStore()


def get_history_store() -> HistoryStore:
    """Return the shared HistoryStore instance (SSOT)."""
    return _history_store


def get_preferences_store() -> PreferencesStore:
    """Return the shared PreferencesStore instance (SSOT)."""
    return _preferences_store


def get_project_sidecar(project_path: Optional[str]) -> Optional[ProjectSidecar]:
    """Convenience helper to fetch the ProjectSidecar for a project path."""
    if not project_path:
        return None
    try:
        normalized = str(Path(project_path).expanduser().resolve(strict=False))
    except Exception:
        normalized = project_path
    try:
        return ProjectSidecar.load_or_create(normalized)
    except Exception:
        return None
