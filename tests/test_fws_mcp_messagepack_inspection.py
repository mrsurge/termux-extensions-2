from __future__ import annotations

import asyncio
import json
import struct
from pathlib import Path

import msgspec
import pytest

from app.te2_mcp import framework_shells_client as client_module
from app.te2_mcp.fws_log_analysis import build_inspect_result
from framework_shells.log_inspection import inspect_log_file


@pytest.mark.parametrize("fallback", [False, True])
def test_query_uses_messagepack_frames(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fallback: bool) -> None:
    path = tmp_path / "stdout.log"
    payload = {"jsonrpc": "2.0", "id": "1", "method": "project.openDirectory", "error": None}
    encoded = msgspec.msgpack.encode(payload)
    path.write_bytes(struct.pack(">I", len(encoded)) + encoded)

    class Manager:
        LOG_TAIL_BYTES = 4096

        async def search_logs(self, *args: object, **kwargs: object) -> object:
            raise AssertionError("raw text search must not be used")

        async def inspect_logs(self, shell_id: str, **kwargs: object) -> dict[str, object]:
            if fallback:
                raise TypeError("older manager signature")
            assert kwargs["query"] == "project.openDirectory"
            inspection = await inspect_log_file(path, codec="messagepack", stream="stdout", lines=20,
                                                max_bytes=4096, query="project.openDirectory")
            return {"status": "running", "stdout": inspection}

        async def get_shell(self, shell_id: str) -> dict[str, object]:
            return {"stdout_log": str(path), "status": "running", "log_codecs": {"stdout": "messagepack"}}

        async def _log_stream_payload(self, path: Path, *, extra: dict[str, object]) -> dict[str, object]:
            return extra

    async def get_manager() -> Manager:
        return Manager()

    monkeypatch.setattr(client_module, "get_manager", get_manager)
    result = asyncio.run(client_module.FrameworkShellsClient().inspect_logs(
        "shell", stream="stdout", query="project.openDirectory", lines=20, limit=1,
        signature="jsonrpc:method=project.openDirectory"))
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
