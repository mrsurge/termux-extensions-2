# pyright: basic
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from app.apps.file_editor_cm6.ui_ipc.sidebar_mention_routing import (
    resolve_targeted_sidebar_mention,
)
from app.apps.file_editor_cm6.ui_ipc import sidebar_ws


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

    async def asyncTearDown(self) -> None:
        sidebar_ws._registered_hosts.clear()
        sidebar_ws._registered_iframes.clear()
        sidebar_ws._client_ids_by_sid.clear()
        sidebar_ws._app_ids_by_sid.clear()
        sidebar_ws._client_presentations.clear()

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
                "app.apps.file_editor_cm6.ui_ipc.sidebar_window_state.get_sidebar_window_state",
                return_value=_state(),
            ),
            patch(
                "app.apps.file_editor_cm6.ui_ipc.ui_ipc_socketio.UI_IPC_SIO",
                new=fake_server,
            ),
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
            "app.apps.file_editor_cm6.ui_ipc.sidebar_window_state.activate_sidebar_window",
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


if __name__ == "__main__":
    unittest.main()
