# pyright: strict
"""Bounded, one-use capabilities for backend-owned immutable History content."""
from __future__ import annotations

import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

from .secondary_content_state import HistoricalContent


@dataclass(frozen=True)
class Handoff:
    owner: str
    project: str
    generation: int
    content: HistoricalContent
    expires: float
    valid: Callable[[], bool]


class HistoryHandoffs:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock: Callable[[], float] = clock
        self._entries: dict[str, Handoff] = {}

    def issue(self, owner: str, project: str, generation: int,
              content: HistoricalContent, valid: Callable[[], bool]) -> str:
        # One outstanding selection per invoking client, at most 32 bounded
        # blob pairs. Expiration is checked on access, never by a polling task.
        now = self._clock()
        self._entries = {key: value for key, value in self._entries.items()
                         if value.expires > now and value.owner != owner and value.valid()}
        if len(self._entries) >= 32:
            raise RuntimeError("History handoff capacity reached")
        if not valid():
            raise ValueError("History selection is stale")
        token = secrets.token_hex(24)
        self._entries[token] = Handoff(owner, project, generation, content, now + 60, valid)
        return token

    def take(self, token: str, project: str, generation: int) -> HistoricalContent:
        entry = self._entries.pop(token, None)
        if (entry is None or entry.expires <= self._clock() or entry.project != project
                or entry.generation != generation or not entry.valid()):
            raise ValueError("History selection expired or was superseded; select the file again")
        return entry.content


handoffs = HistoryHandoffs()
