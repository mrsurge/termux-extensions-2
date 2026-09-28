"""Demand-loaded terminal parser implementation; no shell or transport ownership."""
from __future__ import annotations

from typing import final

import pyte  # type: ignore[reportMissingTypeStubs]


@final
class TrackedByteStream(pyte.ByteStream):
    @property
    def parser_neutral(self) -> bool:
        return self._taking_plain_text is True

    def decoder_pending_bytes(self) -> bytes:
        state = self.utf8_decoder.getstate()
        return bytes(state[0])


def create_screen(columns: int, lines: int, history: int) -> tuple[pyte.HistoryScreen, TrackedByteStream]:
    screen = pyte.HistoryScreen(columns, lines, history=history)
    return screen, TrackedByteStream(screen)
