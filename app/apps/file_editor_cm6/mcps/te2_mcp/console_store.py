from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Iterator, Optional

from .models import ConsoleLogEntry

DEFAULT_CONSOLE_LOG_PATH = Path.home() / ".cache" / "cm6_editor" / "console_log.jsonl"


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
        entries = [
            entry
            for entry in self.iter_entries()
            if _matches(entry, worker_id=worker_id, level=level)
        ]
        return entries[-limit:]

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
