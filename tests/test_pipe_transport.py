from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import io
import queue
import threading

import pytest

from app.libs import pipe_runtime as runtime
from app.libs.messagepack_stream import MessagePackStream
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity, decode_envelope, encode_frame


@pytest.fixture(autouse=True)
def isolated_runtime(monkeypatch):
    monkeypatch.setattr(runtime, "_transport", None)
    monkeypatch.setattr(runtime, "_pending", {})
    monkeypatch.setattr(runtime, "_notification_listeners", [])
    monkeypatch.setattr(runtime, "_identity", PipeIdentity(2100, "test"))
    monkeypatch.setattr(runtime, "_dispatcher", lambda envelope: {"ok": True})
    yield
    runtime.close_transport("test cleanup")


def test_stdio_bytes_and_callback_order():
    events = []

    class Writer(io.BytesIO):
        def write(self, data):
            events.append("write")
            return super().write(data)

        def flush(self):
            events.append("flush")

    writer = Writer()
    runtime.configure_stdio_transport(writer)
    envelope = PipeEnvelope(kind="notification", params={"bytes": b"\x00\xff\n"})
    runtime.write_envelope(envelope, lambda: events.append("before"))
    assert events == ["before", "write", "flush"]
    assert writer.getvalue() == encode_frame(envelope)


def test_alternate_transport_preserves_correlation_and_duplicate_handling():
    class Transport:
        def write(self, envelope, before_write=None):
            if before_write:
                before_write()
            assert envelope.workspace_root == "/project"
            assert envelope.project_generation == 3
            assert envelope.correlation_id == "corr"
            reply = PipeEnvelope(kind="response", id=envelope.id, result={"ok": True})
            assert runtime.accept_response(reply)
            assert not runtime.accept_response(reply)

    runtime.configure_transport(Transport())
    assert runtime.call("test", workspace_root="/project", project_generation=3,
                        correlation_id="corr") == {"ok": True}
    assert not runtime._pending
    assert not runtime.accept_response(PipeEnvelope(kind="response", id="late"))


def test_timeout_write_failure_and_close_release_waiters():
    class Transport:
        def write(self, envelope, before_write=None):
            pass

    runtime.configure_transport(Transport())
    with pytest.raises(runtime.PipeRuntimeError) as error:
        runtime.call("test", timeout_seconds=0.001)
    assert error.value.code == "pipe.responseTimeout"
    assert not runtime._pending

    class Broken:
        def write(self, envelope, before_write=None):
            raise OSError("broken")

    runtime.configure_transport(Broken())
    with pytest.raises(runtime.PipeRuntimeError) as error:
        runtime.call("test")
    assert error.value.code == "pipe.transportWriteFailed"
    assert not runtime._pending

    class Closed:
        def write(self, envelope, before_write=None):
            runtime.close_transport("EOF")

    runtime.configure_transport(Closed())
    with pytest.raises(runtime.PipeRuntimeError) as error:
        runtime.call("test")
    assert error.value.code == "pipe.transportClosed"
    with pytest.raises(runtime.PipeRuntimeError) as error:
        runtime.write_envelope(PipeEnvelope(kind="notification"))
    assert error.value.code == "pipe.transportNotConfigured"


def test_concurrent_writes_keep_whole_frames():
    writer = io.BytesIO()
    runtime.configure_stdio_transport(writer)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda i: runtime.write_envelope(PipeEnvelope(kind="notification", id=str(i))), range(80)))
    stream = MessagePackStream()
    envelopes = [decode_envelope(value) for value in stream.feed(writer.getvalue())]
    stream.finish()
    assert {e.id for e in envelopes} == {str(i) for i in range(80)}
    assert len(envelopes) == 80


def test_notification_and_dispatch_stay_runtime_owned():
    events = queue.Queue(maxsize=1)
    listener = runtime.add_notification_listener(events, methods={"changed"})
    event = PipeEnvelope(kind="notification", method="changed")
    assert runtime.accept_notification(event)
    assert not runtime.accept_notification(event)  # Full must not block reader.
    assert events.get_nowait() == event
    runtime.remove_notification_listener(listener)
    assert not runtime.accept_notification(event)
    request = PipeEnvelope(kind="request", id="1", method="test", target_name="wrong")
    reply = runtime.dispatch_request(request)
    assert reply.error.code == "protocol.wrongTarget"
    request.target_name = "test"
    assert runtime.dispatch_request(request).result == {"ok": True}


def test_cancel_async_caller_does_not_replay_or_undo_sent_request():
    sent = threading.Event()
    requests = []

    class Transport:
        def write(self, envelope, before_write=None):
            requests.append(envelope)
            sent.set()

    runtime.configure_transport(Transport())

    async def run():
        task = asyncio.create_task(runtime.call_async("mutation", timeout_seconds=2))
        assert await asyncio.to_thread(sent.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # The synchronous request remains live until its response/close/timeout.
        assert len(requests) == 1
        assert runtime.accept_response(PipeEnvelope(kind="response", id=requests[0].id, result=True))

    asyncio.run(run())  # drains executor, including the cancelled caller's thread
    assert not runtime._pending
    assert len(requests) == 1
