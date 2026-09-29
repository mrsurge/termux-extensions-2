from __future__ import annotations

import io
import threading
from types import ModuleType

import pytest

from app.libs.pipe_inbound import InboundEnvelopeRouter
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity, encode_frame
from app.libs.runtime_debug_pipe import RuntimeDebugPipe


def test_delivery_routes_without_changing_order_or_thread():
    events = []
    caller = threading.get_ident()

    def dispatch(envelope):
        assert threading.get_ident() == caller
        events.append(("dispatch", envelope.id))
        return PipeEnvelope(kind="response", id=envelope.id)

    class Debug:
        def submit(self, envelope):
            events.append(("debug", envelope.id))
            return envelope.method == "runtime.debug.status"

    router = InboundEnvelopeRouter(
        identity=PipeIdentity(2100, "test"),
        accept_response=lambda e: events.append(("response", e.id)) or True,
        accept_notification=lambda e: events.append(("notification", e.id)) or True,
        dispatch=dispatch, reply=lambda e: events.append(("reply", e.id)),
        report=lambda text: pytest.fail(text), debug=Debug(),
    )
    for kind, method in [("response", None), ("error", None), ("notification", None),
                         ("progress", None), ("request", "runtime.debug.status"), ("request", "app")]:
        router.deliver(PipeEnvelope(kind=kind, id=kind + str(method), method=method))
    assert [event[0] for event in events] == [
        "response", "response", "notification", "notification", "debug", "debug", "dispatch", "reply",
    ]


def test_unhandled_records_and_disabled_debug_never_dispatch():
    replies = []
    reports = []
    identity = PipeIdentity(2100, "test")
    debug = RuntimeDebugPipe(enabled=False, identity=identity, reply=replies.append)
    router = InboundEnvelopeRouter(
        identity=identity, accept_response=lambda e: False, accept_notification=lambda e: False,
        dispatch=lambda e: pytest.fail("unexpected dispatch"), reply=replies.append,
        report=reports.append, debug=debug,
    )
    router.deliver(PipeEnvelope(kind="response", id="late"))
    router.deliver(PipeEnvelope(kind="notification", method="missing"))
    router.deliver(PipeEnvelope(kind="unknown"))
    router.deliver(PipeEnvelope(kind="request", id="debug", method="runtime.debug.status"))
    assert "Unmatched pipe response" in reports[0]
    assert "Unhandled pipe notification" in reports[1]
    assert [reply.error.code for reply in replies] == ["protocol.expectedRequest", "runtimeDebug.disabled"]


@pytest.mark.parametrize("tail", [b"", b"\xc1", b"\x81"])
def test_worker_reader_preserves_invalid_envelope_recovery_and_stream_close(monkeypatch, tail):
    from app.libs import app_worker, pipe_runtime
    from app.libs.messagepack_stream import MessagePackStream, encode_message

    module = ModuleType("test_backend")
    module.te2_pipe_dispatch = lambda e: {"ok": True}
    monkeypatch.setattr(pipe_runtime, "_dispatcher", module.te2_pipe_dispatch)
    monkeypatch.setattr(pipe_runtime, "_identity", PipeIdentity(2100, "service.app"))
    monkeypatch.setattr(pipe_runtime, "_transport", None)
    monkeypatch.setattr(pipe_runtime, "_pending", {})
    request = PipeEnvelope(kind="request", id="valid", method="test")
    reader = io.BytesIO(encode_message({"jsonrpc": "wrong"}) + encode_frame(request) + tail)
    monkeypatch.setattr(app_worker.sys, "stdin", reader)
    writer = io.BytesIO()
    closed = []

    class Debug:
        def submit(self, envelope):
            return False

        def close(self):
            closed.append(True)

    app_worker._run_pipe_worker("test", module, writer, Debug())
    stream = MessagePackStream()
    replies = list(stream.feed(writer.getvalue()))
    stream.finish()
    assert replies[0]["error"]["code"] == "protocol.invalidFrame"
    assert replies[1]["id"] == "valid"
    assert replies[1]["result"] == {"ok": True}
    assert len(replies) == 2
    assert closed == [True]
    assert pipe_runtime._transport is None
