from __future__ import annotations

import asyncio
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.apps.code_te2 import watchexec_shell_manager as watcher
from app.apps.code_te2.native_shells import Orchestrator, OutputReader, ShellManager, ShellRecord


class NativeAuxiliaryShellTests(unittest.IsolatedAsyncioTestCase):
    async def test_output_readiness_is_forwarded(self):
        bridge = Mock()
        bridge.shell_spawn.return_value = dict(id="s", label="runner-profile:code_te2:p:r", pid=10, status="running")
        result = await Orchestrator(ShellManager(bridge)).start_from_ref(
            "runner_profile.yaml#runner-profile", base_dir=Path.cwd(), ctx={"APP_ID": "code_te2"},
            label="runner-profile:code_te2:p:r", record_spec_id="runner", wait_ready=True)
        self.assertEqual(result.id, "s")
        self.assertTrue(bridge.shell_spawn.call_args.args[-1])

    async def test_list_validates_records(self):
        bridge = Mock()
        bridge.shell_list.return_value = [dict(id="s", label="preview", pid=10, status="running")]
        self.assertEqual((await ShellManager(bridge).list_shells())[0].id, "s")
        bridge.shell_list.return_value = [None]
        with self.assertRaises(TypeError):
            await ShellManager(bridge).list_shells()

    async def test_watcher_frames_split_and_batched_json_lines(self):
        event = {"tags": [{"kind": "path", "absolute": "/project/a.py"}]}
        line = json.dumps(event).encode()
        reader = Mock(spec=OutputReader)
        reader.get = AsyncMock(side_effect=[b"watchexec-ready\n" + line[:11],
                                           line[11:] + b"\n" + line + b"\n", RuntimeError("EOF")])
        reader.close = AsyncMock()
        with patch.object(watcher, "_forward_watchexec_event") as forward:
            await watcher._stdout_reader_loop(reader, "/project")
        self.assertEqual(forward.call_count, 2)
        forward.assert_called_with(event, "/project")
        reader.close.assert_awaited_once()

    async def test_watcher_oversized_line_fails_without_publication(self):
        reader = Mock(spec=OutputReader)
        reader.get = AsyncMock(return_value=b"x" * (watcher._MAX_EVENT_BYTES + 1))
        reader.close = AsyncMock()
        with patch.object(watcher, "_forward_watchexec_event") as forward:
            await watcher._stdout_reader_loop(reader, "/project")
        forward.assert_not_called()
        reader.close.assert_awaited_once()

    async def test_watcher_cancel_releases_reader(self):
        reader = Mock(spec=OutputReader)
        reader.get = AsyncMock(side_effect=asyncio.CancelledError)
        reader.close = AsyncMock()
        await watcher._stdout_reader_loop(reader, "/project")
        reader.close.assert_awaited_once()

    async def test_watcher_reuses_only_live_reader_then_replaces_on_project_change(self):
        record = ShellRecord("old", watcher._label("/old"), 123, "running", {}, [])
        manager = Mock()
        manager.get_shell = AsyncMock(return_value=record)
        manager.find_shell_by_label = AsyncMock(return_value=None)
        manager.terminate_shell = AsyncMock()
        reader = Mock(spec=OutputReader)
        reader.closed = False
        reader.close = AsyncMock()
        old_task = asyncio.create_task(asyncio.sleep(60))
        new_record = ShellRecord("new", watcher._label("/new"), 124, "running", {}, [])
        new_reader = Mock(spec=OutputReader)
        new_reader.closed = False
        new_reader.close = AsyncMock()
        manager.subscribe_output_bytes = AsyncMock(return_value=new_reader)
        with (patch.object(watcher, "get_manager", AsyncMock(return_value=manager)),
              patch.object(watcher, "is_watchexec_available", return_value=True),
              patch.object(watcher, "Orchestrator") as orchestrator,
              patch.object(watcher, "_stdout_reader_loop", AsyncMock()),
              patch.object(watcher, "_active_shell_id", "old"),
              patch.object(watcher, "_output_reader", reader),
              patch.object(watcher, "_stdout_reader_task", old_task)):
            orchestrator.return_value.start_from_ref = AsyncMock(return_value=new_record)
            self.assertIs(await watcher.ensure_watchexec_shell("/old"), record)
            orchestrator.return_value.start_from_ref.assert_not_awaited()
            self.assertIs(await watcher.ensure_watchexec_shell("/new"), new_record)
            manager.terminate_shell.assert_awaited_once_with("old", force=True)
            reader.close.assert_awaited_once()
            await watcher.stop_watchexec_shell()
            new_reader.close.assert_awaited_once()
