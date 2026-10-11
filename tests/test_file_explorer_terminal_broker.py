from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.apps.file_explorer.terminal_broker import BrokerSession
from app.apps.terminal.terminal_stream_protocol import encode_pipe_message


def test_control_reader_does_not_wait_for_tab_event_lock(tmp_path):
    from tests.test_file_explorer_terminal import Manager

    async def run():
        manager = Manager(tmp_path)
        queue = await manager.subscribe_output_bytes('owned')
        blocked = asyncio.Event()
        async def sink(_shell, _message):
            await blocked.wait()
        session = BrokerSession('owned', manager, queue, sink)
        try:
            checkpoint = await asyncio.wait_for(session.request({'type': 'attach'}), 1)
            assert checkpoint['state'] == b'hello\r\n'
            assert checkpoint['outputOffset'] == 7
            # EOF rejects pending operations; it never replays them.
            queue.put_nowait(None)
            await session.reader
            assert session.closed
        finally:
            blocked.set()
            await session.close()
    asyncio.run(run())


def test_adapter_real_broker_idle_directory_and_checkpoint(tmp_path):
    """Exercise Python framing -> Node -> Bash control -> Python, no framework."""
    node = shutil.which('node')
    assert node is not None
    root = Path(__file__).resolve().parents[1]
    target = tmp_path / "spaces' literal$(path)"
    target.mkdir()
    (tmp_path / '.bash_profile').write_text("PS1='ADAPTER_PROMPT> '\n")

    async def run():
        process = await asyncio.create_subprocess_exec(
            node, str(root / 'app/apps/terminal/terminal_stream_broker.mjs'),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, 'HOME': str(tmp_path), 'TERMINAL_STREAM_CWD': str(tmp_path),
                 'TERMINAL_STREAM_DIRECTORY_CONTROL': '1', 'TERMINAL_STREAM_CONTROL_ROOT': str(tmp_path)},
        )
        queue = asyncio.Queue()
        class Manager:
            def get_pipe_state(self, _shell):
                return SimpleNamespace(stdin_supported=True, process=process)
            async def unsubscribe_output_bytes(self, _shell, _queue): pass
        async def pump():
            while chunk := await process.stdout.read(65536):
                await queue.put(chunk)
            await queue.put(None)
        pump_task = asyncio.create_task(pump())
        events = asyncio.Queue()
        async def sink(_shell, message): await events.put(message)
        session = BrokerSession('owned', Manager(), queue, sink)
        async def state(value):
            async with asyncio.timeout(5):
                while True:
                    event = await events.get()
                    tracking = event.get('directoryTracking', {})
                    if tracking.get('state') == value: return tracking
        try:
            await state('ready')
            result = await session.request({'type': 'directory.request', 'path': str(target)})
            assert result['state'] == 'pending'
            assert (await state('applied'))['path'] == str(target)
            await session.send({'type': 'input', 'data': b"printf 'ADAPTER_CWD=%s\\n' \"$PWD\"\n"})
            async with asyncio.timeout(5):
                output = b''
                while b'ADAPTER_CWD=' + str(target).encode() not in output:
                    event = await events.get()
                    if event.get('type') == 'output': output += event['data']
            checkpoint = await session.request({'type': 'attach', 'cols': 80, 'rows': 24})
            assert b'ADAPTER_CWD=' in checkpoint['state']
            assert checkpoint['outputOffset'] > 0
            await session.send({'type': 'directory.cancel'})
            assert (await session.request({'type': 'ping'}))['type'] == 'pong'
            with pytest.raises(RuntimeError, match='invalid directory request'):
                await session.request({'type': 'directory.request', 'path': 'not-absolute'})
        finally:
            if process.returncode is None:
                process.stdin.write(encode_pipe_message({'type': 'destroy'}))
                await process.stdin.drain()
                await asyncio.wait_for(process.wait(), 5)
            await pump_task
            await session.close()
    asyncio.run(run())
