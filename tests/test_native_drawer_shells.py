from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
import asyncio
import threading

from app.apps.code_te2 import native_shells, terminal_shell, terminal_log_io


def test_drawer_uses_native_manager_and_keeps_project_grouping():
    async def run():
        manager = Mock()
        manager.find_shell_by_label = AsyncMock(return_value=None)
        record = native_shells.ShellRecord("s", "terminal", 42, "running", {}, [])
        manager.spawn_terminal = AsyncMock(return_value=record)
        manager.describe = AsyncMock(return_value={"id": "s"})
        with patch.object(native_shells, "get_manager", AsyncMock(return_value=manager)):
            assert await terminal_shell.create_editor_shell(cwd="/project", project_path="/project", sequence=2) == {"id": "s"}
        args = manager.spawn_terminal.call_args
        assert args.args[0].name == "terminal.yaml"
        assert args.kwargs["label"].endswith(":2")
        assert args.kwargs["subgroups"][0] == "code_te2"
    asyncio.run(run())


def test_cancelled_native_terminal_spawn_removes_exact_child():
    async def run():
        started, release = threading.Event(), threading.Event()
        bridge = Mock()
        def spawn(*_):
            started.set()
            assert release.wait(3)
            return dict(id="owned", label="code-editor-terminal", pid=42, status="running")
        bridge.shell_spawn_terminal.side_effect = spawn
        bridge.shell_remove.return_value = True
        manager = native_shells.ShellManager(bridge)
        task = asyncio.create_task(manager.spawn_terminal(Path("terminal.yaml"), "terminal", {}, "code-editor-terminal", []))
        assert await asyncio.to_thread(started.wait, 3)
        task.cancel()
        release.set()
        try:
            await task
            assert False, "cancel must propagate"
        except asyncio.CancelledError:
            pass
        bridge.shell_remove.assert_called_once_with("owned")
    asyncio.run(run())


def test_native_log_reader_closes_on_consumer_failure(tmp_path):
    bridge, reader = Mock(), Mock()
    bridge.terminal_log_open.return_value = reader
    with patch.object(terminal_log_io, "_native", bridge):
        try:
            with terminal_log_io.open_log(tmp_path / "log") as opened:
                assert opened is reader
                raise ValueError("parser failure")
        except ValueError:
            pass
    reader.close.assert_called_once()


def test_native_log_failure_never_falls_back(tmp_path):
    bridge = Mock()
    bridge.terminal_log_open.side_effect = OSError("native failure")
    with patch.object(terminal_log_io, "_native", bridge), patch.object(terminal_log_io, "_ReferenceReader") as reference:
        try:
            with terminal_log_io.open_log(tmp_path / "log"):
                assert False
        except OSError:
            pass
        reference.assert_not_called()


def test_log_projection_keeps_split_utf8_offsets_and_replacement_reset(tmp_path):
    from app.apps.code_te2.terminal_screen_projection import TerminalScreenProjectionRegistry
    path = tmp_path / "raw.log"
    path.write_bytes(b"\xe2")
    async def run():
        registry = TerminalScreenProjectionRegistry()
        first = await registry.checkpoint("s", path)
        assert first.output_offset == 1 and first.pending_bytes == b"\xe2"
        with path.open("ab") as output:
            output.write(b"\x82\xac")
        growth = await registry.consume_growth("s")
        assert not growth.reset
        assert [(delta.start_offset, delta.end_offset, delta.data) for delta in growth.deltas] == [(1, 3, b"\x82\xac")]
        assert "€" in (await registry.checkpoint("s", path)).ansi
        path.rename(tmp_path / "old.log")
        path.write_bytes(b"replacement")
        growth = await registry.consume_growth("s")
        assert growth.reset and not growth.deltas
        checkpoint = await registry.checkpoint("s", path)
        assert "replacement" in checkpoint.ansi and "€" not in checkpoint.ansi
        assert checkpoint.output_offset == len(b"replacement")
    asyncio.run(run())
