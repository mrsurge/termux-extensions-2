"""Neutral transport contracts and adoption parity; no live app/runtime changes."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import subprocess
import sys
from unittest.mock import AsyncMock

import pytest
from starlette.exceptions import HTTPException
from starlette.responses import Response

from app.libs.te2_asgi import (
    HTTPError, noop_lifespan, read_json_object, read_optional_json_object,
    redirect_to, require_method, resolve_http_response,
)


def body_read(data, *, optional=False, empty="decode", max_bytes=64, headers=None, decoder=None):
    async def run():
        receive = AsyncMock(return_value={"type": "http.request", "body": data})
        kwargs = {"max_bytes": max_bytes}
        if decoder is not None:
            kwargs["decoder"] = decoder
        if optional:
            return await read_optional_json_object({"headers": headers or []}, receive, **kwargs)
        return await read_json_object({"headers": headers or []}, receive, empty=empty, **kwargs)
    return asyncio.run(run())


@pytest.mark.parametrize("optional,empty,data,expected", [
    (False, "decode", b"{}", {}),
    (False, "object", b"", {}),
    (True, "decode", b"", None),
    (True, "decode", b"null", None),
    (True, "decode", b'{"path":"x"}', {"path": "x"}),
])
def test_empty_and_null_policies_are_explicit(optional, empty, data, expected):
    assert body_read(data, optional=optional, empty=empty) == expected


@pytest.mark.parametrize("data,empty,detail", [
    (b"", "decode", "Invalid JSON body"),
    (b"", "reject", "Request body is required"),
    (b"null", "object", "Request body must be an object"),
    (b"[]", "decode", "Request body must be an object"),
    (b"{", "decode", "Invalid JSON body"),
])
def test_required_body_errors_keep_their_envelopes(data, empty, detail):
    with pytest.raises(HTTPException) as failure:
        body_read(data, empty=empty)
    assert failure.value.status_code == 422
    assert failure.value.detail == detail


@pytest.mark.parametrize("headers,status", [
    ([(b"content-length", b"bad")], 400),
    ([(b"content-length", b"-1")], 400),
    ([(b"content-length", b"65")], 413),
    ([(b"content-type", b"text/plain")], 422),
])
def test_header_rejection_never_reads_body(headers, status):
    async def run():
        receive = AsyncMock()
        with pytest.raises(HTTPException) as failure:
            await read_json_object({"headers": headers}, receive, max_bytes=64)
        assert failure.value.status_code == status
        receive.assert_not_awaited()
    asyncio.run(run())


@pytest.mark.parametrize("content_type", [b"application/json", b"application/problem+json; charset=utf-8", b"APPLICATION/JSON"])
def test_json_content_types(content_type):
    assert body_read(b"{}", headers=[(b"content-type", content_type)]) == {}


def test_fragmented_body_disconnect_and_cumulative_limit():
    async def run(events, limit):
        messages = iter(events)
        async def receive():
            return next(messages)
        return await read_json_object({}, receive, max_bytes=limit)
    assert asyncio.run(run([
        {"type": "http.request", "body": b'{"x":', "more_body": True},
        {"type": "http.request", "body": b'1}'},
    ], 7)) == {"x": 1}
    with pytest.raises(ConnectionAbortedError):
        asyncio.run(run([{"type": "http.request", "body": b"{", "more_body": True}, {"type": "http.disconnect"}], 64))
    with pytest.raises(HTTPException) as failure:
        asyncio.run(run([{"type": "http.request", "body": b"123", "more_body": True}, {"type": "http.request", "body": b"456"}], 5))
    assert failure.value.status_code == 413


@pytest.mark.parametrize("event", [{"type": "websocket.receive"}, {"type": "http.request", "body": "not bytes"}])
def test_invalid_asgi_body_events(event):
    async def run():
        await read_json_object({}, AsyncMock(return_value=event), max_bytes=64)
    with pytest.raises(HTTPException) as failure:
        asyncio.run(run())
    assert failure.value.status_code == 400


def test_caller_decoder_is_preserved_and_keys_are_validated():
    result = body_read('{"n":NaN}'.encode('utf-16'), decoder=json.loads)
    assert math.isnan(result["n"])
    with pytest.raises(HTTPException) as failure:
        body_read(b"{}", decoder=lambda data: {1: "x"})
    assert failure.value.detail == "Object keys must be strings"


@pytest.mark.parametrize("exception", [ValueError(), UnicodeError(), RecursionError()])
def test_decoder_failures_use_existing_invalid_json_detail(exception):
    def decoder(data):
        raise exception
    with pytest.raises(HTTPException) as failure:
        body_read(b"{}", decoder=decoder)
    assert failure.value.detail == "Invalid JSON body"


def test_redirect_keeps_mount_root_query_and_status():
    response = redirect_to({"root_path": "/api/app/example", "query_string": b"path=%2Fa%20b"}, "/read")
    assert response.status_code == 307
    assert response.headers["location"] == "/api/app/example/read?path=%2Fa%20b"
    require_method("GET", ("GET", "DELETE"))
    with pytest.raises(HTTPException) as failure:
        require_method("PATCH", ("GET", "DELETE"))
    assert failure.value.status_code == 405
    assert failure.value.headers == {"Allow": "GET, DELETE"}


def test_noop_lifespan_only_acknowledges_start_and_stop():
    async def run():
        events = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])
        sent = []
        async def receive():
            return next(events)
        async def send(message):
            sent.append(message)
        await noop_lifespan(receive, send)
        assert sent == [{"type": "lifespan.startup.complete"}, {"type": "lifespan.shutdown.complete"}]
    asyncio.run(run())


@pytest.mark.parametrize("exception", [HTTPException(404, "missing"), HTTPError(403, {"ok": False, "error": "denied"}, headers={"X-Test": "value"})])
def test_string_and_structured_errors_preserve_status_detail_headers(exception):
    async def run():
        return await resolve_http_response(AsyncMock(side_effect=exception), logger=logging.getLogger("test"), error_message="failed")
    response = asyncio.run(run())
    assert response.status_code == exception.status_code
    assert json.loads(response.body) == {"detail": exception.detail}
    if exception.headers:
        assert response.headers["x-test"] == "value"


def test_dispatch_disconnect_and_unexpected_error(caplog):
    async def run(exception):
        return await resolve_http_response(AsyncMock(side_effect=exception), logger=logging.getLogger("test"), error_message="failed")
    assert asyncio.run(run(ConnectionAbortedError())) is None
    response = asyncio.run(run(RuntimeError("broken")))
    assert response.status_code == 500
    assert response.body == b"Internal Server Error"
    assert "broken" in caplog.text


@pytest.fixture(params=["terminal", "file_editor", "file_explorer"])
def adopted_app(request):
    if request.param == "terminal":
        from app.apps.terminal.http_app import TerminalASGI
        return TerminalASGI()
    if request.param == "file_editor":
        from app.apps.file_editor.http_app import FileEditorASGI
        return FileEditorASGI()
    from app.apps.file_explorer.http_app import FileExplorerHTTP
    return FileExplorerHTTP(query_handler=AsyncMock(), commands={})


def test_stream_failure_after_start_never_emits_second_response(adopted_app, monkeypatch):
    class FailingStream(Response):
        async def __call__(self, scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"partial", "more_body": True})
            raise HTTPException(500, "stream broke")
    dispatch = AsyncMock(return_value=FailingStream())
    monkeypatch.setattr(adopted_app, "_dispatch", dispatch)
    async def run():
        sent = []
        async def send(message):
            sent.append(message)
        with pytest.raises(HTTPException, match="stream broke"):
            await adopted_app({"type": "http", "path": "/stream", "method": "GET"}, AsyncMock(), send)
        assert len([event for event in sent if event["type"] == "http.response.start"]) == 1
    asyncio.run(run())
    dispatch.assert_awaited_once()


def test_app_body_policy_and_file_explorer_decoder_parity():
    from app.apps.terminal.http_app import TerminalASGI, MAX_BODY_BYTES as terminal_limit
    from app.apps.file_editor.http_app import FileEditorASGI, MAX_BODY_BYTES as editor_limit
    from app.apps.file_explorer.http_app import FileExplorerHTTP, MAX_BODY_BYTES as explorer_limit
    assert terminal_limit == explorer_limit == 1024 * 1024
    assert editor_limit == 32 * 1024 * 1024
    terminal = TerminalASGI()
    explorer = FileExplorerHTTP(query_handler=AsyncMock(), commands={})
    async def run():
        scope = {"path": "/sidebar/window/state"}
        empty = lambda: AsyncMock(return_value={"type": "http.request", "body": b""})
        assert await terminal._body(scope, empty(), optional=True) is None
        assert await explorer._body(scope, empty()) == {}
        with pytest.raises(HTTPException):
            await FileEditorASGI()._body(scope, empty())
        result = await explorer._body(scope, AsyncMock(return_value={"type": "http.request", "body": '{"n":NaN}'.encode('utf-16')}))
        assert math.isnan(result["n"])
    asyncio.run(run())


def test_library_imports_no_app_runtime_or_schema_framework():
    script = '''
import sys
import app.libs.te2_asgi
assert not any(name == "fastapi" or name.startswith("fastapi.") or name == "pydantic"
               or name.startswith("app.apps.") or name in {"socketio", "uvicorn", "framework_shells"}
               for name in sys.modules)
'''
    subprocess.run([sys.executable, "-B", "-c", script], check=True, capture_output=True)
