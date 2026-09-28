"""Small, independently readable startup authority; no app or transport imports."""
# pyright: strict
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
from pathlib import Path
from typing import cast

from .code_te2_paths import code_te2_paths
from . import persistence_io


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    raw = cast(dict[object, object], value)
    if any(not isinstance(key, str) for key in raw):
        raise ValueError("Expected string keys")
    return cast(dict[str, object], raw)


@dataclass(frozen=True)
class IntelligenceState:
    web_workers_enabled: bool
    installation: dict[str, object] | None


class IntelligenceStateStore:
    def __init__(self, legacy_path: Path | None = None) -> None:
        self.legacy_path: Path = legacy_path or code_te2_paths().preferences_path
        self.path: Path = code_te2_paths().intelligence_state_path if legacy_path is None else (
            self.legacy_path.with_name("intelligence.json")
            if self.legacy_path.name == "preferences.json"
            else self.legacy_path.with_suffix(".intelligence.json")
        )

    @contextmanager
    def _locked(self) -> Iterator[None]:
        # Lock a stable sibling, not the atomically replaced inode. This covers
        # independent bootstrap/preference instances and concurrent worker threads.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _write(self, state: IntelligenceState) -> None:
        payload = persistence_io.encode_json({
            "version": 1,
            "webWorkersEnabled": state.web_workers_enabled,
            "codeServerInstallation": state.installation,
        })
        persistence_io.write_bytes_atomic(self.path, payload, temporary_prefix=self.path.name + ".")

    def _read(self) -> IntelligenceState:
        if self.path.exists():
            data = _object(persistence_io.decode_json(persistence_io.decode_utf8(persistence_io.read_bytes(self.path))))
            mode = data.get("webWorkersEnabled")
            if data.get("version") != 1 or not isinstance(mode, bool) or "codeServerInstallation" not in data:
                raise ValueError(f"Invalid intelligence state: {self.path}")
            raw = data.get("codeServerInstallation")
            return IntelligenceState(mode, None if raw is None else _object(raw))

        # Only a missing canonical file permits migration. Invalid existing state
        # must not resurrect stale preferences or silently launch code-server.
        legacy: dict[str, object] = {}
        if self.legacy_path.exists():
            legacy = _object(persistence_io.decode_json(persistence_io.decode_utf8(persistence_io.read_bytes(self.legacy_path))))
        ui = _object(legacy.get("ui", {}))
        mode = ui.get("webWorkersEnabled") is True
        raw = legacy.get("codeServerInstallation")
        installation = None if raw is None else _object(raw)
        state = IntelligenceState(mode, {"installed": False} if mode else installation)
        self._write(state)
        return state

    def read(self) -> IntelligenceState:
        with self._locked():
            return self._read()

    def set_web_workers_enabled(self, enabled: bool) -> None:
        with self._locked():
            previous = self._read()
            # Mode and installation invalidation remain a single atomic update.
            state = IntelligenceState(enabled, {"installed": False} if enabled else previous.installation)
            if state != previous:
                self._write(state)

    def get_code_server_installation(self) -> dict[str, object] | None:
        return self.read().installation

    def set_code_server_installation(self, installation: dict[str, object]) -> None:
        with self._locked():
            previous = self._read()
            state = IntelligenceState(previous.web_workers_enabled, dict(installation))
            if state != previous:
                self._write(state)
