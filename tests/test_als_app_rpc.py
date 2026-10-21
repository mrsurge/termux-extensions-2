from __future__ import annotations

import unittest
from collections.abc import Callable
from unittest.mock import AsyncMock, patch

import msgspec

from app.libs import app_rpc
from app.apps.code_te2.host import sidebar_rpc_backend as service, sidebar_pipe
from app.apps.code_te2.ui_ipc import sidebar_ws


def delivery(method: str, payload: dict[str, object]) -> dict[str, object]:
    return {"service": "sidebar", "version": 1, "method": method, "context": None,
            "payload": payload, "source": {"appId": "als-rs", "shellId": "owned"}}


class AlsAppRpcTests(unittest.IsolatedAsyncioTestCase):
    async def test_route_query_is_read_only_and_receipts_are_validated(self) -> None:
        call = AsyncMock(return_value={"appId": "als-rs", "available": True})
        with patch.object(app_rpc.pipe_runtime, "call_async", call):
            self.assertTrue(await app_rpc.app_rpc_route_available("als-rs", "sidebar", "mention"))
            self.assertEqual(call.await_args.args[0], "app.rpc.route.get")
            self.assertIsNone(call.await_args.args[1]["payload"])
            for result in [{"available": True}, {"appId": "als-rs", "available": 1}, None]:
                call.return_value = result
                with self.assertRaises(msgspec.ValidationError):
                    await app_rpc.app_rpc_route_available("als-rs", "sidebar", "mention")

    async def test_file_open_reuses_exact_presentation_owner_only_for_als(self) -> None:
        params: dict[str, object] = {"path": "/project/file", "line": 3,
            "target": {"clientId": "a", "hostId": "slot", "presentationId": "inc"}}
        opened = AsyncMock(return_value={"ok": True})
        with patch.object(sidebar_ws, "handle_sidebar_document_open", opened):
            self.assertEqual(await service.dispatch_sidebar_service(delivery("file.open", params)), {"ok": True})
            opened.assert_awaited_once_with(params, requester_app_id="als-rs", require_presentation=True)
            opened.reset_mock()
            body = delivery("file.open", params)
            body["source"] = {"appId": "terminal", "shellId": "owned"}
            with self.assertRaises(ValueError):
                await service.dispatch_sidebar_service(body)
            opened.assert_not_awaited()
            with self.assertRaises(msgspec.ValidationError):
                await service.dispatch_sidebar_service(delivery("file.open", {"path": "/file"}))

    async def test_project_rechecks_caller_and_never_synthesizes_a_global_target(self) -> None:
        from app.apps.code_te2.host import project_backend
        params: dict[str, object] = {"path": "/project", "target": {
            "clientId": "a", "hostId": "slot", "presentationId": "inc"}}
        checks: list[dict[str, object]] = []
        def validate(data: dict[str, object], *, requester_app_id: str, require_presentation: bool) -> tuple[str, dict[str, object]]:
            self.assertEqual(requester_app_id, "als-rs")
            self.assertTrue(require_presentation)
            checks.append(data)
            if len(checks) == 2:
                raise ValueError("presentation closed during lock wait")
            return "a", data
        async def open_project(data: dict[str, object], *, source_name: str, before_switch: Callable[[], None] | None = None) -> dict[str, object]:
            self.assertEqual(source_name, "als_pipe")
            self.assertIsNotNone(before_switch)
            if before_switch is not None:
                before_switch()
            self.fail("must recheck before project mutation")
        with patch.object(sidebar_ws, "resolve_sidebar_request_client", validate), patch.object(project_backend, "handle_sidebar_project_open_request", open_project):
            with self.assertRaisesRegex(ValueError, "closed during"):
                await service.dispatch_sidebar_service(delivery("project.open", params))
        self.assertEqual(len(checks), 2)
        self.assertIsNone(sidebar_pipe.originating_app.get())

    async def test_draft_and_review_calls_keep_existing_owners_and_authenticated_source(self) -> None:
        from app.apps.code_te2.host import draft_state_backend, agent_edit_review_backend
        for method, module, name in [
            ("drafts.list", draft_state_backend, "handle_sidebar_drafts_list_request"),
            ("draftState.get", draft_state_backend, "handle_sidebar_draft_state_get_request"),
            ("draft.clear", draft_state_backend, "handle_sidebar_draft_clear_request"),
            ("agentEdits.publish", agent_edit_review_backend, "handle_sidebar_agent_edits_publish_request"),
            ("agentEdits.clear", agent_edit_review_backend, "handle_sidebar_agent_edits_clear_request"),
            ("agentEdits.list", agent_edit_review_backend, "handle_sidebar_agent_edits_list_request"),
            ("agentEdits.documentState.get", agent_edit_review_backend, "handle_sidebar_agent_edits_document_state_get_request"),
            ("agentEdits.decide", agent_edit_review_backend, "handle_sidebar_agent_edits_decide_request"),
        ]:
            async def owner(data: dict[str, object], *, source_name: str) -> dict[str, object]:
                self.assertEqual(sidebar_pipe.originating_app.get(), "als-rs")
                self.assertEqual(source_name, "als_pipe")
                return {"ok": True, **data}
            with patch.object(module, name, owner):
                self.assertEqual(await service.dispatch_sidebar_service(delivery(method, {"proof": method})), {"ok": True, "proof": method})
        self.assertIsNone(sidebar_pipe.originating_app.get())

    async def test_pipe_mentions_route_two_clients_and_never_fall_through_after_failure(self) -> None:
        slots = {f"slot-{client}": {"app_id": "als-rs", "state_kind": "conversation",
                  "query_state": {"conversation_id": f"conversation-{client}"}} for client in ["a", "b"]}
        io = AsyncMock()
        async def accept(method: str, payload: dict[str, object]) -> dict[str, object]:
            self.assertEqual(method, "mention")
            return {"ok": True, "queued": False, "conversation_id": payload["conversation_id"], "operation_id": "receipt"}
        call = AsyncMock(side_effect=accept)
        with (
            patch.object(sidebar_ws, "_registered_hosts", {"a", "b"}),
            patch.object(sidebar_ws, "_client_ids_by_sid", {"a": "client-a", "b": "client-b"}),
            patch.object(sidebar_ws, "_registered_iframes", set()),
            patch.object(sidebar_ws, "_app_ids_by_sid", {}),
            patch.object(sidebar_ws, "_client_presentations", {("client-a", "slot-a"): "inc-a", ("client-b", "slot-b"): "inc-b"}),
            patch.object(sidebar_ws, "als_route_available", AsyncMock(return_value=True)),
            patch.object(sidebar_ws, "call_als", call),
            patch("app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state", return_value={"slots": slots}),
            patch("app.apps.code_te2.ui_ipc.ui_ipc_socketio.UI_IPC_SIO", io),
        ):
            for client in ["a", "b"]:
                payload: dict[str, object] = {"path": "/project/file", "conversation_id": "forged",
                    "target": {"clientId": f"client-{client}", "hostId": f"slot-{client}", "presentationId": f"inc-{client}"}}
                receipt = await sidebar_ws.emit_sidebar_mention_targeted(payload)
                self.assertEqual(receipt["conversation_id"], f"conversation-{client}")
            call.side_effect = TimeoutError("accepted outcome unknown")
            with self.assertRaises(TimeoutError):
                await sidebar_ws.emit_sidebar_mention_targeted(payload)
            self.assertEqual(call.await_count, 3)
            io.emit.assert_not_awaited()
            call.reset_mock()
            with self.assertRaises(ValueError):
                await sidebar_ws.emit_sidebar_mention_targeted({"path": "/file", "target": {"clientId": "client-a", "hostId": "slot-a", "presentationId": "stale"}})
            call.assert_not_awaited()

    async def test_reverse_review_does_not_echo_to_originating_app(self) -> None:
        query = AsyncMock(return_value=True)
        token = sidebar_pipe.originating_app.set("als-rs")
        try:
            with patch.object(sidebar_ws, "als_route_available", query), patch.object(sidebar_ws, "_agent_edit_peer_sids", set()):
                result = await sidebar_ws.request_agent_edit_document_state_from_peers({"uri": "file:///proof"})
                self.assertFalse(result["ok"])
                query.assert_not_awaited()
        finally:
            sidebar_pipe.originating_app.reset(token)

    async def test_projection_failure_does_not_replay_or_authorize_socket_fallback(self) -> None:
        call = AsyncMock(side_effect=TimeoutError("unknown"))
        with patch.object(sidebar_pipe, "als_route_available", AsyncMock(return_value=True)), patch.object(sidebar_pipe, "call_als", call):
            self.assertTrue(await sidebar_pipe.publish_als_fact("cwd.set", {"cwd": "/project"}))
            call.assert_awaited_once()

    async def test_project_notice_does_not_send_a_whole_boot_snapshot_back_to_als(self) -> None:
        fact = AsyncMock(return_value=True)
        io = AsyncMock()
        payload: dict[str, object] = {"ok": True, "path": "/project", "resolved_path": "/project",
                                    "state": {"unused": "x" * 70000}}
        with patch.object(sidebar_ws, "publish_als_fact", fact):
            await sidebar_ws._emit_project_opened(io, payload)
        self.assertEqual(fact.await_args.args[0], "project.opened")
        self.assertNotIn("state", fact.await_args.args[1])
        self.assertEqual(fact.await_args.args[1]["resolved_path"], "/project")
        io.emit.assert_awaited_once()
