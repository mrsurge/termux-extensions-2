"""Aria HTTP/domain regressions with isolated files and no live RPC/shells."""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.testclient import TestClient

from app.apps.aria_downloader import main
from app.apps.aria_downloader.http_app import MAX_BODY_BYTES
from app.libs.app_worker_asgi import explicit_asgi_application


def request(method, path, **kwargs):
    return TestClient(main.TE2_ASGI_APP).request(method, path, **kwargs)


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "STATE_DIR", tmp_path)
    monkeypatch.setattr(main, "STATE_FILE", tmp_path / "state.json")


def test_worker_export_and_lifespan_do_not_own_readiness(monkeypatch):
    assert explicit_asgi_application(main, "aria_downloader") is main.TE2_ASGI_APP
    assert not hasattr(main, "aria_downloader_bp")
    serving = AsyncMock()
    monkeypatch.setattr(main, "te2_app_backend_serving", serving)
    with TestClient(main.TE2_ASGI_APP) as client:
        assert client.get("/").json()["data"]["message"] == "Aria Downloader API ready"
    serving.assert_not_awaited()


def test_status_and_download_projection_are_off_loop(monkeypatch):
    def rpc(method, *args):
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()
        if method in {"aria2.getVersion", "aria2.getGlobalStat"}:
            return {"method": method}, None
        return [{"gid": "one", "files": [{"path": "/downloads/a.zip"}],
                 "totalLength": "100", "completedLength": "40", "downloadSpeed": "12"}], None
    monkeypatch.setattr(main, "call_rpc", rpc)
    assert request("GET", "/status").json()["data"]["version"] == {"method": "aria2.getVersion"}
    data = request("GET", "/downloads").json()["data"]
    for group in ["active", "waiting", "stopped"]:
        assert data[group][0]["name"] == "a.zip"
        assert data[group][0]["progress"] == 0.4


def test_add_control_and_settings_preserve_rpc_shapes(monkeypatch):
    calls = []
    def rpc(method, *args):
        calls.append((method, args))
        return "gid", None
    monkeypatch.setattr(main, "call_rpc", rpc)
    assert request("POST", "/add", json={"url": "https://example.test/a", "directory": "/out", "filename": "a"}).json()["data"]["gid"] == "gid"
    assert calls[-1] == ("aria2.addUri", (["https://example.test/a"], {"dir": "/out", "out": "a"}))
    assert request("POST", "/control", json={"action": "pause", "gids": ["one", "two"]}).json()["data"]["processed"] == ["one", "two"]
    assert request("POST", "/control", json={"action": "pauseAll"}).status_code == 200
    assert calls[-1] == ("aria2.pauseAll", ())
    assert request("POST", "/settings", json={"global": {"max-download-limit": "2M"}, "gid": "one", "perDownload": {"split": "2"}}).status_code == 200
    assert calls[-1] == ("aria2.changeOption", ("one", {"split": "2"}))


@pytest.mark.parametrize("path,payload", [("/add", {}), ("/control", {"action": "pause"}),
    ("/control", {"action": []}), ("/settings", {}), ("/settings", {"perDownload": {"x": "y"}})])
def test_command_validation(path, payload):
    assert request("POST", path, json=payload).status_code == 400


def test_rpc_errors_do_not_retry_mutations(monkeypatch):
    calls = []
    def rpc(method, *args):
        calls.append(method)
        return None, "RPC unavailable"
    monkeypatch.setattr(main, "call_rpc", rpc)
    response = request("POST", "/add", json={"url": "https://example.test/a"})
    assert response.status_code == 502
    assert response.json() == {"detail": "RPC unavailable"}
    assert calls == ["aria2.addUri"]


@pytest.mark.parametrize("path", ["/add", "/control", "/settings", "/shell/spawn", "/shell/action"])
@pytest.mark.parametrize("body", [b"null", b"[]", b"{", b""])
def test_invalid_body_rejected_before_dispatch(path, body):
    assert request("POST", path, content=body, headers={"content-type": "application/json"}).status_code in {400, 422}


def test_size_method_query_and_redirect_guards():
    assert request("POST", "/add", content=b" " * (MAX_BODY_BYTES + 1)).status_code == 413
    response = request("POST", "/status")
    assert response.status_code == 405 and response.headers["allow"] == "GET"
    assert request("GET", "/shell?logs=maybe").status_code == 422
    assert request("GET", "/shell?tail=bad").status_code == 422
    assert request("GET", "/missing").status_code == 404
    response = request("GET", "/status/?x=1", follow_redirects=False)
    assert response.status_code == 307 and response.headers["location"].endswith("/status?x=1")


class Manager:
    def __init__(self):
        self.record = SimpleNamespace(id="old", created_at=1)
        self.calls = []
    async def get_shell(self, shell_id):
        self.calls.append(("get", shell_id)); return self.record
    async def list_shells(self):
        return [self.record]
    async def describe(self, record, **options):
        assert record is not None
        self.calls.append(("describe", options))
        return {"id": record.id, "label": "aria2", "command": ["aria2c"], "cwd": "/downloads"}
    async def terminate_shell(self, shell_id, force=False):
        self.calls.append(("terminate", shell_id, force))
        return None  # Actual Framework-Shells contract.
    async def remove_shell(self, shell_id, force=False):
        self.calls.append(("remove", shell_id, force)); self.record = None; return True
    async def spawn_shell(self, command, **options):
        self.calls.append(("spawn", command, options))
        self.record = SimpleNamespace(id="new", created_at=2)
        return self.record


@pytest.fixture
def manager(monkeypatch):
    mgr = Manager()
    monkeypatch.setattr(main, "_framework_manager", AsyncMock(return_value=mgr))
    return mgr


def test_list_tracked_shell_logs_adoption_and_remove(manager):
    assert len(request("GET", "/shells").json()["data"]["shells"]) == 1
    assert request("GET", "/shell").json()["data"]["shell"] is None
    assert request("POST", "/shell/action", json={"action": "adopt", "id": "old"}).status_code == 200
    assert request("GET", "/shell?logs=true&tail=25").status_code == 200
    assert manager.calls[-1] == ("describe", {"include_logs": True, "tail_lines": 25})
    assert request("POST", "/shell/action", json={"action": "remove"}).json()["data"]["shell"] is None
    assert not main.STATE_FILE.exists()


def test_spawn_and_restart_use_real_manager_contract_and_preserve_environment(manager):
    response = request("POST", "/shell/spawn", json={"binary": "aria2c", "args": ["--quiet"],
        "cwd": "/downloads", "env": {"COLORTERM": "truecolor"}, "label": "one", "autostart": True})
    assert response.status_code == 200
    saved = main._load_shell_state()
    assert saved["id"] == "new" and saved["env"] == {"COLORTERM": "truecolor"}
    assert request("POST", "/shell/spawn", json={}).status_code == 409
    response = request("POST", "/shell/action", json={"action": "restart"})
    assert response.status_code == 200
    spawned = [call for call in manager.calls if call[0] == "spawn"][-1]
    assert spawned[1] == ["aria2c", *main.DEFAULT_ARIA2_COMMAND[1:], "--quiet"]
    assert spawned[2]["cwd"] == "/downloads" and spawned[2]["env"] == {"COLORTERM": "truecolor"}
    assert main._load_shell_state()["id"] == "new"


@pytest.mark.parametrize("payload", [{}, {"autostart": False}])
def test_explicit_start_and_restart_launch_even_with_false_saved_flag(manager, payload):
    assert request("POST", "/shell/spawn", json=payload).status_code == 200
    assert main._load_shell_state()["autostart"] is False
    assert [call for call in manager.calls if call[0] == "spawn"][-1][2]["autostart"] is True
    assert request("POST", "/shell/action", json={"action": "restart"}).status_code == 200
    assert [call for call in manager.calls if call[0] == "spawn"][-1][2]["autostart"] is True
    assert main._load_shell_state()["autostart"] is False


@pytest.mark.parametrize("action,force", [("stop", False), ("kill", True)])
def test_stop_describes_refetched_record_not_none(manager, action, force):
    main._save_shell_state({"id": "old"})
    response = request("POST", "/shell/action", json={"action": action})
    assert response.status_code == 200
    assert ("terminate", "old", force) in manager.calls
    assert ("get", "old") in manager.calls


def test_missing_and_invalid_shell_actions(manager):
    assert request("POST", "/shell/action", json={"action": "stop"}).status_code == 404
    assert request("POST", "/shell/action", json={"action": 3}).status_code == 400
    main._save_shell_state({"id": "old"})
    assert request("POST", "/shell/action", json={"action": "unknown"}).status_code == 400
    assert request("POST", "/shell/action", json={"action": "restart"}).status_code == 400


def test_rpc_encoding_secret(monkeypatch):
    calls = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return b'{"result":"one"}'
    def open_request(req, timeout):
        calls.append(json.loads(req.data))
        return Response()
    monkeypatch.setattr(main.urllib.request, "urlopen", open_request)
    monkeypatch.setenv("ARIA2_RPC_SECRET", "test-secret")
    assert main.call_rpc("aria2.addUri", ["https://example.test/a"]) == ("one", None)
    assert calls[0]["params"] == ["token:test-secret", ["https://example.test/a"]]


@pytest.mark.parametrize("raw,error", [(b"not-json", "malformed JSON"),
    (b'{"error":{"code":1,"message":"denied"}}', "aria2 error 1: denied")])
def test_rpc_error_response_projection(monkeypatch, raw, error):
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return raw
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda *args, **kwargs: Response())
    result, message = main.call_rpc("aria2.getVersion")
    assert result is None and error in message


def test_stop_with_removed_record_clears_tracking(manager):
    main._save_shell_state({"id": "old"})
    manager.record = None
    assert request("POST", "/shell/action", json={"action": "stop"}).json()["data"]["shell"] is None
    assert not main.STATE_FILE.exists()


def test_disconnected_body_never_dispatches(monkeypatch):
    called = []
    monkeypatch.setattr(main, "add_download", lambda payload: called.append(payload))
    sent = []
    async def run():
        async def receive(): return {"type": "http.disconnect"}
        async def send(message): sent.append(message)
        await main.TE2_ASGI_APP({"type": "http", "path": "/add", "method": "POST", "headers": []}, receive, send)
    asyncio.run(run())
    assert called == [] and sent == []
