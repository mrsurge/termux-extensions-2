from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator, Optional

from app.te2_console_log import TE2_CONSOLE_LOG_PATH, iter_console_log_lines_reverse
from .models import ConsoleLogEntry

DEFAULT_CONSOLE_LOG_PATH = TE2_CONSOLE_LOG_PATH


class ConsoleStore:
    def __init__(self, log_path: Path | None = None) -> None:
        self.log_path = Path(log_path) if log_path else DEFAULT_CONSOLE_LOG_PATH

    def exists(self) -> bool:
        return self.log_path.exists()

    def iter_entries(self) -> Iterator[ConsoleLogEntry]:
        if not self.log_path.exists():
            return
        with self.log_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                try:
                    yield ConsoleLogEntry.model_validate(payload)
                except Exception:
                    continue

    def tail(self, *, limit: int = 100, worker_id: str | None = None, level: str | None = None) -> list[ConsoleLogEntry]:
        limit = max(1, min(int(limit), 1000))
        entries: list[ConsoleLogEntry] = []
        for raw in iter_console_log_lines_reverse(self.log_path):
            try:
                payload = json.loads(raw)
                entry = ConsoleLogEntry.model_validate(payload)
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError, TypeError):
                continue
            if not _matches(entry, worker_id=worker_id, level=level):
                continue
            entries.append(entry)
            if len(entries) >= limit:
                break
        entries.reverse()
        return entries

    def search(
        self,
        *,
        query: str,
        limit: int = 100,
        worker_id: str | None = None,
        level: str | None = None,
    ) -> list[ConsoleLogEntry]:
        q = str(query or "").strip().lower()
        if not q:
            return []
        limit = max(1, min(int(limit), 1000))
        matches: list[ConsoleLogEntry] = []
        for entry in self.iter_entries():
            if not _matches(entry, worker_id=worker_id, level=level):
                continue
            haystack = _entry_text(entry).lower()
            if q not in haystack:
                continue
            matches.append(entry)
            if len(matches) >= limit:
                break
        return matches

    def list_workers(self) -> list[str]:
        workers = {entry.workerId for entry in self.iter_entries() if entry.workerId}
        return sorted(workers)


def _matches(entry: ConsoleLogEntry, *, worker_id: Optional[str], level: Optional[str]) -> bool:
    if worker_id and entry.workerId != worker_id:
        return False
    if level and entry.level != level:
        return False
    return True


def _entry_text(entry: ConsoleLogEntry) -> str:
    parts: list[str] = [entry.workerId, entry.level]
    for item in entry.args:
        try:
            parts.append(json.dumps(item, ensure_ascii=False, default=str))
        except Exception:
            parts.append(str(item))
    return " ".join(parts)
