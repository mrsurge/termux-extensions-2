from __future__ import annotations

import asyncio
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


def test_shared_import_has_no_app_or_parser_dependency():
    result = subprocess.run([sys.executable, '-B', '-c', '''
import sys
from app.libs.terminal_runtime.screen_projection import TerminalScreenProjectionRegistry
assert not any(name.startswith('app.apps.code_te2') for name in sys.modules)
assert 'app.libs.terminal_runtime.pyte_parser' not in sys.modules
assert 'pyte' not in sys.modules
'''], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
