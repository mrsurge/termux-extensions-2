from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import AsyncMock, call, patch

from app.apps.code_te2 import workbench_adapter_shell_manager as manager
from app.apps.code_te2 import workbench_document_initialization as initialization


class WorkbenchAdapterShellAdoptionTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self) -> None:
        manager._set_adapter_state("idle")

    def test_shellspec_invokes_the_resolved_node_binary(self) -> None:
        shellspec = (
            Path(manager.__file__).parent / "shellspec" / "workbench_adapter.yaml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            '"${ctx:WORKBENCH_ADAPTER_NODE}" "${ctx:WORKBENCH_ADAPTER_ENTRY}"',
            shellspec,
        )
        self.assertNotIn('node "${ctx:WORKBENCH_ADAPTER_ENTRY}"', shellspec)

    async def test_adopts_matching_connected_session_and_publishes_ready(self) -> None:
        seed = {"projectPath": "/workspace/project", "projectGeneration": 0, "openStateRevision": 0, "documents": []}
        publish = AsyncMock()
        rpc = AsyncMock(
            return_value={
                "result": {
                    "session": {
                        "connected": True,
                        "extConnected": True,
                        "workspaceFolder": "/workspace/project",
                    }
                }
            }
        )
        manager._set_adapter_state("idle")

        with (
            patch.object(manager, "adapter_rpc", rpc),
            patch.object(manager, "_publish_adapter_state_fact", publish),
            patch.object(initialization, "build_initial_documents", return_value=seed),
        ):
            adopted = await manager._adopt_live_adapter_session(
                "/workspace/project"
            )

        self.assertTrue(adopted)
        self.assertEqual("ready", manager.get_adapter_state()["status"])
        self.assertEqual("/workspace/project", manager.get_adapter_state()["project"])
        self.assertEqual(rpc.await_args_list, [
            call("adapter.status", timeout=15.0),
            call("vscode.documents.initialize", seed, timeout=10.0),
        ])
        publish.assert_awaited_once()

    async def test_retargets_connected_session_before_publishing_ready(self) -> None:
        seed = {"projectPath": "/workspace/current", "projectGeneration": 0, "openStateRevision": 0, "documents": []}
        publish = AsyncMock()
        rpc = AsyncMock(
            side_effect=[
                {
                    "result": {
                        "session": {
                            "connected": True,
                            "extConnected": True,
                            "workspaceFolder": "/workspace/old",
                        }
                    }
                },
                {"result": {"ok": True, "readyForDocumentOpen": True}},
            ]
        )

        with (
            patch.object(manager, "adapter_rpc", rpc),
            patch.object(manager, "_publish_adapter_state_fact", publish),
            patch.object(initialization, "build_initial_documents", return_value=seed),
        ):
            adopted = await manager._adopt_live_adapter_session("/workspace/current")

        self.assertTrue(adopted)
        self.assertEqual(
            [
                call("adapter.status", timeout=15.0),
                call(
                    "adapter.reconnect",
                    {"workspaceFolder": "/workspace/current", "initialDocuments": seed},
                    timeout=75.0,
                ),
            ],
            rpc.await_args_list,
        )
        self.assertEqual("ready", manager.get_adapter_state()["status"])
        self.assertEqual("/workspace/current", manager.get_adapter_state()["project"])
        publish.assert_awaited_once()

    async def test_completed_connect_event_recovers_python_timeout_state(self) -> None:
        publish = AsyncMock()
        manager._set_adapter_state(
            "error",
            project="/workspace/project",
            error="adapter.connect timed out",
        )

        with patch.object(manager, "_publish_adapter_state_fact", publish):
            adopted = await manager.adopt_adapter_ready_event(
                {
                    "session": {
                        "connected": True,
                        "extConnected": True,
                        "workspaceFolder": "/workspace/project",
                    }
                }
            )

        self.assertTrue(adopted)
        self.assertEqual(
            {
                "status": "ready",
                "project": "/workspace/project",
                "error": None,
            },
            manager.get_adapter_state(),
        )
        publish.assert_awaited_once()

    async def test_completed_connect_event_rejects_stale_workspace(self) -> None:
        publish = AsyncMock()
        manager._set_adapter_state("starting", project="/workspace/current")

        with patch.object(manager, "_publish_adapter_state_fact", publish):
            adopted = await manager.adopt_adapter_ready_event(
                {
                    "session": {
                        "connected": True,
                        "extConnected": True,
                        "workspaceFolder": "/workspace/old",
                    }
                }
            )

        self.assertFalse(adopted)
        self.assertEqual("starting", manager.get_adapter_state()["status"])
        publish.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
