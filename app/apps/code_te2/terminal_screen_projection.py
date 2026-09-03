# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol, cast, final

import pyte  # type: ignore[reportMissingTypeStubs]


DEFAULT_COLUMNS: Final = 80
DEFAULT_LINES: Final = 24
MAX_HISTORY_LINES: Final = 5_000
MAX_PROJECTIONS: Final = 5
READ_CHUNK_BYTES: Final = 64 * 1024


@dataclass(frozen=True, slots=True)
class TerminalScreenCheckpoint:
    ansi: str
    pending_bytes: bytes
    output_offset: int
    columns: int
    lines: int


@dataclass(frozen=True, slots=True)
class TerminalOutputDelta:
    data: bytes
    start_offset: int
    end_offset: int


@dataclass(frozen=True, slots=True)
class TerminalProjectionGrowth:
    deltas: tuple[TerminalOutputDelta, ...]
    reset: bool


class _TerminalChar(Protocol):
    data: str
    fg: str
    bg: str
    bold: bool
    italics: bool
    underscore: bool
    strikethrough: bool
    reverse: bool
    blink: bool


class _TerminalLine(Protocol):
    def __getitem__(self, column: int) -> _TerminalChar: ...


class _TerminalCursor(Protocol):
    x: int
    y: int
    hidden: bool


class _TerminalHistory(Protocol):
    top: Iterable[_TerminalLine]


class _TerminalScreen(Protocol):
    columns: int
    lines: int
    history: _TerminalHistory
    buffer: Mapping[int, _TerminalLine]
    cursor: _TerminalCursor

    def resize(self, lines: int | None = None, columns: int | None = None) -> None: ...


@final
class _TrackedByteStream(pyte.ByteStream):
    @property
    def parser_neutral(self) -> bool:
        return self._taking_plain_text is True

    def decoder_pending_bytes(self) -> bytes:
        state = self.utf8_decoder.getstate()
        return bytes(state[0])


_FG_CODES: Final = {
    "black": 30,
    "red": 31,
    "green": 32,
    "brown": 33,
    "blue": 34,
    "magenta": 35,
    "cyan": 36,
    "white": 37,
    "brightblack": 90,
    "brightred": 91,
    "brightgreen": 92,
    "brightbrown": 93,
    "brightblue": 94,
    "brightmagenta": 95,
    "brightcyan": 96,
    "brightwhite": 97,
}
_BG_CODES: Final = {
    "black": 40,
    "red": 41,
    "green": 42,
    "brown": 43,
    "blue": 44,
    "magenta": 45,
    "cyan": 46,
    "white": 47,
    "brightblack": 100,
    "brightred": 101,
    "brightgreen": 102,
    "brightbrown": 103,
    "brightblue": 104,
    "brightmagenta": 105,
    "brightcyan": 106,
    "brightwhite": 107,
}


def _bounded_dimension(value: int, fallback: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = fallback
    return max(1, min(maximum, number))


def _color_codes(value: object, *, background: bool) -> list[int]:
    color = str(value or "default").strip().lower()
    if not color or color == "default":
        return []
    named = _BG_CODES if background else _FG_CODES
    code = named.get(color)
    if code is not None:
        return [code]
    if len(color) == 6:
        try:
            red = int(color[0:2], 16)
            green = int(color[2:4], 16)
            blue = int(color[4:6], 16)
        except ValueError:
            return []
        return [48 if background else 38, 2, red, green, blue]
    return []


def _style_key(char: _TerminalChar) -> tuple[object, ...]:
    return (
        str(char.fg),
        str(char.bg),
        bool(char.bold),
        bool(char.italics),
        bool(char.underscore),
        bool(char.strikethrough),
        bool(char.reverse),
        bool(char.blink),
    )


def _style_escape(style: tuple[object, ...]) -> str:
    foreground, background, bold, italics, underscore, strike, reverse, blink = style
    codes = [0]
    if bold:
        codes.append(1)
    if italics:
        codes.append(3)
    if underscore:
        codes.append(4)
    if blink:
        codes.append(5)
    if reverse:
        codes.append(7)
    if strike:
        codes.append(9)
    codes.extend(_color_codes(foreground, background=False))
    codes.extend(_color_codes(background, background=True))
    return f"\x1b[{';'.join(str(code) for code in codes)}m"


def _line_cells(line: _TerminalLine, columns: int) -> list[_TerminalChar]:
    cells = [line[column] for column in range(columns)]
    last = -1
    for index, char in enumerate(cells):
        data = str(char.data)
        if data not in {"", " "} or _style_key(char) != (
            "default",
            "default",
            False,
            False,
            False,
            False,
            False,
            False,
        ):
            last = index
    return cells[: last + 1]


def _encode_line(line: _TerminalLine, columns: int) -> str:
    parts: list[str] = []
    active_style: tuple[object, ...] | None = None
    for char in _line_cells(line, columns):
        style = _style_key(char)
        if style != active_style:
            parts.append(_style_escape(style))
            active_style = style
        data = str(char.data)
        if data:
            parts.append(data)
    if active_style is not None:
        parts.append("\x1b[0m")
    return "".join(parts)


def _screen_checkpoint_ansi(screen: _TerminalScreen) -> str:
    columns = int(screen.columns)
    lines = int(screen.lines)
    rendered_lines = [
        *(_encode_line(line, columns) for line in screen.history.top),
        *(_encode_line(screen.buffer[row], columns) for row in range(lines)),
    ]
    body = "\r\n".join(rendered_lines)
    cursor_row = max(1, min(lines, int(screen.cursor.y) + 1))
    cursor_column = max(1, min(columns, int(screen.cursor.x) + 1))
    cursor_visibility = "\x1b[?25l" if bool(screen.cursor.hidden) else "\x1b[?25h"
    return (
        "\x1b[?25l\x1b[3J\x1b[2J\x1b[H"
        f"{body}\x1b[0m\x1b[{cursor_row};{cursor_column}H{cursor_visibility}"
    )


@final
class _TerminalProjection:
    def __init__(self, shell_id: str, log_path: Path, columns: int, lines: int) -> None:
        self.shell_id = shell_id
        self.log_path = log_path
        self.columns = _bounded_dimension(columns, DEFAULT_COLUMNS, 1_000)
        self.lines = _bounded_dimension(lines, DEFAULT_LINES, 500)
        self.screen: _TerminalScreen
        self.stream: _TrackedByteStream
        self.output_offset: int = 0
        self.log_identity: tuple[int, int] | None = None
        self.initialized: bool = False
        self.checkpoint_ready: bool = False
        self.parser_pending_bytes: bytes = b""
        self.lock: asyncio.Lock = asyncio.Lock()
        self._reset_screen()

    def _reset_screen(self) -> None:
        raw_screen = pyte.HistoryScreen(
            self.columns,
            self.lines,
            history=MAX_HISTORY_LINES,
        )
        self.screen = cast(_TerminalScreen, cast(object, raw_screen))
        self.stream = _TrackedByteStream(raw_screen)
        self.output_offset = 0
        self.log_identity = None
        self.checkpoint_ready = False
        self.parser_pending_bytes = b""

    def _feed(self, data: bytes) -> None:
        had_parser_prefix = bool(self.parser_pending_bytes)
        self.stream.feed(data)
        parser_neutral = self.stream.parser_neutral
        if parser_neutral:
            self.parser_pending_bytes = b""
            return
        if had_parser_prefix:
            self.parser_pending_bytes += data
            return
        candidates = (
            data.rfind(b"\x1b"),
            data.rfind(b"\x9b"),
            data.rfind(b"\x9d"),
            data.rfind(b"\xc2\x9b"),
            data.rfind(b"\xc2\x9d"),
        )
        start = max(candidates)
        self.parser_pending_bytes = data[start:] if start >= 0 else data

    def _pending_bytes(self) -> bytes:
        if self.parser_pending_bytes:
            return self.parser_pending_bytes
        return self.stream.decoder_pending_bytes()

    def _stat_identity(self) -> tuple[tuple[int, int], int] | None:
        try:
            stat = self.log_path.stat()
        except FileNotFoundError:
            return None
        return (int(stat.st_dev), int(stat.st_ino)), int(stat.st_size)

    def _consume_log(self, *, collect: bool) -> tuple[tuple[TerminalOutputDelta, ...], bool]:
        current = self._stat_identity()
        reset = False
        if current is None:
            if self.initialized and (self.log_identity is not None or self.output_offset):
                self._reset_screen()
                reset = True
            self.initialized = True
            return (), reset

        identity, size = current
        if self.initialized and (
            self.log_identity is not None
            and (identity != self.log_identity or size < self.output_offset)
        ):
            self._reset_screen()
            reset = True
        self.log_identity = identity

        deltas: list[TerminalOutputDelta] = []
        with self.log_path.open("rb") as handle:
            _ = handle.seek(self.output_offset)
            while True:
                data = handle.read(READ_CHUNK_BYTES)
                if not data:
                    break
                start = self.output_offset
                self._feed(data)
                self.output_offset += len(data)
                if collect and not reset:
                    deltas.append(
                        TerminalOutputDelta(
                            data=data,
                            start_offset=start,
                            end_offset=self.output_offset,
                        )
                    )
        self.initialized = True
        return tuple(deltas), reset

    def _checkpoint(self, columns: int, lines: int) -> TerminalScreenCheckpoint:
        requested_columns = _bounded_dimension(columns, self.columns, 1_000)
        requested_lines = _bounded_dimension(lines, self.lines, 500)
        if requested_columns != self.columns or requested_lines != self.lines:
            self.columns = requested_columns
            self.lines = requested_lines
            self.screen.resize(lines=self.lines, columns=self.columns)
        _deltas, _reset = self._consume_log(collect=False)
        checkpoint = TerminalScreenCheckpoint(
            ansi=_screen_checkpoint_ansi(self.screen),
            pending_bytes=self._pending_bytes(),
            output_offset=self.output_offset,
            columns=self.columns,
            lines=self.lines,
        )
        self.checkpoint_ready = True
        return checkpoint

    async def checkpoint(self, columns: int, lines: int) -> TerminalScreenCheckpoint:
        async with self.lock:
            return await asyncio.to_thread(self._checkpoint, columns, lines)

    async def consume_growth(self) -> TerminalProjectionGrowth:
        async with self.lock:
            if not self.checkpoint_ready:
                return TerminalProjectionGrowth(deltas=(), reset=False)
            deltas, reset = await asyncio.to_thread(self._consume_log, collect=True)
            return TerminalProjectionGrowth(deltas=deltas, reset=reset)

    def _resize(self, columns: int, lines: int) -> bool:
        _deltas, reset = self._consume_log(collect=False)
        self.columns = _bounded_dimension(columns, self.columns, 1_000)
        self.lines = _bounded_dimension(lines, self.lines, 500)
        self.screen.resize(lines=self.lines, columns=self.columns)
        return reset

    async def resize(self, columns: int, lines: int) -> bool:
        async with self.lock:
            return await asyncio.to_thread(self._resize, columns, lines)


@final
class TerminalScreenProjectionRegistry:
    def __init__(self, capacity: int = MAX_PROJECTIONS) -> None:
        self.capacity = max(1, int(capacity))
        self._states: OrderedDict[str, _TerminalProjection] = OrderedDict()
        self._lock = asyncio.Lock()

    async def _state_for(
        self,
        shell_id: str,
        log_path: Path,
        columns: int,
        lines: int,
    ) -> _TerminalProjection:
        async with self._lock:
            state = self._states.get(shell_id)
            if state is None or state.log_path != log_path:
                state = _TerminalProjection(shell_id, log_path, columns, lines)
                self._states[shell_id] = state
            self._states.move_to_end(shell_id)
            while len(self._states) > self.capacity:
                _ = self._states.popitem(last=False)
            return state

    async def checkpoint(
        self,
        shell_id: str,
        log_path: Path,
        *,
        columns: int = DEFAULT_COLUMNS,
        lines: int = DEFAULT_LINES,
    ) -> TerminalScreenCheckpoint:
        state = await self._state_for(shell_id, log_path, columns, lines)
        return await state.checkpoint(columns, lines)

    async def consume_growth(self, shell_id: str) -> TerminalProjectionGrowth | None:
        async with self._lock:
            state = self._states.get(shell_id)
            if state is None:
                return None
            self._states.move_to_end(shell_id)
        return await state.consume_growth()

    async def resize(self, shell_id: str, columns: int, lines: int) -> bool:
        async with self._lock:
            state = self._states.get(shell_id)
            if state is None:
                return False
            self._states.move_to_end(shell_id)
        return await state.resize(columns, lines)

    async def discard(self, shell_id: str) -> None:
        async with self._lock:
            _ = self._states.pop(shell_id, None)


terminal_screen_projections = TerminalScreenProjectionRegistry()
