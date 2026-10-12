from __future__ import annotations

import asyncio
import json
from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys

import pytest

from app.libs.terminal_runtime.screen_projection import TerminalScreenProjectionRegistry


class Reader:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.identity = (1, 1)
        self.size = len(content)
        self.offset = 0
        self.closed = False

    def seek(self, offset: int) -> None:
        self.offset = offset

    def read(self, limit: int) -> bytes:
        result = self.content[self.offset:self.offset + limit]
        self.offset += len(result)
        return result

    def close(self) -> None:
        self.closed = True


def test_registries_have_independent_readers_and_state():
    readers = []
    def opener(content):
        @contextmanager
        def open_log(path):
            reader = Reader(content)
            readers.append(reader)
            try:
                yield reader
            finally:
                reader.close()
        return open_log

    async def run():
        first = TerminalScreenProjectionRegistry(log_opener=opener(b'first'))
        second = TerminalScreenProjectionRegistry(log_opener=opener(b'second'))
        a, b = await asyncio.gather(first.checkpoint('same-id', Path('opaque')),
                                    second.checkpoint('same-id', Path('opaque')))
        assert a.output_offset == 5 and b.output_offset == 6
        assert 'first' in a.ansi and 'second' in b.ansi
        await first.discard('same-id')
        assert await first.consume_growth('same-id') is None
        assert await second.consume_growth('same-id') is not None
    asyncio.run(run())
    assert readers and all(reader.closed for reader in readers)


def test_reader_failure_propagates_without_disk_fallback():
    @contextmanager
    def fail(path):
        raise OSError('owned reader failed')
        yield  # pragma: no cover

    async def run():
        registry = TerminalScreenProjectionRegistry(log_opener=fail)
        with pytest.raises(OSError, match='owned reader failed'):
            await registry.checkpoint('shell', Path('not-a-real-path'))
    asyncio.run(run())


def test_checkpoint_preserves_truecolor_foreground_and_background():
    content = b'\x1b[38;2;17;83;149;48;2;201;37;119mRGB\x1b[0m'
    @contextmanager
    def open_log(path):
        yield Reader(content)
    async def run():
        registry = TerminalScreenProjectionRegistry(log_opener=open_log)
        checkpoint = await registry.checkpoint('rgb', Path('opaque'))
        assert '38;2;17;83;149' in checkpoint.ansi
        assert '48;2;201;37;119' in checkpoint.ansi
        await registry.discard('rgb')
    asyncio.run(run())


def test_checkpoint_restores_tui_mouse_paste_and_alternate_buffer_modes():
    content = b'\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[?2004h\x1b[?1hNVIM'
    @contextmanager
    def open_log(path):
        yield Reader(content)
    async def run():
        registry = TerminalScreenProjectionRegistry(log_opener=open_log)
        checkpoint = await registry.checkpoint('tui', Path('opaque'))
        for sequence in ('\x1b[?1049h', '\x1b[?1002h', '\x1b[?1006h', '\x1b[?2004h', '\x1b[?1h'):
            assert sequence in checkpoint.ansi
        result = subprocess.run(['node', '-e', '''
const fs = require('node:fs');
globalThis.window = globalThis;
const { Terminal } = require('./app/apps/terminal/node_modules/xterm-headless');
const term = new Terminal({cols:80,rows:24,allowProposedApi:true});
term.write(fs.readFileSync(0), () => {
  console.log(JSON.stringify({modes:term.modes, buffer:term.buffer.active.type,
    encoding:term._core.coreMouseService.activeEncoding}));
  term.dispose();
});
'''], input=checkpoint.ansi, text=True, capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr
        replay = json.loads(result.stdout)
        assert replay['modes']['mouseTrackingMode'] == 'drag'
        assert replay['modes']['bracketedPasteMode'] is True
        assert replay['modes']['applicationCursorKeysMode'] is True
        assert replay['encoding'] == 'SGR'
        assert replay['buffer'] == 'alternate'
        await registry.discard('tui')
    asyncio.run(run())


def test_shared_import_has_no_app_or_parser_dependency():
    result = subprocess.run([sys.executable, '-B', '-c', '''
import sys
from app.libs.terminal_runtime.screen_projection import TerminalScreenProjectionRegistry
assert not any(name.startswith('app.apps.code_te2') for name in sys.modules)
assert 'app.libs.terminal_runtime.pyte_parser' not in sys.modules
assert 'pyte' not in sys.modules
'''], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
