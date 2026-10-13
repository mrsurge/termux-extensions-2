"""File Editor backend parity without real runtime transitions or user files."""
from __future__ import annotations

import asyncio
import builtins
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from starlette.testclient import TestClient

from app.apps.file_editor import main
from app.apps.file_editor.http_app import MAX_BODY_BYTES
from app.libs.app_worker_asgi import explicit_asgi_application


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    return tmp_path


def request(method, path, **kwargs):
    return TestClient(main.TE2_ASGI_APP).request(method, path, **kwargs)


def test_explicit_worker_and_lifespan(monkeypatch):
    assert explicit_asgi_application(main, "file_editor") is main.TE2_ASGI_APP
    assert not hasattr(main, "file_editor_bp")
    serving = AsyncMock()
    monkeypatch.setattr(main, "te2_app_backend_serving", serving)
    with TestClient(main.TE2_ASGI_APP) as client:
        assert client.get("/").json() == {"ok": True, "data": {"message": "File Editor app API ready"}}
    serving.assert_not_awaited()


def test_read_write_round_trip_and_empty_content(home):
    path = home / "nested" / "file.md"
    assert request("POST", "/write", json={"path": str(path), "content": "hello 🌎"}).json() == {"ok": True, "data": {"path": str(path)}}
    assert request("GET", "/read", params={"path": str(path)}).json() == {"ok": True, "data": {"path": str(path), "content": "hello 🌎"}}
    assert request("POST", "/write", json={"path": str(path), "content": ""}).status_code == 200
    assert path.read_text() == ""


def test_home_guard_symlink_escape_and_missing_file(home):
    outside = home.parent / "outside.txt"
    outside.write_text("untouched")
    link = home / "link"
    link.symlink_to(outside)
    for target in [str(outside), str(link)]:
        read = request("GET", "/read", params={"path": target})
        assert read.status_code == 403
        assert read.json() == {"detail": {"ok": False, "error": "Access denied"}}
        assert request("POST", "/write", json={"path": target, "content": "bad"}).status_code == 403
    assert outside.read_text() == "untouched"
    response = request("GET", "/read", params={"path": str(home / "missing")})
    assert response.status_code == 404
    assert response.json() == {"detail": {"ok": False, "error": "File not found"}}


def test_read_replaces_invalid_utf8(home):
    path = home / "raw"
    path.write_bytes(b"a\xff")
    assert request("GET", "/read", params={"path": str(path)}).json()["data"]["content"] == "a�"


def test_sidebar_identity_and_state_keep_backend_owner(home, monkeypatch):
    from app.libs import sidebar_rpc
    path = home / "notes.md"
    path.write_text("x")
    call = AsyncMock(return_value={"updated": True})
    monkeypatch.setattr(sidebar_rpc, "call_sidebar_rpc", call)
    payload = {"host_id": "h", "token_id": "t", "console_worker_id": "w", "file": str(path)}
    assert request("POST", "/sidebar/window/state", json=payload).json() == {"ok": True, "data": {"updated": True}}
    call.assert_awaited_once()
    assert call.call_args.args[:2] == (main.APP_ID, "sidebar.window.state.update")
    state = call.call_args.args[2]
    assert state["query_state"] == {"file": str(path)}
    assert state["activate"] is False
    call.reset_mock()
    assert request("POST", "/sidebar/window/state", json={"file": str(path)}).status_code == 400
    assert request("POST", "/sidebar/window/state", json={**payload, "host_id": 2}).status_code == 422
    call.assert_not_awaited()


@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"null", b'{"path":"x"}', b'{"path":3,"content":"x"}', b'{"path":"x","content":null}'])
def test_invalid_body_never_writes(monkeypatch, body):
    write = AsyncMock()
    monkeypatch.setattr(main, "write_file", write)
    assert request("POST", "/write", content=body).status_code == 422
    write.assert_not_awaited()


def test_limits_and_disconnect_never_write(monkeypatch):
    write = AsyncMock()
    monkeypatch.setattr(main, "write_file", write)
    assert request("POST", "/write", content=b"{}", headers={"content-length": "bad"}).status_code == 400
    assert request("POST", "/write", content=b"{}", headers={"content-length": str(MAX_BODY_BYTES + 1)}).status_code == 413
    assert request("POST", "/write", content=b"{}", headers={"content-type": "text/plain"}).status_code == 422
    async def run():
        events = iter([{"type": "http.request", "body": b"{", "more_body": True}, {"type": "http.disconnect"}])
        async def receive():
            return next(events)
        send = AsyncMock()
        await main.TE2_ASGI_APP({"type": "http", "path": "/write", "method": "POST"}, receive, send)
        send.assert_not_awaited()
    asyncio.run(run())
    write.assert_not_awaited()


def test_routing_and_query_validation():
    assert request("GET", "/read").status_code == 422
    assert request("POST", "/read").status_code == 405
    assert request("POST", "/read").headers["allow"] == "GET"
    assert request("GET", "/missing").status_code == 404
    response = request("GET", "/read/?path=x", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/read?path=x"


def test_app_owned_imports_do_not_require_fastapi(monkeypatch):
    import importlib
    from app.apps.file_editor import http_app
    original = builtins.__import__
    def checked(name, globals=None, locals=None, fromlist=(), level=0):
        owner = (globals or {}).get("__name__", "")
        if owner.startswith("app.apps.file_editor") and name.split(".")[0] in {"fastapi", "pydantic"}:
            raise AssertionError(name)
        return original(name, globals, locals, fromlist, level)
    monkeypatch.setattr(builtins, "__import__", checked)
    importlib.reload(http_app)
    importlib.reload(main)
