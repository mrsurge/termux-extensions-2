from __future__ import annotations

import subprocess
import sys

import msgspec
import pytest

from app.libs import pipe_codec, pipe_protocol
from app.libs import pipe_dto
from app.libs.messagepack_stream import encode_message


def test_public_dto_aliases_preserve_class_identity():
    for name in ("PipeEnvelope", "PipeError", "PipeIdentity", "PipeProtocolError"):
        assert getattr(pipe_protocol, name) is getattr(pipe_dto, name)


def test_structural_consumers_do_not_import_wire_codec():
    result = subprocess.run([sys.executable, "-c", """
import sys
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity, success_response
from app.libs import pipe_runtime, pipe_inbound, pipe_transport
request = PipeEnvelope(kind='request', id='1', method='test')
reply = success_response(request, PipeIdentity(2100, 'test'), {'data': b'\\xff'})
assert reply.result == {'data': b'\\xff'}
assert 'app.libs.pipe_codec' not in sys.modules
assert 'app.libs.messagepack_stream' not in sys.modules
assert 'msgpack' not in sys.modules
"""], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("value", [
    {}, {"kind": "response", "id": "x", "result": {"bytes": b"\x00\xff", "int": 2**63}},
    {"kind": "request", "id": "x", "method": "test", "unknown": True},
    {"kind": "error", "error": {"code": "test", "message": "λ", "details": [None, False]}},
    {"kind": "notification", "projectGeneration": 3, "workspaceRoot": "/a", "opId": "op"},
])
def test_conversion_and_encoded_bytes_match_previous_implementation(value):
    expected = msgspec.convert(value, type=pipe_protocol.PipeEnvelope, strict=True)
    pipe_protocol.validate_envelope(expected)
    assert pipe_codec.decode_envelope(value) == expected
    assert pipe_protocol.decode_envelope(value) == expected
    assert pipe_codec.encode_frame(expected) == encode_message(expected)
    assert pipe_protocol.encode_frame(expected) == encode_message(expected)


@pytest.mark.parametrize("value", [
    [], None, {"originNid": "1"}, {"originNid": True}, {"id": 1},
    {"error": {"code": 1}}, {"jsonrpc": "1.0"}, {"protocolVersion": 2},
    {"kind": "request"}, {"kind": "request", "id": "x"},
])
def test_error_type_and_message_parity(value):
    try:
        try:
            old = msgspec.convert(value, type=pipe_protocol.PipeEnvelope, strict=True)
        except msgspec.ValidationError as error:
            raise pipe_protocol.PipeProtocolError(f"invalid MessagePack envelope: {error}") from error
        pipe_protocol.validate_envelope(old)
    except pipe_protocol.PipeProtocolError as error:
        expected = str(error)
    else:
        pytest.fail("fixture must be invalid")
    with pytest.raises(pipe_protocol.PipeProtocolError) as actual:
        pipe_protocol.decode_envelope(value)
    assert str(actual.value) == expected
