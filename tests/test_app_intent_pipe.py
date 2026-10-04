from __future__ import annotations

import asyncio
import threading
from unittest.mock import AsyncMock

import pytest

from app.apps.code_te2.app_intent_pipe import AppIntentPipe, dispatch_app_intent
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity


def request(identifier="intent"):
    return PipeEnvelope(kind="request", method="app.intent.deliver", id=identifier,
                        correlation_id=identifier, op_id="operation", origin_nid=1,
                        origin_name="framework.rust", params={
                            "intent": "document.open",
                            "context": {"clientId": "client_123456789abc", "hostId": "slot", "presentationId": "presentation"},
                            "payload": {"path": "/project/file"},
                            "source": {"appId": "file_explorer", "shellId": "owned-shell"},
                        })


def test_executes_on_domain_loop_and_replies_off_loop():
    async def run():
        loop = asyncio.get_running_loop()
        thread = threading.get_ident()
        replies = []
        done = asyncio.Event()

        async def handler(envelope):
            assert asyncio.get_running_loop() is loop
            assert threading.get_ident() == thread
            return {"ok": True}

        def reply(envelope):
            assert threading.get_ident() != thread
            replies.append(envelope)
            loop.call_soon_threadsafe(done.set)

        adapter = AppIntentPipe(identity=PipeIdentity(2100, "code_te2"), reply=reply, handler=handler)
        adapter.bind(loop)
        assert adapter.submit(request())
        await asyncio.wait_for(done.wait(), 2)
        assert replies[0].result == {"ok": True}
        assert replies[0].correlation_id == "intent"
        assert replies[0].target_name == "framework.rust"
        adapter.close()
    asyncio.run(run())


def test_rejects_wrong_origin_target_correlation_and_unavailable_loop():
    replies = []

    async def handler(envelope):
        pytest.fail("must not execute")

    adapter = AppIntentPipe(identity=PipeIdentity(2100, "code_te2"), reply=replies.append, handler=handler)
    assert not adapter.submit(PipeEnvelope(kind="request", method="other"))
    envelope = request(); envelope.origin_name = "forged"
    assert adapter.submit(envelope)
    envelope = request(); envelope.target_nid = 999
    assert adapter.submit(envelope)
    envelope = request(); envelope.correlation_id = "wrong"
    assert adapter.submit(envelope)
    assert adapter.submit(request())
    assert [reply.error.code for reply in replies] == ["appIntent.untrustedOrigin", "protocol.wrongTarget", "appIntent.invalidCorrelation", "appIntent.unavailable"]


def test_bounded_admission_and_shutdown_cancel_without_replay():
    async def run():
        started = asyncio.Event()
        gate = asyncio.Event()
        calls = []
        replies = []

        async def handler(envelope):
            calls.append(envelope.id)
            if len(calls) == 16:
                started.set()
            await gate.wait()

        adapter = AppIntentPipe(identity=PipeIdentity(2100, "code_te2"), reply=replies.append, handler=handler)
        adapter.bind(asyncio.get_running_loop())
        for index in range(16):
            assert adapter.submit(request(str(index)))
        assert adapter.submit(request("excess"))
        assert replies[0].error.code == "appIntent.busy"
        await asyncio.wait_for(started.wait(), 2)
        adapter.close()
        await asyncio.sleep(0)
        assert adapter.submit(request("after-close"))
        assert replies[-1].error.code == "appIntent.unavailable"
        assert len(calls) == 16
        assert all(reply.kind == "error" for reply in replies)
    asyncio.run(run())


def test_handler_failure_is_correlated_and_nonretryable():
    async def run():
        loop = asyncio.get_running_loop()
        done = asyncio.Event()
        replies = []

        async def handler(envelope):
            raise ValueError("rejected")

        def reply(envelope):
            replies.append(envelope)
            loop.call_soon_threadsafe(done.set)

        adapter = AppIntentPipe(identity=PipeIdentity(2100, "code_te2"), reply=reply, handler=handler)
        adapter.bind(loop)
        adapter.submit(request())
        await asyncio.wait_for(done.wait(), 2)
        assert replies[0].error.retryable is False
        assert "rejected" in replies[0].error.message
        assert replies[0].id == "intent"
        adapter.close()
    asyncio.run(run())


def test_document_adapter_reuses_shared_service_and_context_cannot_be_overridden(monkeypatch):
    from app.apps.code_te2.ui_ipc import sidebar_ws
    handler = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(sidebar_ws, "handle_sidebar_document_open", handler)
    assert asyncio.run(dispatch_app_intent(request())) == {"ok": True}
    params = handler.call_args.args[0]
    assert params["target"]["presentationId"] == "presentation"
    assert params["request_id"] == "operation"
    assert handler.call_args.kwargs == {"requester_app_id": "file_explorer", "require_presentation": True}
    envelope = request()
    envelope.params["payload"]["target"] = {"clientId": "other"}
    with pytest.raises(ValueError, match="belongs in context"):
        asyncio.run(dispatch_app_intent(envelope))


@pytest.mark.parametrize("failure", [None, "disconnected", "inactive", "stale", "cross-app"])
def test_shared_document_service_checks_live_ownership_before_open(monkeypatch, failure):
    from pathlib import Path
    from app.apps.code_te2.explorer.services import file_ops
    monkeypatch.setattr(file_ops, "get_project_root", lambda: Path('/project'))
    from app.apps.code_te2.ui_ipc import sidebar_ws, sidebar_window_state
    from app.apps.code_te2.host import file_ops_backend
    client = "client_123456789abc"
    monkeypatch.setattr(sidebar_ws, "_registered_hosts", {"host-sid"} if failure != "disconnected" else set())
    monkeypatch.setattr(sidebar_ws, "_client_ids_by_sid", {"host-sid": client})
    monkeypatch.setattr(sidebar_ws, "_client_active_windows", {client: "slot" if failure != "inactive" else "other"})
    monkeypatch.setattr(sidebar_ws, "_client_presentations", {(client, "slot"): "presentation" if failure != "stale" else "new-presentation"})
    monkeypatch.setattr(sidebar_window_state, "get_sidebar_window_state", lambda: {
        "slots": {"slot": {"app_id": "file_explorer" if failure != "cross-app" else "terminal"}},
    })
    opened = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(file_ops_backend, "handle_host_open_request", opened)
    from app.apps.code_te2.ui_ipc import notifications
    monkeypatch.setattr(notifications, "emit_ui_ipc_rpc_notification", AsyncMock())
    if failure is not None:
        with pytest.raises(ValueError):
            asyncio.run(dispatch_app_intent(request()))
        opened.assert_not_awaited()
    else:
        assert asyncio.run(dispatch_app_intent(request())) == {"ok": True}
        assert opened.call_args.kwargs["source_name"] == client
        assert opened.call_args.args[0]["focus"] is False
    envelope = request(); envelope.params["intent"] = "terminal.createSession"
    with pytest.raises(ValueError, match="invalid terminal intent payload"):
        asyncio.run(dispatch_app_intent(envelope))
