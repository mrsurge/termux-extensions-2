"""Module contract for NiceGUI Code CM6."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from nicegui import ui


class Module(ABC):
    """Base interface all modules must implement."""

    @property
    @abstractmethod
    def key(self) -> str:
        """Stable identifier (e.g. ``"explorer"``)."""

    @property
    def label(self) -> str:
        """Human-readable label used in UI elements."""
        return self.key.title()

    @property
    def icon(self) -> Optional[str]:
        """Icon name/emoji for drawers or tabs."""
        return None

    def on_mount(self) -> None:
        """Hook when module is instantiated."""

    def on_unmount(self) -> None:
        """Hook when module is about to be destroyed."""

    @abstractmethod
    def render(self, container: ui.element) -> None:
        """Render the module into the provided NiceGUI container."""

    # Optional event hooks -------------------------------------------------
    def on_file_open(self, path: str) -> None:
        """Called when a file is opened."""

    def on_file_saved(self, path: str) -> None:
        """Called when the active file is saved."""
