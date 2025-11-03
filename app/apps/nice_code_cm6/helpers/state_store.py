"""Simple disk-backed state store for Nice Code CM6."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict


STATE_DIR_ENV = "TE_NICECODE_STATE_DIR"
DEFAULT_STATE_DIR = Path.home() / ".cache" / "te-framework" / "nice_code_cm6"


class StateStore:
    """Persist small pieces of editor/app state on disk.

    The store writes JSON files under a dedicated cache directory so settings,
    recent files, and layout preferences survive process restarts.
    """

    def __init__(self, filename: str = "state.json"):
        self._base_dir = Path(os.getenv(STATE_DIR_ENV, DEFAULT_STATE_DIR)).expanduser()
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._path = self._base_dir / filename
        self._data: Dict[str, Any] = {}
        self._load()

    # ------------------------------------------------------------------ utils
    @property
    def path(self) -> Path:
        return self._path

    @property
    def base_dir(self) -> Path:
        return self._base_dir

    def _load(self) -> None:
        if not self._path.exists():
            self._data = {}
            return
        try:
            text = self._path.read_text(encoding="utf-8")
            self._data = json.loads(text) if text else {}
        except Exception:
            # Corrupt state resets to empty store; future writes will repair it.
            self._data = {}

    def _write(self) -> None:
        tmp_path = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(self._data, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        tmp_path.replace(self._path)

    @staticmethod
    def _clone(value: Any) -> Any:
        return json.loads(json.dumps(value))

    # ---------------------------------------------------------------- sections
    def get_section(self, name: str, default: Dict[str, Any] | None = None) -> Dict[str, Any]:
        section = self._data.get(name, {})
        if not isinstance(section, dict):
            return self._clone(default or {})
        return self._clone(section)

    def update_section(self, name: str, updates: Dict[str, Any]) -> None:
        section = self._data.setdefault(name, {})
        if not isinstance(section, dict):
            section = {}
            self._data[name] = section
        section.update(updates)
        self._write()

    def get_value(self, section: str, key: str, default: Any = None) -> Any:
        value = self._data.get(section, {}).get(key, default)
        return self._clone(value)

    def set_value(self, section: str, key: str, value: Any) -> None:
        self.update_section(section, {key: value})

