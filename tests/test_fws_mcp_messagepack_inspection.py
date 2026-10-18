from __future__ import annotations

import asyncio
import json
import struct
from pathlib import Path

import msgspec
import pytest

from app.libs.fws_log_analysis import build_inspect_result


def test_query_uses_messagepack_frames(tmp_path: Path) -> None:
    from app.libs.native_fws_log_owner import LogRequest, Options, Snapshot, project
    path = tmp_path / "stdout.log"
    payload = {"jsonrpc": "2.0", "id": "1", "method": "project.openDirectory", "error": None}
    encoded = msgspec.msgpack.encode(payload)
    path.write_bytes(struct.pack(">I", len(encoded)) + encoded)
    snapshot = Snapshot(shell_id="shell", status="running", created_at=1.0, updated_at=1.0,
                        stdout_log=str(path), stderr_log="", log_codecs={"stdout": "messagepack"})
    result = asyncio.run(project(LogRequest("inspect", snapshot, Options(
        stream="stdout", query="project.openDirectory", lines=20, limit=1,
        signature="jsonrpc:method=project.openDirectory"))))
    data = result["data"]
    assert data["total_returned"] == data["summary"]["total_records"] == 1
    assert data["records"][0]["kinds"] == ["jsonrpc:request"]
    assert json.loads(data["records"][0]["text"])["method"] == "project.openDirectory"
    assert data["records"][0]["byte_start"] == 4


@pytest.mark.parametrize("payload,kind", [
    ({"method": "ready", "id": None, "error": None}, "notification"),
    ({"id": "1", "result": None, "error": None}, "response"),
    ({"id": "1", "error": {"code": -1}}, "error"),
])
def test_nullable_pipe_fields(payload: dict[str, object], kind: str) -> None:
    result = build_inspect_result(shell_id="s", status="running", mode="tail", query=None,
        payload={"stdout": {"records": [{"text": json.dumps({"jsonrpc": "2.0", **payload}),
            "kinds": ["jsonrpc:error"], "event_signature": "jsonrpc:error"}]}})
    assert f"jsonrpc:{kind}" in result.records[0].kinds
    assert ("jsonrpc:error" in result.records[0].kinds) == (kind == "error")
