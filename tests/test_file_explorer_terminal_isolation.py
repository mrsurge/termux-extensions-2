"""Cross-app isolation and offset-bounded reconnect projection regressions."""
import asyncio
from pathlib import Path

from app.apps.file_explorer.terminal_projection import CheckpointProjection


def test_file_explorer_has_no_terminal_app_source_dependency():
    root = Path(__file__).resolve().parents[1]
    app = root / 'app/apps/file_explorer'
    for path in app.rglob('*'):
        if 'node_modules' in path.parts or path.suffix not in {'.py', '.ts', '.mjs', '.yaml'}:
            continue
        source = path.read_text()
        assert 'app.apps.terminal.' not in source, path
        assert '../terminal/' not in source, path
        assert 'apps/terminal/' not in source, path
    source = (app / 'terminal_stream_broker.mjs').read_text()
    assert 'HeadlessTerminal' not in source
    assert 'xterm-headless' not in (app / 'package-lock.json').read_text()
    assert 'backend: pipe' in (app / 'shellspec/terminal.yaml').read_text()


def test_checkpoint_stops_at_acknowledged_offset_and_survives_new_python_owner(tmp_path):
    async def run():
        log = tmp_path / 'output.raw'
        first = b'first\r\n\x1b[3'
        later = b'1mLATER\x1b[0m'
        log.write_bytes(first + later)
        projection = CheckpointProjection()
        checkpoint = await projection.checkpoint('shell', log, len(first), 80, 24)
        assert checkpoint.output_offset == len(first)
        assert 'first' in checkpoint.ansi and 'LATER' not in checkpoint.ansi
        assert checkpoint.pending_bytes == b'\x1b[3'
        full = await projection.checkpoint('shell', log, len(first + later), 80, 24)
        restored = await CheckpointProjection().checkpoint('shell', log, len(first + later), 80, 24)
        assert restored == full
        assert 'LATER' in restored.ansi
        assert restored.pending_bytes == b''
    asyncio.run(run())
