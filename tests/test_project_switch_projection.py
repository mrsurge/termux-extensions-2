from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import project_switch_events
from app.apps.code_te2.explorer.services import project_switch
from app.apps.code_te2.monaco_editor import editor_client_registry, editor_ws
from app.apps.code_te2.open_state_backend import ClientForegroundPayload
from app.apps.code_te2.worker_services.event_bus import build_event


CLIENT_A = "client_aaaaaaaaaaaa"
CLIENT_B = "client_bbbbbbbbbbbb"


class ProjectSwitchProjectionTests(unittest.TestCase):
    def test_connected_editor_clients_are_unique_and_stable(self) -> None:
        sid_values = ("test-sid-a1", "test-sid-b", "test-sid-a2")
        try:
            editor_client_registry.register_editor_client(
                sid_values[0],
                {"clientInstanceId": CLIENT_A, "windowId": None},
            )
            editor_client_registry.register_editor_client(
                sid_values[1],
                {"clientInstanceId": CLIENT_B, "windowId": None},
            )
            editor_client_registry.register_editor_client(
                sid_values[2],
                {"clientInstanceId": CLIENT_A, "windowId": None},
            )
            self.assertEqual(
                editor_client_registry.connected_editor_client_instance_ids(),
                (CLIENT_A, CLIENT_B),
            )
        finally:
            for sid in sid_values:
                editor_client_registry.unregister_editor_client(sid)

    def test_replay_projects_each_clients_own_snapshot(self) -> None:
        shared_open_state: dict[str, object] = {
            "projectPath": "/workspace/new-project",
            "openFile": None,
            "recents": [],
            "revision": 4,
            "reason": "project_open",
        }
        snapshots = {
            CLIENT_A: {
                "project": "/workspace/new-project",
                "currentPath": "/workspace/new-project/a.py",
                "clientForeground": {
                    "clientInstanceId": CLIENT_A,
                    "projectPath": "/workspace/new-project",
                    "path": "/workspace/new-project/a.py",
                },
                "file": {"path": "/workspace/new-project/a.py", "content": "a\n"},
            },
            CLIENT_B: {
                "project": "/workspace/new-project",
                "currentPath": None,
                "clientForeground": {
                    "clientInstanceId": CLIENT_B,
                    "projectPath": "/workspace/new-project",
                    "path": None,
                },
            },
        }
        emitted: list[tuple[str, dict[str, object]]] = []
        published_foregrounds: list[ClientForegroundPayload] = []

        async def emit_snapshot(
            _method: str,
            payload: dict[str, object],
            *,
            room: str,
        ) -> None:
            emitted.append((room, payload))

        async def publish_foreground(
            _open_state: object,
            foreground: ClientForegroundPayload,
            **_kwargs: object,
        ) -> None:
            published_foregrounds.append(foreground)

        def build_snapshot(
            *,
            client_instance_id: str,
            reason: str,
        ) -> dict[str, object]:
            del reason
            return dict(snapshots[client_instance_id])

        with (
            patch.object(editor_ws, "read_sidecar_open_state", return_value=shared_open_state),
            patch.object(
                editor_ws,
                "connected_editor_client_instance_ids",
                return_value=(CLIENT_A, CLIENT_B),
            ),
            patch.object(
                editor_ws,
                "editor_runtime_build_connect_snapshot",
                side_effect=build_snapshot,
            ),
            patch.object(
                editor_ws,
                "publish_open_state_changed",
                new=AsyncMock(),
            ) as publish_shared,
            patch.object(
                editor_ws,
                "publish_client_foreground_changed",
                side_effect=publish_foreground,
            ),
            patch.object(
                editor_ws,
                "_emit_editor_rpc_notification_to_room",
                side_effect=emit_snapshot,
            ),
        ):
            result = asyncio.run(
                editor_ws.editor_runtime_replay_sidecar_open_state(
                    "/workspace/new-project",
                    reason="project_open",
                    source="test",
                    project_generation=7,
                )
            )

        self.assertEqual(result, shared_open_state)
        publish_shared.assert_awaited_once()
        self.assertEqual(
            [room for room, _snapshot in emitted],
            [
                "code_te2:client:client_aaaaaaaaaaaa",
                "code_te2:client:client_bbbbbbbbbbbb",
            ],
        )
        self.assertEqual(emitted[0][1]["currentPath"], "/workspace/new-project/a.py")
        self.assertIsNone(emitted[1][1]["currentPath"])
        self.assertEqual(
            [foreground["clientInstanceId"] for foreground in published_foregrounds],
            [CLIENT_A, CLIENT_B],
        )

    def test_finished_switch_fans_out_one_explorer_projection(self) -> None:
        event = build_event(
            "ProjectSwitchFinished",
            project_root="/workspace/new-project",
            project_generation=9,
            source="test",
            correlation_id="switch-9",
            payload={
                "displayPath": "~/new-project",
                "new_sidecar": False,
                "openState": {
                    "projectPath": "/workspace/new-project",
                    "recents": [],
                },
            },
        )
        explorer_emissions: list[tuple[str, dict[str, object]]] = []

        async def emit_explorer(method: str, payload: dict[str, object]) -> None:
            explorer_emissions.append((method, payload))

        with (
            patch.object(
                project_switch_events,
                "_emit_project_switch_notification",
                new=AsyncMock(),
            ),
            patch(
                "app.apps.code_te2.explorer.transport.rpc_emit.emit_explorer_rpc_notification",
                side_effect=emit_explorer,
            ),
        ):
            asyncio.run(project_switch_events._handle_project_switch_finished_event(event))

        self.assertEqual(len(explorer_emissions), 1)
        method, payload = explorer_emissions[0]
        self.assertEqual(method, "explorer.project.opened")
        self.assertEqual(payload["path"], "~/new-project")
        self.assertEqual(payload["resolved_path"], "/workspace/new-project")
        self.assertEqual(payload["switchId"], "switch-9")

    def test_failed_replay_never_publishes_switch_finished(self) -> None:
        published_types: list[str] = []

        async def record_event(event: dict[str, object]) -> None:
            published_types.append(cast(str, event["type"]))

        with (
            patch.object(project_switch, "set_project_root", return_value=Path("/workspace/new")),
            patch.object(project_switch, "next_project_generation", return_value=11),
            patch.object(project_switch, "publish", side_effect=record_event),
            patch.object(project_switch, "reset_project_session", new=AsyncMock(return_value=False)),
            patch.object(project_switch.manager, "reassign_all"),
            patch.object(project_switch, "_reset_project_diagnostics", new=AsyncMock()),
            patch.object(project_switch, "_start_project_watchexec_if_needed", new=AsyncMock()),
            patch.object(
                project_switch,
                "_replay_sidecar_open_state",
                new=AsyncMock(side_effect=RuntimeError("replay failed")),
            ),
            patch.object(project_switch, "_broadcast_project_git_state", new=AsyncMock()),
        ):
            with self.assertRaisesRegex(RuntimeError, "replay failed"):
                asyncio.run(
                    project_switch.switch_project_connection(
                        None,
                        "/workspace/new",
                        initialize_watcher=False,
                        switch_adapter_workspace=False,
                    )
                )

        self.assertEqual(published_types, ["ProjectSwitchStarted"])


if __name__ == "__main__":
    unittest.main()
