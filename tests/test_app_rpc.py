from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.libs import app_rpc, sidebar_rpc
from app.apps.code_te2.host import sidebar_rpc_backend as service
from app.apps.code_te2.app_intent_pipe import dispatch_app_intent
from app.libs.pipe_protocol import PipeEnvelope


def envelope(method="window.state.update", payload=None):
    return {"service": "sidebar", "version": 1, "method": method, "context": None,
            "source": {"appId": "file_explorer", "shellId": "owned"},
            "payload": payload if payload is not None else {
                "app_id": "file_explorer", "host_id": "slot", "token_id": "token",
                "base_url": "/app/file_explorer", "activate": False,
                "url": "/app/file_explorer?tab_id=tab"}}


def test_helper_uses_existing_pipe_and_never_retries(monkeypatch):
    call = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(app_rpc.pipe_runtime, "call_async", call)
    async def run():
        for _ in range(2):
            assert await sidebar_rpc.call_sidebar_rpc("file_explorer", "sidebar.cwd.get", {}) == {"ok": True}
        first, second = call.call_args_list
        assert first.args == ("app.rpc.call", {"targetApp": "code_te2", "service": "sidebar",
                "version": 1, "method": "cwd.get", "context": None, "payload": {}})
        assert first.kwargs["target_name"] == "framework.rust"
        assert first.kwargs["target_nid"] == 1
        assert first.kwargs["timeout_seconds"] == 20
        assert first.kwargs["op_id"] != second.kwargs["op_id"]
        call.reset_mock()
        call.side_effect = RuntimeError("outcome unknown")
        with pytest.raises(RuntimeError, match="outcome unknown"):
            await sidebar_rpc.call_sidebar_rpc("file_editor", "sidebar.window.state.update", {})
        call.assert_awaited_once()
        with pytest.raises(ValueError):
            await sidebar_rpc.call_sidebar_rpc("file_editor", "sidebar.window.activate", {})
        call.assert_awaited_once()
    asyncio.run(run())


@pytest.fixture
def owners(monkeypatch):
    slot = {"app_id": "file_explorer", "token_id": "token", "base_url": "/app/file_explorer"}
    monkeypatch.setattr(service, "get_sidebar_window_state", lambda: {"slots": {"slot": slot}})
    writes = []
    def write(params):
        writes.append(params)
        return {"ok": True, "state": {"slots": {"slot": slot}}}
    monkeypatch.setattr(service, "open_sidebar_window_url", write)
    publish = AsyncMock()
    monkeypatch.setattr(service, "publish_sidebar_window_state_changed", publish)
    return writes, publish


def test_dispatch_reuses_state_owner_and_global_projection(owners):
    body = envelope()
    request = PipeEnvelope(kind="request", method="app.rpc.deliver", params=body)
    assert asyncio.run(dispatch_app_intent(request))["ok"] is True
    writes, publish = owners
    assert len(writes) == 1 and writes[0]["activate"] is False
    assert writes[0]["app_id"] == "file_explorer"
    assert publish.await_args.kwargs == {"source": "file_explorer_pipe_state", "sidebar_scope": "global"}


@pytest.mark.parametrize("change", [
    {"activate": True}, {"activate": "false"}, {"app_id": "terminal"}, {"appId": "terminal"},
    {"host_id": "unknown"}, {"hostId": "different"}, {"token_id": "wrong"},
    {"tokenId": "wrong"}, {"base_url": "/app/terminal"},
    {"lane": {"app_id": "terminal"}}, {"lane": {"baseUrl": "/app/terminal"}},
])
def test_invalid_state_never_reaches_owner(change, owners):
    body = envelope()
    body["payload"].update(change)
    with pytest.raises(ValueError):
        asyncio.run(service.dispatch_sidebar_service(body))
    writes, publish = owners
    assert writes == []
    publish.assert_not_awaited()


@pytest.mark.parametrize("change", [
    {"service": "other"}, {"version": 2}, {"version": True}, {"method": "activate"},
    {"context": {"clientId": "forged"}}, {"source": {"appId": "other", "shellId": "owned"}},
    {"source": {"appId": "terminal", "shellId": "owned"}},
    {"source": {"appId": "file_explorer", "shellId": ""}}, {"extra": True},
])
def test_invalid_envelope_has_no_side_effects(change, owners):
    body = envelope(); body.update(change)
    with pytest.raises(ValueError):
        asyncio.run(service.dispatch_sidebar_service(body))
    assert owners[0] == []
    owners[1].assert_not_awaited()


def test_cwd_uses_existing_read_owner(monkeypatch, owners):
    from app.apps.code_te2.ui_ipc import sidebar_ws
    monkeypatch.setattr(sidebar_ws, "get_sidebar_cwd_snapshot", lambda reason: {"cwd": "/project", "reason": reason})
    body = envelope("cwd.get", {})
    assert asyncio.run(service.dispatch_sidebar_service(body)) == {"cwd": "/project", "reason": "request"}
    assert owners[0] == []
    owners[1].assert_not_awaited()
    body["payload"] = {"cwd": "/forged"}
    with pytest.raises(ValueError):
        asyncio.run(service.dispatch_sidebar_service(body))


def test_manifest_and_worker_transport_declarations():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "app/apps/code_te2/manifest.json").read_text())
    service = manifest["ipc"]["services"]["sidebar"]
    assert service["version"] == 1
    assert service["callers"] == ["terminal", "file_explorer", "file_editor", "als-rs"]
    assert {"cwd.get", "window.state.update", "file.open", "draftState.get"} <= set(service["methods"])
    assert "cwd.get" not in service["limits"]
    assert service["limits"]["project.open"]["timeoutMs"] == 180000
    import yaml
    for app in ("terminal", "file_editor", "file_explorer"):
        spec = yaml.safe_load((root / f"app/apps/{app}/shellspec/app_worker.yaml").read_text())["shells"]["app-worker"]
        assert spec["backend"] == "pipe"
        assert spec["pipe"]["mode"] == "native_pipe_testing"
        assert "--pipe" in spec["command"]


def test_app_rpc_reuses_trusted_admission(monkeypatch):
    from app.apps.code_te2.app_intent_pipe import AppIntentPipe
    from app.libs.pipe_protocol import PipeIdentity
    replies = []
    handler = AsyncMock()
    adapter = AppIntentPipe(identity=PipeIdentity(2100, "code_te2"), reply=replies.append, handler=handler)
    request = PipeEnvelope(kind="request", method="app.rpc.deliver", origin_nid=9, origin_name="forged")
    assert adapter.submit(request)
    assert replies[0].error.code == "appIntent.untrustedOrigin"
    handler.assert_not_awaited()


def test_ordinary_http_worker_roundtrips_through_its_stdio_pipe(tmp_path):
    """Real HTTP + pipe composition, isolated from the shared framework/runtime."""
    import concurrent.futures
    import os
    import select
    import socket
    import subprocess
    import sys
    import time
    from urllib.request import urlopen
    from app.libs.messagepack_stream import MessagePackStream
    from app.libs.pipe_protocol import decode_envelope, encode_frame, success_response, PipeIdentity

    root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    for key in ("TE2_CACHE_HOME", "TE2_CONFIG_HOME", "TE2_DATA_HOME", "TE2_RUNTIME_HOME"):
        env[key] = str(tmp_path / key.lower())
    env["TE_FRAMEWORK_URL"] = "http://127.0.0.1:9"
    env["TE2_DISABLE_UVLOOP"] = "1"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    with (tmp_path / "stderr").open("wb") as stderr:
        process = subprocess.Popen([
            sys.executable, "-B", "-m", "app.libs.app_worker", "--app-id", "native",
            "--pipe", "--port", str(port), "--backend-module",
            str(root / "tests/fixtures/app_worker_package/native/main.py"),
        ], cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr)
        try:
            deadline = time.monotonic() + 12
            base = f"http://127.0.0.1:{port}"
            while True:
                try:
                    with urlopen(base + "/identity", timeout=0.2) as response:
                        assert response.status == 200
                    break
                except OSError:
                    assert process.poll() is None, (tmp_path / "stderr").read_text()
                    assert time.monotonic() < deadline, "isolated HTTP worker did not bind"
                    time.sleep(0.02)
            def get():
                with urlopen(base + "/app-rpc-proof", timeout=8) as response:
                    return json.loads(response.read())
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                result = executor.submit(get)
                stream = MessagePackStream()
                frames = []
                while not frames:
                    assert select.select([process.stdout], [], [], 5)[0], "worker emitted no pipe request"
                    frames.extend(stream.feed(os.read(process.stdout.fileno(), 65536)))
                request = decode_envelope(frames[0])
                assert request.method == "app.rpc.call"
                assert request.params["method"] == "cwd.get"
                assert request.params["targetApp"] == "code_te2"
                reply = success_response(request, PipeIdentity(1, "framework.rust"), {"cwd": "/proof"})
                process.stdin.write(encode_frame(reply)); process.stdin.flush()
                assert result.result(timeout=8) == {"cwd": "/proof"}
        finally:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=3)
            process.stdin.close(); process.stdout.close()
