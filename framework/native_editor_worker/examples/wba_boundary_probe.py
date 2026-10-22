"""Actual WBA native-stream/domain-consumer parity under isolated probe roots."""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from typing import Protocol
from unittest.mock import patch

import msgspec

from app.apps.code_te2 import wba_pipe_codec as codec


class ProbeStream(codec.NativeWbaStream, Protocol):
    def feed(self, data: bytes) -> Iterable[object]: ...


class Bridge:
    def __init__(self, factory: Callable[[], ProbeStream]) -> None:
        self.factory = factory

    def wba_stream(self) -> ProbeStream:
        return self.factory()

    def wba_encode(self, value: object) -> bytes:
        raise AssertionError("inbound probe must not encode outbound messages")


def wrap(stream: ProbeStream) -> codec.WbaStream:
    with patch.object(codec, "_native", Bridge(lambda: stream)):
        return codec.new_stream()


def fixture(name: str) -> bytes:
    payload: object
    kind = "push"
    if name == "ready":
        payload = {"event": "te2.event", "params": {"type": "adapter/ready", "ready": True}}
    elif name == "diagnostics_256":
        payload = {"event": "te2.event", "params": {"type": "diagnostics/update", "items": [
            {"uri": f"file:///workspace/file_{i}.py", "markers": [{"message": "λ🙂 diagnostic", "severity": 8, "startLineNumber": i + 1}]}
            for i in range(256)]}}
    elif name == "reply_512":
        kind = "reply"
        payload = {"jsonrpc": "2.0", "id": 7, "result": [
            {"uri": f"file:///workspace/file_{i}.py", "range": {"start": {"line": i, "character": 1}, "end": {"line": i, "character": 8}}}
            for i in range(512)]}
    elif name == "binary_256k":
        kind = "reply"
        payload = {"id": 8, "result": {"text": "λ🙂\n" * 4096, "bytes": bytes(range(256)) * 1024}}
    else:
        raise ValueError(name)
    return msgspec.msgpack.encode({"kind": kind, "payload": payload})


def check(factory: Callable[[], ProbeStream]) -> dict[str, object]:
    for name in ("ready", "diagnostics_256", "reply_512", "binary_256k"):
        data = fixture(name)
        for chunk_size in ((1, 7, len(data)) if name == "ready" else (4096, 65_536, len(data))):
            graph, buffered = factory(), wrap(factory())
            left: list[object] = []
            right: list[object] = []
            for offset in range(0, len(data), chunk_size):
                chunk = data[offset:offset + chunk_size]
                left.extend(graph.feed(chunk))
                right.extend(buffered.feed(chunk))
            graph.finish()
            buffered.finish()
            assert left == right, (name, chunk_size)
    # Scalar/non-map records remain for the existing domain to reject; do not
    # silently narrow/expand the codec schema as part of changing representation.
    records: list[object] = [None, 7, True, -9223372036854775808, 18446744073709551615,
                             "λ", b"\x00\xff", [1, False], {"nested": {"x": None}}]
    wire = b"".join(msgspec.msgpack.encode(record) for record in records)
    assert list(factory().feed(wire)) == list(wrap(factory()).feed(wire)) == records
    for data in (b"\xc1", b"\x81", b"\xa1\xff", b"\xd4\x00\x00"):
        errors: list[str] = []
        for stream in (factory(), wrap(factory())):
            try:
                list(stream.feed(data))
                stream.finish()
            except RuntimeError as error:
                errors.append(str(error))
        assert len(errors) == 2 and errors[0] == errors[1], errors
    consumer_module = asyncio.run(check_consumer(factory))
    return {"fixtures": 4, "scalar_cases": len(records), "rejected": 4,
            "consumer": "startup/reply/push order and metrics-disabled no re-encode pass",
            "codec_module": codec.__file__, "consumer_module": consumer_module}


async def check_consumer(factory: Callable[[], ProbeStream]) -> str:
    from app.apps.code_te2 import workbench_adapter_shell_manager as manager
    queue: asyncio.Queue[bytes] = asyncio.Queue()
    reply: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
    pushes: list[dict[str, object]] = []
    done = asyncio.Event()
    def receive(obj: dict[str, object], *, payload_bytes: int) -> None:
        assert payload_bytes == 0
        pushes.append(obj)
        if len(pushes) == 2:
            done.set()
    with (patch.object(codec, "_native", Bridge(factory)),
          patch.dict(manager._rpc_pending, {7: reply}, clear=True),
          patch.object(manager, "diagnostics_latency_metrics_enabled", return_value=False),
          patch.object(manager, "_queue_push", receive)):
        task = asyncio.create_task(manager._stdout_reader_loop("isolated-probe", queue))
        try:
            records: list[object] = [
                {"kind": "startup", "payload": {"type": "adapter/start"}},
                {"kind": "push", "payload": {"event": "first", "value": "λ🙂"}},
                {"kind": "reply", "payload": {"id": 7, "result": {"ok": True}}},
                {"kind": "push", "payload": {"event": "second", "binary": b"\x00\xff"}}]
            wire = b"".join(msgspec.msgpack.encode(record) for record in records)
            for offset in range(0, len(wire), 7):
                queue.put_nowait(wire[offset:offset + 7])
            assert await asyncio.wait_for(reply, 2) == {"id": 7, "result": {"ok": True}}
            await asyncio.wait_for(done.wait(), 2)
            assert [push["event"] for push in pushes] == ["first", "second"]
        finally:
            task.cancel()
            await task
    return str(manager.__file__)
