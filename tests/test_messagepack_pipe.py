# pyright: strict
from __future__ import annotations

import unittest
from pathlib import Path
import queue
from unittest.mock import patch

from app.libs import pipe_runtime
from app.libs.messagepack_stream import MessagePackStream, encode_message
from app.libs.pipe_protocol import PipeEnvelope, decode_envelope, encode_frame


class MessagePackPipeTests(unittest.TestCase):
    def test_transport_close_releases_pending_calls(self) -> None:
        waiter: queue.Queue[PipeEnvelope] = queue.Queue(maxsize=1)
        with patch.object(pipe_runtime, "_pending", {"request": waiter}), patch.object(pipe_runtime, "_transport_writer", None):
            pipe_runtime.close_stdio_transport("stream failed")
            response = waiter.get_nowait()
            self.assertEqual(response.id, "request")
            assert response.error is not None
            self.assertEqual(response.error.code, "pipe.transportClosed")
            with self.assertRaises(pipe_runtime.PipeRuntimeError):
                pipe_runtime.write_envelope(PipeEnvelope(kind="notification"))

    def test_cross_language_fixture(self) -> None:
        raw = bytes.fromhex((Path(__file__).parent / "fixtures/framework_pipe_request.msgpack.hex").read_text())
        decoder = MessagePackStream()
        envelope = decode_envelope(list(decoder.feed(raw))[0])
        self.assertEqual(envelope.id, "cross-language")
        self.assertEqual(envelope.params, {"path": "line\nbreak", "hidden": False})
        decoder.finish()

    def test_large_frame_preserves_transport_budget(self) -> None:
        raw = encode_message({"text": "x" * (2 * 1024 * 1024)})
        decoder = MessagePackStream()
        found: list[object] = []
        for offset in range(0, len(raw), 65536):
            found.extend(decoder.feed(raw[offset:offset + 65536]))
        decoder.finish()
        self.assertEqual(len(found), 1)

    def test_fragments_coalescing_and_binary_newlines(self) -> None:
        values: list[object] = [{"text": "a\nb", "bytes": b"\x00\n\xff"}, {"id": 2}]
        encoded = b"".join(encode_message(value) for value in values)
        for size in (1, 3, len(encoded)):
            decoder = MessagePackStream()
            found: list[object] = []
            for offset in range(0, len(encoded), size):
                found.extend(decoder.feed(encoded[offset:offset + size]))
            decoder.finish()
            self.assertEqual(found, values)

    def test_truncation_corruption_and_limits(self) -> None:
        decoder = MessagePackStream()
        _ = list(decoder.feed(encode_message({"value": "hello"})[:-1]))
        with self.assertRaisesRegex(ValueError, "Truncated"):
            decoder.finish()
        with self.assertRaises(Exception):
            _ = list(MessagePackStream().feed(b"\xc1"))
        with self.assertRaises(Exception):
            _ = list(MessagePackStream(limit=16).feed(encode_message({"value": "x" * 80})))

    def test_envelope_preserves_identity_and_correlation(self) -> None:
        envelope = PipeEnvelope(kind="request", id="test", method="fs.listDirectory",
                                correlation_id="correlation", origin_nid=1)
        decoder = MessagePackStream()
        decoded = decode_envelope(list(decoder.feed(encode_frame(envelope)))[0])
        decoder.finish()
        self.assertEqual(decoded, envelope)
