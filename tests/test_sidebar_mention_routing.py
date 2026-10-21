# pyright: basic
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.ui_ipc.sidebar_mention_routing import (
    bind_sidebar_mention_client,
    resolve_targeted_sidebar_mention,
)
from app.apps.code_te2.ui_ipc import sidebar_ws


def _state(
    *,
    host_id: str = "agent-slot",
    app_id: str = "als-rs",
    state_kind: str = "conversation",
    conversation_id: str = "conversation-a",
) -> dict[str, object]:
    return {
        "version": 2,
        "slots": {
            host_id: {
                "host_id": host_id,
                "app_id": app_id,
                "state_kind": state_kind,
                "query_state": {"conversation_id": conversation_id},
                "url": (
                    "/app/als-rs?embed=1"
                    f"&te2_host_id={host_id}&conversation_id={conversation_id}"
                ),
            }
        },
    }


def _payload() -> dict[str, object]:
    return {
        "path": "/project/main.py",
        "source": "editor",
        "conversation_id": "caller-controlled",
        "target": {
            "clientId": "client-a",
            "hostId": "agent-slot",
            "presentationId": "inline-agent-slot-1",
        },
    }


def _presentations() -> dict[tuple[str, str], str]:
    return {("client-a", "agent-slot"): "inline-agent-slot-1"}


class SidebarMentionRoutingTests(unittest.TestCase):
    def test_paths_are_not_ids_and_oversized_ids_are_rejected_not_truncated(self) -> None:
        payload = _payload()
        path = "/project/" + "long/" * 120 + "file.py"
        payload["path"] = path
        _, routed = resolve_targeted_sidebar_mention(payload, sidebar_state=_state(),
            live_host_client_ids={"client-a"}, registered_peer_app_ids={"als-rs"},
            registered_presentations=_presentations())
        self.assertEqual(routed["path"], path)
        payload["target"] = {"clientId": "x" * 513, "hostId": "agent-slot", "presentationId": "inc"}
        with self.assertRaisesRegex(ValueError, "identity exceeds"):
            resolve_targeted_sidebar_mention(payload, sidebar_state=_state(),
                live_host_client_ids={"client-a"}, registered_peer_app_ids={"als-rs"},
                registered_presentations=_presentations())

    def test_caller_binding_rejects_another_live_clients_target(self) -> None:
        payload = _payload()
        with self.assertRaisesRegex(ValueError, "requesting client"):
            bind_sidebar_mention_client(payload, "client-b")
        self.assertEqual(bind_sidebar_mention_client(payload, "client-a")["target"],
                         {"clientId": "client-a", "client_id": "client-a",
                          "hostId": "agent-slot", "presentationId": "inline-agent-slot-1"})

    def test_two_clients_keep_their_own_mru_slot_and_conversation(self) -> None:
        a = _state(host_id="slot-a", conversation_id="conversation-a")
        b = _state(host_id="slot-b", conversation_id="conversation-b")
        a["slots"].update(b["slots"])
        presentations = {("client-a", "slot-a"): "p-a", ("client-b", "slot-b"): "p-b"}
        for client, host, presentation, conversation in [
            ("client-a", "slot-a", "p-a", "conversation-a"),
            ("client-b", "slot-b", "p-b", "conversation-b"),
        ]:
            payload = {"path": "/project/file.py", "conversation_id": "wrong-global",
                       "target": {"clientId": client, "hostId": host, "presentationId": presentation}}
            _, routed = resolve_targeted_sidebar_mention(
                bind_sidebar_mention_client(payload, client), sidebar_state=a,
                live_host_client_ids={"client-a", "client-b"}, registered_peer_app_ids={"als-rs"},
                registered_presentations=presentations)
            self.assertEqual(routed["conversation_id"], conversation)

    def test_resolves_conversation_from_authoritative_slot(self) -> None:
        app_id, routed = resolve_targeted_sidebar_mention(
            _payload(),
            sidebar_state=_state(),
            live_host_client_ids={"client-a"},
            registered_peer_app_ids={"als_rs"},
            registered_presentations=_presentations(),
        )

        self.assertEqual("als-rs", app_id)
        self.assertEqual("conversation-a", routed["conversation_id"])
        self.assertEqual("conversation-a", routed["conversationId"])
        target = routed["target"]
        self.assertIsInstance(target, dict)
        assert isinstance(target, dict)
        self.assertEqual("client-a", target["client_id"])
        self.assertEqual("agent-slot", target["host_id"])
        self.assertEqual("inline-agent-slot-1", target["presentation_id"])

    def test_uses_slot_url_when_query_state_is_missing(self) -> None:
        state = _state(conversation_id="conversation-url")
        slot = state["slots"]
        assert isinstance(slot, dict)
        entry = slot["agent-slot"]
        assert isinstance(entry, dict)
        entry["query_state"] = {}

        _, routed = resolve_targeted_sidebar_mention(
            _payload(),
            sidebar_state=state,
            live_host_client_ids={"client-a"},
            registered_peer_app_ids={"als-rs"},
            registered_presentations=_presentations(),
        )

        self.assertEqual("conversation-url", routed["conversation_id"])

    def test_rejects_disconnected_client(self) -> None:
        with self.assertRaisesRegex(ValueError, "client is not connected"):
            resolve_targeted_sidebar_mention(
                _payload(),
                sidebar_state=_state(),
                live_host_client_ids=set(),
                registered_peer_app_ids={"als-rs"},
                registered_presentations=_presentations(),
            )

    def test_rejects_stale_or_unregistered_presentation(self) -> None:
        with self.assertRaisesRegex(ValueError, "presentation is not registered"):
            resolve_targeted_sidebar_mention(
                _payload(),
                sidebar_state=_state(),
                live_host_client_ids={"client-a"},
                registered_peer_app_ids={"als-rs"},
                registered_presentations={
                    ("client-a", "agent-slot"): "detached-agent-slot-2"
                },
            )

    def test_rejects_missing_or_non_agent_slot(self) -> None:
        with self.assertRaisesRegex(ValueError, "window is not active"):
            resolve_targeted_sidebar_mention(
                _payload(),
                sidebar_state=_state(host_id="different-slot"),
                live_host_client_ids={"client-a"},
                registered_peer_app_ids={"als-rs"},
                registered_presentations=_presentations(),
            )

        with self.assertRaisesRegex(ValueError, "not an agent conversation"):
            resolve_targeted_sidebar_mention(
                _payload(),
                sidebar_state=_state(app_id="terminal", state_kind="shell"),
                live_host_client_ids={"client-a"},
                registered_peer_app_ids={"terminal"},
                registered_presentations=_presentations(),
            )

    def test_rejects_unregistered_target_peer(self) -> None:
        with self.assertRaisesRegex(ValueError, "no registered Sidebar peer"):
            resolve_targeted_sidebar_mention(
                _payload(),
                sidebar_state=_state(),
                live_host_client_ids={"client-a"},
                registered_peer_app_ids=set(),
                registered_presentations=_presentations(),
            )


class _FakeSidebarServer:
    def __init__(self) -> None:
        self.emissions: list[dict[str, object]] = []

    async def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        skip_sid: str | None = None,
        namespace: str | None = None,
    ) -> None:
        self.emissions.append(
            {
                "event": event,
                "data": data,
                "to": to,
                "room": room,
                "skip_sid": skip_sid,
                "namespace": namespace,
            }
        )

    async def enter_room(self, sid: str, room: str) -> None:
        del sid, room
        return None

    async def save_session(
        self, sid: str, session: dict[str, object]
    ) -> None:
        del sid, session
        return None

    async def get_session(self, sid: str) -> object:
        del sid
        return {}


class SidebarMentionEmissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        sidebar_ws._registered_hosts.clear()
        sidebar_ws._registered_iframes.clear()
        sidebar_ws._client_ids_by_sid.clear()
        sidebar_ws._app_ids_by_sid.clear()
        sidebar_ws._client_presentations.clear()
        sidebar_ws._client_active_windows.clear()
        sidebar_ws._client_active_shortcuts.clear()

    async def asyncTearDown(self) -> None:
        sidebar_ws._registered_hosts.clear()
        sidebar_ws._registered_iframes.clear()
        sidebar_ws._client_ids_by_sid.clear()
        sidebar_ws._app_ids_by_sid.clear()
        sidebar_ws._client_presentations.clear()
        sidebar_ws._client_active_windows.clear()
        sidebar_ws._client_active_shortcuts.clear()

    async def test_emits_only_to_target_app_room(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._registered_hosts.add("host-sid")
        sidebar_ws._registered_iframes.add("agent-sid")
        sidebar_ws._client_ids_by_sid["host-sid"] = "client-a"
        sidebar_ws._app_ids_by_sid["agent-sid"] = "als-rs"
        sidebar_ws._client_presentations[("client-a", "agent-slot")] = (
            "inline-agent-slot-1"
        )

        with (
            patch(
                "app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state",
                return_value=_state(),
            ),
            patch(
                "app.apps.code_te2.ui_ipc.ui_ipc_socketio.UI_IPC_SIO",
                new=fake_server,
            ),
            patch.object(sidebar_ws, "als_route_available", new=AsyncMock(return_value=False)),
        ):
            result = await sidebar_ws.emit_sidebar_mention_targeted(_payload())

        self.assertTrue(result["ok"])
        self.assertEqual(1, len(fake_server.emissions))
        emission: dict[str, Any] = fake_server.emissions[0]
        self.assertEqual("sidebar:app:als-rs", emission["room"])
        self.assertNotEqual("sidebar_ipc", emission["room"])

    async def test_presentation_registration_is_exact_and_reversible(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._registered_hosts.add("host-sid")
        sidebar_ws._client_ids_by_sid["host-sid"] = "client-a"
        with patch(
            "app.apps.code_te2.ui_ipc.sidebar_window_state.activate_sidebar_window",
            return_value={"ok": True},
        ) as activate:
            registered = (
                await sidebar_ws.handle_sidebar_window_presentation_update_request(
                    fake_server,
                    "host-sid",
                    {
                        "clientId": "spoofed-client",
                        "hostId": "agent-slot",
                        "presentationId": "inline-agent-slot-1",
                    }
                )
            )

        activate.assert_called_once_with({"host_id": "agent-slot"})
        self.assertTrue(registered["registered"])
        self.assertEqual(
            "inline-agent-slot-1",
            sidebar_ws._client_presentations[("client-a", "agent-slot")],
        )
        self.assertNotIn(
            ("spoofed-client", "agent-slot"),
            sidebar_ws._client_presentations,
        )

        released = await sidebar_ws.handle_sidebar_window_presentation_update_request(
            fake_server,
            "host-sid",
            {
                "hostId": "agent-slot",
                "presentationId": "",
            }
        )
        self.assertFalse(released["registered"])
        self.assertNotIn(
            ("client-a", "agent-slot"), sidebar_ws._client_presentations
        )

    async def test_host_disconnect_releases_client_presentations(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._registered_hosts.add("host-sid")
        sidebar_ws._client_ids_by_sid["host-sid"] = "client-a"
        sidebar_ws._client_presentations[("client-a", "agent-slot")] = (
            "inline-agent-slot-1"
        )

        await sidebar_ws.on_sidebar_disconnect(fake_server, "host-sid")

        self.assertNotIn(
            ("client-a", "agent-slot"), sidebar_ws._client_presentations
        )

    async def test_reconnect_restores_only_own_foreground_without_shared_mutation(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._registered_hosts.update({"host-a", "host-b"})
        sidebar_ws._client_ids_by_sid.update({"host-a": "client-a", "host-b": "client-b"})
        sidebar_ws._client_active_windows["client-b"] = "other-slot"
        with patch(
            "app.apps.code_te2.ui_ipc.sidebar_window_state.activate_sidebar_window",
            return_value={"ok": True},
        ):
            await sidebar_ws.handle_sidebar_window_presentation_update_request(
                fake_server, "host-a", {"clientId": "spoofed", "hostId": "agent-slot",
                                        "presentationId": "p-a", "active": True},
            )
            await sidebar_ws.handle_sidebar_window_presentation_update_request(
                fake_server, "host-a", {"hostId": "inactive-slot",
                                        "presentationId": "p-inactive", "active": False},
            )
        self.assertEqual(sidebar_ws._client_active_windows,
                         {"client-a": "agent-slot", "client-b": "other-slot"})
        self.assertEqual(fake_server.emissions, [])

    async def test_old_sid_disconnect_keeps_reconnected_host_then_last_disconnect_clears(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._registered_hosts.update({"old-host", "new-host"})
        sidebar_ws._client_ids_by_sid.update({"old-host": "client-a", "new-host": "client-a"})
        sidebar_ws._client_presentations[("client-a", "agent-slot")] = "new-presentation"
        sidebar_ws._client_active_windows["client-a"] = "agent-slot"
        await sidebar_ws.on_sidebar_disconnect(fake_server, "old-host")
        self.assertEqual(sidebar_ws._client_presentations[("client-a", "agent-slot")],
                         "new-presentation")
        self.assertEqual(sidebar_ws._client_active_windows["client-a"], "agent-slot")
        await sidebar_ws.on_sidebar_disconnect(fake_server, "new-host")
        self.assertNotIn(("client-a", "agent-slot"), sidebar_ws._client_presentations)
        self.assertNotIn("client-a", sidebar_ws._client_active_windows)

    async def test_socket_file_open_requires_supplied_presentation(self) -> None:
        fake_server = _FakeSidebarServer()
        sidebar_ws._app_ids_by_sid["als-sid"] = "als-rs"
        payload = _payload()
        with patch.object(sidebar_ws, "handle_sidebar_document_open", return_value={"ok": True}) as open_document:
            await sidebar_ws._dispatch_sidebar_rpc_request(
                fake_server, "als-sid", "sidebar.file.open", payload,
            )
        open_document.assert_awaited_once_with(
            payload, requester_app_id="als-rs", require_presentation=True,
        )

    async def test_document_owner_allows_exact_presentation_without_relaxing_other_intents(self) -> None:
        client = "client_123456789abc"
        sidebar_ws._registered_hosts.add("host-sid")
        sidebar_ws._client_ids_by_sid["host-sid"] = client
        sidebar_ws._client_presentations[(client, "agent-slot")] = "inline-agent-slot-1"
        payload = _payload()
        target = payload["target"]
        assert isinstance(target, dict)
        target["clientId"] = client
        open_host = AsyncMock(return_value={"ok": True, "surface": "sidebar"})
        with patch(
            "app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state",
            return_value=_state(),
        ), patch(
            "app.apps.code_te2.host.file_ops_backend.handle_host_open_request", new=open_host,
        ):
            for require_presentation in (False, True):
                result = await sidebar_ws.handle_sidebar_document_open(
                    payload, requester_app_id="als-rs", require_presentation=require_presentation,
                )
                self.assertEqual(result, {"ok": True})
            with self.assertRaisesRegex(ValueError, "window is not active"):
                sidebar_ws.resolve_sidebar_request_client(
                    payload, requester_app_id="als-rs", require_presentation=True,
                )
        self.assertEqual(open_host.await_count, 2)
        self.assertEqual(open_host.call_args.kwargs["source_name"], client)
        self.assertEqual(sidebar_ws._client_active_windows, {})


if __name__ == "__main__":
    unittest.main()
