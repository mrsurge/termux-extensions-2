"""Probe-only Python owners. Imported under the normal isolated build audit hook."""
from __future__ import annotations

import datetime
import importlib.metadata
import sys

import msgspec

from app.apps.code_te2.native_worker import _struct_values
from app.libs.pipe_codec import decode_envelope, decode_envelope_bytes
from app.libs.pipe_dto import PipeEnvelope, PipeError


def versions() -> dict[str, str]:
    import app.apps.code_te2.native_worker as worker

    return {"python": sys.version, "msgspec": importlib.metadata.version("msgspec"),
            "projection_module": str(worker.__file__)}


def fixture(name: str) -> object:
    payload: object
    if name == "control":
        payload = {"path": "/workspace/main.py", "line": 59, "column": 1}
    elif name == "nested_256":
        payload = {"items": [{"path": f"/workspace/file_{i}.py", "line": i + 1,
                             "markers": [{"severity": 8, "message": "diagnostic λ🙂"}]}
                            for i in range(256)]}
    elif name == "unicode_binary_256k":
        payload = {"text": "λ🙂\n" * 4096, "binary": bytes(range(256)) * 1024}
    elif name == "wide_1024":
        payload = {f"field_{i}": [i, True, None, f"value_{i}"] for i in range(1024)}
    elif name == "search_512":
        return PipeEnvelope(kind="response", id="probe:search", result={"files": [
            {"path": f"/workspace/file_{i}.py", "matches": [
                {"line": i + 1, "column": 3, "endLine": i + 1, "preview": "match λ🙂 " + "context " * 12}]
            } for i in range(512)]})
    elif name == "git_512":
        return PipeEnvelope(kind="response", id="probe:git", result={"statuses": [
            {"path": f"file_{i}.py", "indexStatus": "M", "worktreeStatus": " ", "renamed": False}
            for i in range(512)]})
    elif name == "error":
        return PipeEnvelope(kind="error", id="probe:1", origin_nid=2100,
                            origin_name="code_te2", error=PipeError("probe.error", "λ", False,
                                                                   {"path": "/example"}))
    elif name == "unsupported_set":
        payload = {"value": {1, 2}}
    elif name == "unsupported_datetime":
        payload = {"value": datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)}
    else:
        raise ValueError(name)
    return PipeEnvelope(kind="request", id="probe:1", method="probe.inspect",
                        origin_nid=2100, origin_name="code_te2", target_nid=1,
                        target_name="framework.rust", correlation_id="probe:1",
                        op_id="probe-op", params=payload)


def from_graph(value: object) -> object:
    return decode_envelope(value)


def from_bytes(data: bytes) -> object:
    return decode_envelope_bytes(data)


def to_graph(value: object) -> dict[str, object]:
    if not isinstance(value, PipeEnvelope):
        raise TypeError("Expected PipeEnvelope")
    result = _struct_values(value)
    if value.error is not None:
        result["error"] = _struct_values(value.error)
    return result


def to_bytes(value: object) -> bytes:
    return msgspec.msgpack.encode(value)
