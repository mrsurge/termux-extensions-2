"""Native domain glue must not import a Python network server."""
import asyncio
import subprocess
import sys
from pathlib import Path

import pytest

from app.apps.code_te2.native_socketio import NativeNamespace, NativeSocketServer


def test_namespace_import_has_no_socketio_dependency():
    subprocess.run([sys.executable, "-c", "import sys; from app.apps.code_te2.native_socketio import NativeNamespace; assert 'socketio' not in sys.modules; assert 'engineio' not in sys.modules"], check=True)


def test_lane_modules_have_no_direct_python_socketio_import():
    import ast
    root = Path(__file__).resolve().parents[1] / "app/apps/code_te2"
    for name in ("monaco_editor/editor_rpc_socketio.py", "explorer/transport/rpc_socketio.py", "ui_ipc/ui_ipc_ws.py", "terminal_backend.py"):
        tree = ast.parse((root / name).read_text())
        for node in ast.walk(tree):
            modules = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            assert not any(module == "socketio" or module.startswith("socketio.") for module in modules), name


def test_dispatch_and_namespace_scoping():
    async def run():
        operations = []

        class Bridge:
            def socket_op(self, payload):
                operations.append(payload)

        class Handler(NativeNamespace):
            async def on_rpc(self, sid, data):
                return {"sid": sid, "data": data}

            async def on_disconnect(self, sid, reason=None):
                raise TypeError("handler failure must not retry")

            async def on_cancel(self):
                raise asyncio.CancelledError

        server = NativeSocketServer()
        server.attach(Bridge())
        first, second = Handler("/one"), Handler("/two")
        server.register_namespace(first)
        server.register_namespace(second)
        assert await first.trigger_event("rpc", "sid", {"x": 1}) == {"sid": "sid", "data": {"x": 1}}
        assert await first.trigger_event("unknown", "sid") is None
        assert await first.trigger_event("cancel") is None
        with pytest.raises(TypeError, match="must not retry"):
            await first.trigger_event("disconnect", "sid", "close")
        await first.save_session("sid", {"owner": 1})
        assert await second.get_session("sid") == {}
        assert await first.get_session("sid") == {"owner": 1}
        await first.enter_room("sid", "room")
        await first.emit("rpc", {"result": 1}, room="room", skip_sid="other")
        await first.leave_room("sid", "room")
        assert [entry["op"] for entry in operations] == ["join", "emit", "leave"]
        assert all(entry["namespace"] == "/one" for entry in operations)
        assert operations[1]["skipSid"] == "other"
        await first.emit("rpc", {"result": 2}, skip_sid=["one", "two"])
        assert operations[-1]["skipSid"] == ["one", "two"]

    asyncio.run(run())


def test_native_event_call_boundary_preserves_arity_and_failures() -> None:
    async def run() -> None:
        class Handler(NativeNamespace):
            calls: int = 0

            async def on_rpc(self, sid: str, data: object) -> object:
                self.calls += 1
                return data

            on_broken: int = 1

        handler = Handler("/test")
        assert await handler.trigger_event("rpc", "sid", {"value": 1}) == {"value": 1}
        with pytest.raises(TypeError):
            await handler.trigger_event("rpc", "sid")
        assert handler.calls == 1
        with pytest.raises(TypeError, match="not callable"):
            await handler.trigger_event("broken")

    asyncio.run(run())


def test_native_background_task_retains_callback_arguments_and_result() -> None:
    async def run() -> None:
        async def callback(number: int, *, label: str) -> str:
            return f"{label}:{number}"

        server = NativeSocketServer()
        task: asyncio.Task[str] = server.start_background_task(callback, 3, label="value")
        assert await task == "value:3"

    asyncio.run(run())
