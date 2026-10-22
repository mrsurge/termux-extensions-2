"""Isolated real-owner dispatch parity; never starts the domain or a socket."""
from __future__ import annotations

from collections.abc import Callable
import threading
from unittest.mock import patch


def run(deliver_native: Callable[[object, bytes], None] | None = None) -> dict[str, object]:
    import msgspec
    from app.apps.code_te2 import native_worker as worker
    from app.libs import pipe_runtime
    from app.libs.pipe_codec import decode_envelope, decode_envelope_bytes
    from app.libs.pipe_dto import PipeEnvelope, PipeIdentity, PipeProtocolError
    from app.libs.pipe_inbound import InboundEnvelopeRouter

    values: list[object] = [
        {"kind": "response", "id": "fs", "result": {"hits": [{"path": "λ.py", "line": 4}], "binary": b"\x00\xff"}},
        {"kind": "progress", "method": "search.progress", "params": {"done": 4}},
        {"kind": "notification", "method": "git.changed", "params": {"staged": True}},
        {"kind": "error", "id": "failed", "error": {"code": "test", "message": "🙂", "details": None}},
        {"kind": "request", "id": "debug", "method": "runtime.debug.status"},
        {"kind": "request", "id": "intent", "method": "app.rpc.deliver"},
        {"kind": "request", "id": "ordinary", "method": "test"},
        {"kind": "unknown"},
    ]
    invalid: list[object] = [None, [], {"kind": None}, {"kind": 1}, {"originNid": True},
        {"targetNid": "1"}, {"error": {"code": 1, "message": "x"}},
        {"error": {}}, {"protocolVersion": 2}, {"jsonrpc": "wrong"},
        {"kind": "request"}]
    metadata_values: tuple[object, ...] = (None, True, -9223372036854775808, 18446744073709551615,
                                         "λ", b"\x00\xff", [], {}, 1.25)
    metadata_cases: list[object] = [
        {field: value}
        for field in ("jsonrpc", "protocolVersion", "kind", "id", "method", "originNid", "originName",
                      "targetNid", "targetName", "projectGeneration", "workspaceRoot", "correlationId",
                      "opId", "sequence", "params", "result", "error", "reason")
        for value in metadata_values
    ]
    for value in [*values, *invalid, *metadata_cases]:
        frame = msgspec.msgpack.encode(value)
        try:
            left: object = decode_envelope(value)
        except PipeProtocolError as error:
            left = str(error)
        try:
            right: object = decode_envelope_bytes(frame)
        except PipeProtocolError as error:
            right = str(error)
        assert left == right, (value, left, right)

    thread = threading.get_ident()
    def capture(use_bytes: bool) -> list[tuple[str, object]]:
        events: list[tuple[str, object]] = []
        def record(kind: str, envelope: PipeEnvelope) -> bool:
            assert threading.get_ident() == thread
            events.append((kind, envelope))
            return True
        class Admission:
            def __init__(self, method: str, label: str) -> None:
                self.method, self.label = method, label
            def submit(self, envelope: PipeEnvelope) -> bool:
                return record(self.label, envelope) if envelope.method == self.method else False
        def dispatch(envelope: PipeEnvelope) -> PipeEnvelope:
            record("dispatch", envelope)
            return PipeEnvelope(kind="response", id=envelope.id)
        def reply(envelope: PipeEnvelope) -> None:
            record("reply", envelope)
        router = InboundEnvelopeRouter(identity=PipeIdentity(2100, "service.app"),
            accept_response=lambda e: record("response", e),
            accept_notification=lambda e: record("notification", e),
            dispatch=dispatch, reply=reply,
            report=lambda text: events.append(("report", text)),
            debug=Admission("runtime.debug.status", "debug"),
            production=Admission("app.rpc.deliver", "production"))
        # Insert invalid schemas between valid frames to prove recovery/order.
        ordered = [*values[:2], *invalid, *values[2:]]
        with patch.object(worker, "_router", router), patch.object(pipe_runtime, "write_envelope", reply):
            if use_bytes and deliver_native is not None:
                deliver_native(worker, b"".join(msgspec.msgpack.encode(v) for v in ordered))
            else:
                for value in ordered:
                    if use_bytes:
                        worker.control_bytes(msgspec.msgpack.encode(value))
                    else:
                        worker.control(value)
        return events
    baseline, candidate = capture(False), capture(True)
    assert baseline == candidate, (baseline, candidate)
    assert [kind for kind, _ in candidate].count("dispatch") == 1

    if deliver_native is not None:
        # Corruption/truncation must stop before a following valid request.
        for corrupt in (b"\xc1", b"\x81", b"\xa1\xff", b"\xd4\x00\x00"):
            with patch.object(worker, "control_bytes") as control:
                try:
                    deliver_native(worker, corrupt)
                except ValueError:
                    pass
                else:
                    raise AssertionError("corrupt native frame accepted")
                control.assert_not_called()
        with patch.object(worker, "control_bytes", side_effect=RuntimeError("dispatch failed")) as control:
            try:
                deliver_native(worker, b"\x80\x80")
            except ValueError:
                pass
            else:
                raise AssertionError("dispatch failure swallowed")
            assert control.call_count == 1
    return {"module": worker.__file__, "schema_cases": len(values) + len(invalid) + len(metadata_cases),
            "dispatch_events": len(candidate), "native_delivery": deliver_native is not None}
