from __future__ import annotations

import unittest
from typing import final, override

from app.apps.code_te2.ui_ipc.sidebar_file_open_routing import (
    resolve_sidebar_file_open_target,
)


@final
class SidebarFileOpenRoutingTests(unittest.TestCase):
    @override
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.payload: dict[str, object] = {}
        self.state: dict[str, object] = {}
        self.presentations: dict[tuple[str, str], str] = {}
        self.active: dict[str, str] = {}

    @override
    def setUp(self) -> None:
        self.payload = {
            "path": "/project/main.py",
            "target": {
                "clientId": "client_123456789abc",
                "hostId": "slot:als-rs:worker",
            },
        }
        self.state = {
            "slots": {
                "slot:als-rs:worker": {
                    "host_id": "slot:als-rs:worker",
                    "app_id": "als_rs",
                }
            }
        }
        self.presentations = {
            ("client_123456789abc", "slot:als-rs:worker"): "iframe_1"
        }
        self.active = {"client_123456789abc": "slot:als-rs:worker"}

    def resolve(self) -> tuple[str, dict[str, object]]:
        return resolve_sidebar_file_open_target(
            self.payload,
            sidebar_state=self.state,
            live_host_client_ids={"client_123456789abc"},
            registered_presentations=self.presentations,
            active_windows=self.active,
            requester_app_id="als-rs",
        )

    def test_resolves_registered_active_presentation(self) -> None:
        client_id, routed = self.resolve()
        self.assertEqual("client_123456789abc", client_id)
        target = routed["target"]
        self.assertIsInstance(target, dict)
        assert isinstance(target, dict)
        self.assertEqual("iframe_1", target["presentationId"])

    def test_rejects_stale_window_target(self) -> None:
        self.active["client_123456789abc"] = "slot:other"
        with self.assertRaisesRegex(ValueError, "window is not active"):
            _ = self.resolve()

    def test_rejects_unregistered_presentation(self) -> None:
        self.presentations.clear()
        with self.assertRaisesRegex(ValueError, "presentation is not registered"):
            _ = self.resolve()

    def test_rejects_cross_app_target(self) -> None:
        self.state["slots"] = {
            "slot:als-rs:worker": {"app_id": "another-app"}
        }
        with self.assertRaisesRegex(ValueError, "does not belong"):
            _ = self.resolve()

    def test_pipe_requires_matching_live_presentation(self) -> None:
        for supplied in (None, "old-incarnation", "iframe_1"):
            target = self.payload["target"]
            assert isinstance(target, dict)
            target["presentationId"] = supplied
            def resolve_pipe():
                return resolve_sidebar_file_open_target(
                    self.payload, sidebar_state=self.state,
                    live_host_client_ids={"client_123456789abc"},
                    registered_presentations=self.presentations, active_windows=self.active,
                    requester_app_id="als-rs", require_presentation=True,
                )
            if supplied == "iframe_1":
                self.assertEqual(resolve_pipe()[0], "client_123456789abc")
            else:
                with self.assertRaisesRegex(ValueError, "presentation is stale"):
                    resolve_pipe()

    def test_same_shared_slot_routes_independently_for_each_client(self) -> None:
        clients = ("client_111111111111", "client_222222222222")
        for client in clients:
            target = {"clientId": client, "hostId": "slot:als-rs:worker",
                      "presentationId": f"p-{client}"}
            resolved, routed = resolve_sidebar_file_open_target(
                {"path": "/project/main.py", "target": target}, sidebar_state=self.state,
                live_host_client_ids=set(clients),
                registered_presentations={
                    (c, "slot:als-rs:worker"): f"p-{c}" for c in clients},
                active_windows={c: "slot:als-rs:worker" for c in clients},
                requester_app_id="als-rs", require_presentation=True,
            )
            self.assertEqual(resolved, client)
            routed_target = routed["target"]
            assert isinstance(routed_target, dict)
            self.assertEqual(routed_target["presentationId"], f"p-{client}")


if __name__ == "__main__":
    _ = unittest.main()
