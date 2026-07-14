import asyncio
import struct
import unittest

import msgspec

from app.apps.terminal.terminal_stream_protocol import (
    PipeFrameDecoder,
    encode_pipe_message,
    pack_message,
    unpack_message,
)
from app.apps.terminal import backend


class _Subscription:
    async def get(self) -> bytes | None:
        return None


class _Stdin:
    def __init__(self) -> None:
        self.data = bytearray()

    def is_closing(self) -> bool:
        return False

    def write(self, data: bytes) -> None:
        self.data.extend(data)

    async def drain(self) -> None:
        return None


class _Process:
    def __init__(self, stdin: _Stdin) -> None:
        self.stdin = stdin


class _PipeState:
    stdin_supported = True

    def __init__(self, stdin: _Stdin) -> None:
        self.process = _Process(stdin)


class _Manager:
    def __init__(self, stdin: _Stdin) -> None:
        self.state = _PipeState(stdin)

    def get_pipe_state(self, _shell_id: str) -> _PipeState:
        return self.state


class TerminalStreamProtocolTests(unittest.TestCase):
    def test_fragmented_frame_preserves_binary_data(self) -> None:
        expected = {
            "type": "output",
            "sequence": 17,
            "data": bytes([0, 10, 27, 128, 255]),
        }
        frame = encode_pipe_message(expected)
        decoder = PipeFrameDecoder()
        decoded: list[dict[str, object]] = []
        for byte in frame:
            decoded.extend(decoder.push(bytes([byte])))
        self.assertEqual(decoded, [expected])

    def test_coalesced_frames_are_separated(self) -> None:
        decoder = PipeFrameDecoder()
        first = {"type": "ping", "request_id": "one"}
        second = {"type": "resize", "cols": 120, "rows": 40}
        decoded = decoder.push(encode_pipe_message(first) + encode_pipe_message(second))
        self.assertEqual(decoded, [first, second])

    def test_invalid_lengths_and_non_objects_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid terminal pipe frame length"):
            PipeFrameDecoder().push(struct.pack(">I", 0))
        scalar = msgspec.msgpack.encode(True)
        with self.assertRaisesRegex(ValueError, "must be an object"):
            unpack_message(scalar)

    def test_websocket_payload_has_no_length_prefix(self) -> None:
        expected = {"type": "input", "data": b"printf 'ok'\\r"}
        payload = pack_message(expected)
        self.assertEqual(unpack_message(payload), expected)


class TerminalSessionOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def test_checkpoint_precedes_only_newer_buffered_output(self) -> None:
        session = backend.TerminalSession(
            shell_id="shell-1",
            output_subscription=_Subscription(),
        )
        connection = backend.TerminalConnection(queue=asyncio.Queue())
        connection.attach_request_id = "attach-1"
        connection.buffered_frames.extend(
            [
                {"type": "output", "sequence": 4, "data": b"old"},
                {"type": "output", "sequence": 6, "data": b"new"},
            ]
        )
        session.connections["connection-1"] = connection
        session.pending_attach["attach-1"] = "connection-1"

        await backend._route_checkpoint(
            session,
            {
                "type": "checkpoint",
                "request_id": "attach-1",
                "sequence": 5,
                "cols": 80,
                "rows": 24,
                "scrollback": 5000,
                "state": b"checkpoint",
            },
        )

        checkpoint = connection.queue.get_nowait()
        output = connection.queue.get_nowait()
        self.assertEqual(checkpoint["type"], "checkpoint")
        self.assertEqual(checkpoint["shell_id"], "shell-1")
        self.assertEqual(output, {"type": "output", "sequence": 6, "data": b"new"})
        self.assertEqual(connection.state, "live")
        self.assertTrue(connection.queue.empty())

    async def test_pipe_writer_sends_length_prefixed_binary_msgpack(self) -> None:
        stdin = _Stdin()
        manager = _Manager(stdin)

        async def manager_factory() -> _Manager:
            return manager

        original_factory = backend.manager_factory
        backend.manager_factory = manager_factory
        try:
            session = backend.TerminalSession(
                shell_id="shell-1",
                output_subscription=_Subscription(),
            )
            expected = {"type": "input", "data": bytes([0, 10, 27, 255])}
            await backend._write_pipe_message(session, expected)
        finally:
            backend.manager_factory = original_factory

        decoded = PipeFrameDecoder().push(stdin.data)
        self.assertEqual(decoded, [expected])


if __name__ == "__main__":
    unittest.main()
