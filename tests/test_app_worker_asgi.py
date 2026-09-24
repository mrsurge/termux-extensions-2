# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http.client import HTTPResponse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from types import ModuleType
from typing import cast
import unittest
from urllib.request import urlopen

from starlette.types import Scope, Receive, Send, Message
from app.libs.app_worker_asgi import WorkerASGI, explicit_asgi_application
from app.libs.app_worker_fastapi import build_fastapi_application
from app.libs.app_worker import _module_subapps, _subapp_lifespan_context
from app.libs.messagepack_stream import MessagePackStream
from app.libs.pipe_protocol import PipeEnvelope, decode_envelope, encode_frame

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/app_worker_package/native"


class WorkerASGIContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_export_is_validated_without_silent_fallback(self) -> None:
        module = ModuleType("fixture")
        self.assertIsNone(explicit_asgi_application(module, "fixture"))
        module.__dict__["TE2_ASGI_APP"] = None
        with self.assertRaisesRegex(RuntimeError, "not callable"):
            _ = explicit_asgi_application(module, "fixture")
        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive, send
        module.__dict__["TE2_ASGI_APP"] = app
        self.assertIs(explicit_asgi_application(module, "fixture"), app)
        for key, value in (("TE2_APP_ROUTER", None), ("SUBAPPS", [("/child", app)])):
            module.__dict__[key] = value
            with self.assertRaisesRegex(RuntimeError, "do not combine"):
                _ = explicit_asgi_application(module, "fixture")
            del module.__dict__[key]

    async def test_lifespan_order_and_same_task(self) -> None:
        events: list[str] = []
        task = asyncio.current_task()
        messages = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        async def receive() -> Message:
            return next(messages)
        async def send(message: Message) -> None:
            events.append(cast(str, message["type"]))
        @asynccontextmanager
        async def lifetime(app: object) -> AsyncIterator[None]:
            del app
            self.assertIs(asyncio.current_task(), task)
            events.append("worker.enter")
            try:
                yield
            finally:
                events.append("worker.exit")
        async def native(scope: Scope, receive: Receive, send: Send) -> None:
            del scope
            _ = await receive()
            events.append("native.start")
            await send({"type": "lifespan.startup.complete"})
            _ = await receive()
            events.append("native.stop")
            await send({"type": "lifespan.shutdown.complete"})
        app = WorkerASGI(native, lifespan=lifetime, loop_probe=lambda: {})
        await app({"type": "lifespan"}, receive, send)
        self.assertEqual(events, ["native.start", "worker.enter", "lifespan.startup.complete", "worker.exit", "native.stop", "lifespan.shutdown.complete"])

    async def test_native_startup_failure_does_not_bind_worker(self) -> None:
        @asynccontextmanager
        async def lifetime(app: object) -> AsyncIterator[None]:
            del app
            self.assertTrue(False, "worker entered after failed native startup")
            yield
        async def native(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive
            await send({"type": "lifespan.startup.failed", "message": "failed"})
        async def receive() -> Message:
            return {"type": "lifespan.startup"}
        messages: list[Message] = []
        async def send(message: Message) -> None:
            messages.append(message)
        await WorkerASGI(native, lifespan=lifetime, loop_probe=lambda: {})({"type": "lifespan"}, receive, send)
        self.assertEqual(messages, [{"type": "lifespan.startup.failed", "message": "failed"}])

    async def test_worker_startup_failure_is_not_reported_as_ready(self) -> None:
        @asynccontextmanager
        async def lifetime(app: object) -> AsyncIterator[None]:
            if app is not None:
                raise RuntimeError("worker setup failed")
            yield
        async def native(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive
            await send({"type": "lifespan.startup.complete"})
        async def receive() -> Message:
            return {"type": "lifespan.startup"}
        messages: list[Message] = []
        async def send(message: Message) -> None:
            messages.append(message)
        with self.assertRaisesRegex(RuntimeError, "worker setup failed"):
            await WorkerASGI(native, lifespan=lifetime, loop_probe=lambda: {})({"type": "lifespan"}, receive, send)
        self.assertEqual(messages, [{"type": "lifespan.startup.failed", "message": "worker setup failed"}])

    async def test_cancellation_drains_worker_context(self) -> None:
        entered = asyncio.Event()
        exited = asyncio.Event()
        @asynccontextmanager
        async def lifetime(app: object) -> AsyncIterator[None]:
            del app
            entered.set()
            try:
                yield
            finally:
                exited.set()
        async def native(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive
            await send({"type": "lifespan.startup.complete"})
            await asyncio.Future[None]()
        async def receive() -> Message:
            return {"type": "lifespan.startup"}
        async def send(message: Message) -> None:
            del message
        app = WorkerASGI(native, lifespan=lifetime, loop_probe=lambda: {})
        task = asyncio.create_task(app({"type": "lifespan"}, receive, send))
        _ = await entered.wait()
        _ = task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(exited.is_set())

    async def test_http_and_websocket_are_delegated_unchanged(self) -> None:
        received: list[Scope] = []
        @asynccontextmanager
        async def lifetime(app: object) -> AsyncIterator[None]:
            del app
            self.assertTrue(False, "HTTP must not start lifecycle")
            yield
        async def receive() -> Message:
            return {"type": "websocket.connect"}
        async def send(message: Message) -> None:
            del message
        async def native(scope: Scope, incoming: Receive, outgoing: Send) -> None:
            received.append(scope)
            self.assertIs(incoming, receive)
            self.assertIs(outgoing, send)
        app = WorkerASGI(native, lifespan=lifetime, loop_probe=lambda: {})
        for kind in ("http", "websocket"):
            scope: Scope = {"type": kind, "path": "/socket.io/", "root_path": "/prefix"}
            await app(scope, receive, send)
            self.assertIs(received[-1], scope)

    async def test_legacy_mounted_lifespan_is_entered_once(self) -> None:
        from fastapi import APIRouter, FastAPI
        events: list[str] = []
        @asynccontextmanager
        async def child_lifetime(app: object) -> AsyncIterator[None]:
            del app
            events.append("child.start")
            try:
                yield
            finally:
                events.append("child.stop")
        child = FastAPI(lifespan=child_lifetime)
        @asynccontextmanager
        async def worker_lifetime(app: object) -> AsyncIterator[None]:
            del app
            context = _subapp_lifespan_context(child)
            assert context is not None
            async with context(child):
                events.append("worker.ready")
                yield
                events.append("worker.stop")
        module = ModuleType("fixture")
        module.__dict__["TE2_APP_ROUTER"] = APIRouter()
        # Exercise real worker mount discovery, not only compatibility assembly.
        module.__dict__["SUBAPPS"] = [("/child", child)]
        subapps = _module_subapps(module)
        self.assertEqual(subapps, [("/child", child)])
        app = build_fastapi_application(module, "fixture", lifespan=worker_lifetime, subapps=subapps, loop_probe=lambda: {})
        pending = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        async def receive() -> Message:
            return next(pending)
        async def send(message: Message) -> None:
            del message
        await app({"type": "lifespan", "state": {}}, receive, send)
        self.assertEqual(events, ["child.start", "worker.ready", "worker.stop", "child.stop"])


class WorkerASGISubprocessTests(unittest.TestCase):
    def test_native_worker_without_fastapi_pydantic(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-native-worker-") as scratch:
            events = Path(scratch) / "events"
            env = os.environ.copy()
            env["TE2_TEST_NATIVE_EVENTS"] = str(events)
            env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
            _ = env.pop("TE2_TEST_BLOCK_ALL_WEB", None)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = cast(tuple[str, int], listener.getsockname())[1]
            # The serving hook must run only after Uvicorn has bound a listener
            # that can accept a real request; no fixed startup sleep may decide it.
            env["TE2_TEST_NATIVE_SERVING_PROBE_URL"] = f"http://127.0.0.1:{port}/listener-ready"
            with (Path(scratch) / "stderr").open("wb") as errors:
                process = subprocess.Popen([
                    sys.executable, "-m", "tests.fixtures.app_worker_import_guard",
                    "--app-id", "native", "--port", str(port),
                    "--backend-module", str(FIXTURE / "main.py"),
                ], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=errors)
                try:
                    deadline = time.monotonic() + 12
                    payload: object = None
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            self.fail((Path(scratch) / "stderr").read_text())
                        try:
                            with cast(HTTPResponse, urlopen(f"http://127.0.0.1:{port}/identity", timeout=0.3)) as response:
                                payload = cast(object, json.loads(response.read()))
                            if events.exists() and "worker.serving" in events.read_text():
                                break
                        except OSError:
                            pass
                        time.sleep(0.05)
                    self.assertEqual(payload, {"path": "/identity", "blocked_imports_absent": True})
                    self.assertIn("worker.serving", events.read_text())
                    with cast(HTTPResponse, urlopen(f"http://127.0.0.1:{port}/__te2/runtime/loop", timeout=1)) as response:
                        probe = cast(dict[str, object], json.loads(response.read()))
                    self.assertEqual(probe["ok"], True)
                finally:
                    process.terminate()
                    try:
                        _ = process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        _ = process.wait(timeout=3)
            self.assertEqual(events.read_text().splitlines(), ["worker.start", "asgi.start", "worker.serving", "asgi.stop", "worker.stop"])

    def test_pipe_only_worker_imports_no_web_stack(self) -> None:
        env = os.environ.copy()
        env["TE2_TEST_BLOCK_ALL_WEB"] = "1"
        request = PipeEnvelope(kind="request", id="test", method="test.echo", origin_nid=1)
        result = subprocess.run([
            sys.executable, "-m", "tests.fixtures.app_worker_import_guard",
            "--app-id", "native", "--pipe", "--backend-module", str(FIXTURE / "pipe.py"),
        ], input=encode_frame(request), capture_output=True, cwd=ROOT, env=env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        values = list(MessagePackStream().feed(result.stdout))
        self.assertEqual(len(values), 1)
        response = decode_envelope(values[0])
        self.assertEqual(response.result, {"method": "test.echo", "web_imports_absent": True})
