"""Isolated transport tests: never start FWS shells or the shared framework."""
from __future__ import annotations

import asyncio
import subprocess
import sys
from unittest.mock import AsyncMock

import msgspec
import pytest
from starlette.exceptions import HTTPException
from starlette.testclient import TestClient

from app.apps.terminal import backend
from app.apps.terminal.http_app import MAX_BODY_BYTES
from app.apps.terminal.request_dtos import CreateShellRequest, ShellInputRequest, decode_request
from app.libs.app_worker_asgi import explicit_asgi_application


def request(method, path, **kwargs):
    # No TestClient context: HTTP tests must not launch lifecycle services.
    return TestClient(backend.TE2_ASGI_APP).request(method, path, **kwargs)


def test_worker_selects_explicit_app_without_legacy_router():
    assert explicit_asgi_application(backend, "terminal") is backend.TE2_ASGI_APP
    assert not hasattr(backend, "SUBAPPS")
    assert not hasattr(backend, "terminal_bp")


@pytest.mark.parametrize("method,path,handler,payload", [
    ("GET", "/sidebar/cwd", "get_sidebar_cwd", None),
    ("POST", "/sidebar/window/state", "publish_sidebar_window_state", {"host_id": "h"}),
    ("GET", "/shells", "list_shells", None),
    ("POST", "/shells", "create_shell", {}),
    ("GET", "/shells/session", "get_shell", None),
    ("POST", "/shells/session/input", "send_input", {"data": "a"}),
    ("POST", "/shells/session/resize", "resize_shell", {"cols": 90, "rows": 30}),
    ("POST", "/shells/session/action", "shell_action", {"action": "stop"}),
    ("DELETE", "/shells/session", "delete_shell", None),
])
def test_routes_keep_envelopes_and_domain_dispatch(monkeypatch, method, path, handler, payload):
    call = AsyncMock(return_value={"ok": True, "data": {"id": "session"}})
    monkeypatch.setattr(backend, handler, call)
    response = request(method, path, **({"json": payload} if payload is not None else {}))
    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"id": "session"}}
    call.assert_awaited_once()
    if handler == "create_shell":
        assert call.call_args.args[0] == CreateShellRequest()
    elif handler == "get_shell":
        assert call.call_args == (("session",), {"tail": 0, "logs": False})


def test_query_and_optional_sidebar_body(monkeypatch):
    call = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(backend, "get_shell", call)
    assert request("GET", "/shells/s?tail=10&logs=yes").status_code == 200
    call.assert_awaited_once_with("s", tail=10, logs=True)
    call.reset_mock()
    assert request("GET", "/shells/s?tail=bad").status_code == 422
    assert request("GET", "/shells/s?logs=bad").status_code == 422
    call.assert_not_awaited()
    monkeypatch.setattr(backend, "publish_sidebar_window_state", call)
    assert request("POST", "/sidebar/window/state").status_code == 200
    call.assert_awaited_once_with(None)


@pytest.mark.parametrize("path", ["/shells", "/sidebar/cwd", "/sidebar/window/state", "/shells/s/input"])
def test_slash_redirect_retains_query_and_root(path):
    response = request("GET", path + "/?q=value", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == path + "?q=value"


def test_routing_errors_and_domain_errors(monkeypatch):
    assert request("GET", "/missing").status_code == 404
    assert request("GET", "/shells/s/unknown").status_code == 404
    assert request("GET", "/shells/s/resize").headers["allow"] == "POST"
    assert request("PUT", "/shells").status_code == 405
    monkeypatch.setattr(backend, "get_shell", AsyncMock(side_effect=HTTPException(404, "Shell not found")))
    assert request("GET", "/shells/dead").json() == {"detail": "Shell not found"}


@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"null", b'{"data":3}', b'{"newline":true}'])
def test_invalid_input_never_mutates(monkeypatch, body):
    call = AsyncMock()
    monkeypatch.setattr(backend, "send_input", call)
    assert request("POST", "/shells/s/input", content=body).status_code == 422
    call.assert_not_awaited()


def test_body_limits_and_content_type(monkeypatch):
    call = AsyncMock()
    monkeypatch.setattr(backend, "create_shell", call)
    assert request("POST", "/shells", content=b"{}", headers={"content-length": "bad"}).status_code == 400
    assert request("POST", "/shells", content=b"{}", headers={"content-length": str(MAX_BODY_BYTES + 1)}).status_code == 413
    assert request("POST", "/shells", content=b"x" * (MAX_BODY_BYTES + 1)).status_code == 413
    assert request("POST", "/shells", content=b"{}", headers={"content-type": "text/plain"}).status_code == 422
    call.assert_not_awaited()


def test_disconnect_before_body_completion_does_not_create(monkeypatch):
    call = AsyncMock()
    monkeypatch.setattr(backend, "create_shell", call)
    async def run():
        events = iter([{"type": "http.request", "body": b"{", "more_body": True}, {"type": "http.disconnect"}])
        messages = []
        async def receive():
            return next(events)
        async def send(message):
            messages.append(message)
        await backend.TE2_ASGI_APP({"type": "http", "method": "POST", "path": "/shells"}, receive, send)
        assert not messages
    asyncio.run(run())
    call.assert_not_awaited()


def test_raw_websocket_keeps_binary_codec_rejection():
    with TestClient(backend.TE2_ASGI_APP).websocket_connect("/ws/terminal") as websocket:
        frame = msgspec.msgpack.decode(websocket.receive_bytes())
        assert frame["code"] == "codec_required"


def test_lifecycle_socket_mount_is_real_engineio():
    with TestClient(backend.TE2_ASGI_APP).websocket_connect("/socket.io/?EIO=4&transport=websocket", headers={"connection": "upgrade", "upgrade": "websocket"}) as websocket:
        assert websocket.receive_text().startswith('0{"sid":')


def test_raw_stream_disconnect_drops_only_its_connection(monkeypatch):
    from types import SimpleNamespace
    session = SimpleNamespace(shell_id="s")
    attach = AsyncMock()
    drop = AsyncMock()
    async def attached(_session, _conn_id, connection, **_kwargs):
        connection.queue.put_nowait({"type": "ready"})
    attach.side_effect = attached
    monkeypatch.setattr(backend, "_get_or_create_session", AsyncMock(return_value=session))
    monkeypatch.setattr(backend, "_attach_connection", attach)
    monkeypatch.setattr(backend, "_drop_connection", drop)
    with TestClient(backend.TE2_ASGI_APP).websocket_connect("/ws/terminal?codec=msgpack-v1") as websocket:
        websocket.send_bytes(msgspec.msgpack.encode({"type": "attach", "shell_id": "s", "request_id": "r"}))
        assert msgspec.msgpack.decode(websocket.receive_bytes()) == {"type": "ready"}
    attach.assert_awaited_once()
    drop.assert_awaited_once()
    assert drop.call_args.args[0] is session


def test_lifespan_does_not_spawn_or_post_readiness(monkeypatch):
    serving = AsyncMock()
    monkeypatch.setattr(backend, "te2_app_backend_serving", serving)
    with TestClient(backend.TE2_ASGI_APP):
        pass
    serving.assert_not_awaited()  # generic worker listener-ready hook owns this


def test_shared_dto_defaults_extra_fields_and_validation():
    assert decode_request({"cols": "90", "extra": 1}, CreateShellRequest).cols == 90
    assert decode_request({"data": "x", "newline": "false"}, ShellInputRequest).newline is False
    with pytest.raises(msgspec.ValidationError):
        decode_request({"shell": [3]}, CreateShellRequest)


def test_terminal_owned_modules_do_not_import_fastapi_or_pydantic():
    # FWS is a separately scheduled migration and may still import FastAPI;
    # block only the Terminal-owned imports to prove this slice's boundary.
    script = '''
import builtins
original = builtins.__import__
def checked(name, globals=None, locals=None, fromlist=(), level=0):
    owner = (globals or {}).get("__name__", "")
    if owner.startswith("app.apps.terminal") and name.split(".")[0] in {"fastapi", "pydantic"}:
        raise AssertionError(name)
    return original(name, globals, locals, fromlist, level)
builtins.__import__ = checked
from app.apps.terminal import backend
assert callable(backend.TE2_ASGI_APP)
'''
    subprocess.run([sys.executable, "-B", "-c", script], check=True, capture_output=True)
