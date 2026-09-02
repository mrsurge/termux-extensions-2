from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import final, override

import pyte

from app.apps.code_te2.terminal_screen_projection import (
    MAX_HISTORY_LINES,
    TerminalScreenCheckpoint,
    TerminalScreenProjectionRegistry,
)


def _replay(checkpoint: TerminalScreenCheckpoint) -> tuple[pyte.HistoryScreen, pyte.ByteStream]:
    screen = pyte.HistoryScreen(
        checkpoint.columns,
        checkpoint.lines,
        history=MAX_HISTORY_LINES,
    )
    stream = pyte.ByteStream(screen)
    stream.feed(checkpoint.ansi.encode())
    if checkpoint.pending_bytes:
        stream.feed(checkpoint.pending_bytes)
    return screen, stream


@final
class TerminalScreenProjectionTests(unittest.IsolatedAsyncioTestCase):
    _temporary_directory: tempfile.TemporaryDirectory[str] | None = None
    tmp_path: Path = Path()

    @override
    def setUp(self) -> None:
        self._temporary_directory = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temporary_directory.name)

    @override
    def tearDown(self) -> None:
        if self._temporary_directory is not None:
            self._temporary_directory.cleanup()

    async def checkpoint(
        self,
        registry: TerminalScreenProjectionRegistry,
        path: Path,
        *,
        columns: int = 40,
        lines: int = 6,
    ) -> TerminalScreenCheckpoint:
        return await registry.checkpoint(
            "shell",
            path,
            columns=columns,
            lines=lines,
        )

    async def test_checkpoint_canonicalizes_redraw_and_cursor_sequences(self) -> None:
        log = self.tmp_path / "terminal.log"
        _ = log.write_bytes(
            b"progress 10%\rprogress 20%\x1b[K\r\n"
            + b"second\r\nthird\x1b[1A\rSECOND\x1b[K"
        )

        checkpoint = await self.checkpoint(TerminalScreenProjectionRegistry(), log)
        replayed, _stream = _replay(checkpoint)

        self.assertEqual(replayed.display[0].rstrip(), "progress 20%")
        self.assertEqual(replayed.display[1].rstrip(), "SECOND")
        self.assertEqual(replayed.display[2].rstrip(), "third")
        self.assertEqual((replayed.cursor.x, replayed.cursor.y), (6, 1))

    async def test_checkpoint_preserves_sgr_attributes_and_colors(self) -> None:
        log = self.tmp_path / "terminal.log"
        _ = log.write_bytes(
            b"\x1b[1;3;4;5;7;9;91;104mA\x1b[0m"
            + b"\x1b[38;5;196mB\x1b[0m"
            + b"\x1b[38;2;1;2;3;48;2;4;5;6mC\x1b[0m"
        )

        checkpoint = await self.checkpoint(TerminalScreenProjectionRegistry(), log)
        replayed, _stream = _replay(checkpoint)
        first, second, third = (replayed.buffer[0][index] for index in range(3))

        self.assertEqual(first.data, "A")
        self.assertEqual(first.fg, "brightred")
        self.assertEqual(first.bg, "brightblue")
        self.assertTrue(first.bold and first.italics and first.underscore)
        self.assertTrue(first.blink and first.reverse and first.strikethrough)
        self.assertEqual((second.data, second.fg), ("B", "ff0000"))
        self.assertEqual((third.data, third.fg, third.bg), ("C", "010203", "040506"))

    async def test_split_utf8_and_incomplete_csi_cross_checkpoint(self) -> None:
        log = self.tmp_path / "terminal.log"
        _ = log.write_bytes(b"\xe2\x82")
        registry = TerminalScreenProjectionRegistry()
        checkpoint = await self.checkpoint(registry, log)

        self.assertEqual(checkpoint.output_offset, 2)
        self.assertEqual(checkpoint.pending_bytes, b"\xe2\x82")

        _ = log.write_bytes(b"\xe2\x82\xac\x1b[31")
        growth = await registry.consume_growth("shell")
        self.assertIsNotNone(growth)
        assert growth is not None
        self.assertFalse(growth.reset)
        self.assertEqual(
            [(item.start_offset, item.end_offset) for item in growth.deltas],
            [(2, 7)],
        )

        incomplete = await self.checkpoint(registry, log)
        self.assertEqual(incomplete.pending_bytes, b"\x1b[31")
        _ = log.write_bytes(b"\xe2\x82\xac\x1b[31mred")
        final_growth = await registry.consume_growth("shell")
        self.assertIsNotNone(final_growth)
        assert final_growth is not None
        self.assertFalse(final_growth.reset)
        self.assertEqual(
            [(item.start_offset, item.end_offset) for item in final_growth.deltas],
            [(7, 11)],
        )

        replayed, replay_stream = _replay(incomplete)
        for delta in final_growth.deltas:
            replay_stream.feed(delta.data)
        self.assertEqual(replayed.display[0].rstrip(), "€red")
        self.assertEqual(replayed.buffer[0][1].fg, "red")

    async def test_growth_offsets_are_exact_and_repeated_wakeups_are_empty(self) -> None:
        log = self.tmp_path / "terminal.log"
        _ = log.write_bytes(b"abc")
        registry = TerminalScreenProjectionRegistry()
        checkpoint = await self.checkpoint(registry, log)
        self.assertEqual(checkpoint.output_offset, 3)

        with log.open("ab") as handle:
            _ = handle.write(b"def")
        growth = await registry.consume_growth("shell")
        repeated = await registry.consume_growth("shell")

        self.assertIsNotNone(growth)
        self.assertIsNotNone(repeated)
        assert growth is not None and repeated is not None
        self.assertFalse(growth.reset)
        self.assertEqual(
            [(item.data, item.start_offset, item.end_offset) for item in growth.deltas],
            [(b"def", 3, 6)],
        )
        self.assertEqual(repeated.deltas, ())
        self.assertFalse(repeated.reset)

    async def test_log_truncation_forces_reset_and_rebuild(self) -> None:
        log = self.tmp_path / "terminal.log"
        _ = log.write_bytes(b"abcdef")
        registry = TerminalScreenProjectionRegistry()
        _ = await self.checkpoint(registry, log)

        _ = log.write_bytes(b"Z")
        growth = await registry.consume_growth("shell")
        self.assertIsNotNone(growth)
        assert growth is not None
        self.assertTrue(growth.reset)
        self.assertEqual(growth.deltas, ())

        checkpoint = await self.checkpoint(registry, log)
        replayed, _stream = _replay(checkpoint)
        self.assertEqual(checkpoint.output_offset, 1)
        self.assertEqual(replayed.display[0].rstrip(), "Z")

    async def test_resize_and_registry_capacity_are_bounded(self) -> None:
        first_log = self.tmp_path / "first.log"
        second_log = self.tmp_path / "second.log"
        _ = first_log.write_bytes(b"first")
        _ = second_log.write_bytes(b"second")
        registry = TerminalScreenProjectionRegistry(capacity=1)

        _ = await registry.checkpoint("first", first_log, columns=10, lines=2)
        reset = await registry.resize("first", 20, 4)
        self.assertFalse(reset)
        resized = await registry.checkpoint("first", first_log, columns=20, lines=4)
        self.assertEqual((resized.columns, resized.lines), (20, 4))

        _ = await registry.checkpoint("second", second_log, columns=10, lines=2)
        self.assertIsNone(await registry.consume_growth("first"))

    async def test_scrollback_is_bounded_and_private_modes_are_not_raw_replayed(self) -> None:
        log = self.tmp_path / "terminal.log"
        rows = [f"line-{index}".encode() for index in range(MAX_HISTORY_LINES + 25)]
        _ = log.write_bytes(b"\x1b[?2004h" + b"\r\n".join(rows))

        checkpoint = await self.checkpoint(
            TerminalScreenProjectionRegistry(),
            log,
            columns=24,
            lines=4,
        )
        replayed, _stream = _replay(checkpoint)

        self.assertEqual(len(replayed.history.top), MAX_HISTORY_LINES)
        self.assertIn("line-5024", replayed.display[-1])
        self.assertNotIn("?2004h", checkpoint.ansi)


if __name__ == "__main__":
    _ = unittest.main()
