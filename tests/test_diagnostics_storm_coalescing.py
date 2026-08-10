from __future__ import annotations

import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import diagnostics_bridge
from app.apps.code_te2 import wba_event_bridge
from app.apps.code_te2 import workbench_adapter_shell_manager as adapter_manager


def _push(event: dict[str, object]) -> dict[str, object]:
    return {"event": "te2.event", "params": event}


def _diagnostics_event(
    uri: str,
    marker_message: str,
    *,
    owner: str = "test-owner",
) -> dict[str, object]:
    return {
        "type": "diagnostics/update",
        "owner": owner,
        "items": [
            {
                "uri": uri,
                "markers": [{"message": marker_message, "severity": 8}],
            }
        ],
    }


class DiagnosticsStormCoalescingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        await adapter_manager._clear_pending_pushes()
        diagnostics_bridge.reset_diagnostics_projection()

    async def test_push_drain_coalesces_latest_uri_without_crossing_lifecycle_barrier(
        self,
    ) -> None:
        dispatch = AsyncMock()
        with patch.object(wba_event_bridge, "dispatch_wba_pipe_event", dispatch):
            adapter_manager._queue_push(
                _push(_diagnostics_event("file:///workspace/a.py", "old")),
                payload_bytes=100,
            )
            adapter_manager._queue_push(
                _push(_diagnostics_event("file:///workspace/a.py", "latest")),
                payload_bytes=110,
            )
            adapter_manager._queue_push(
                _push(
                    {
                        "type": "workspace/switched",
                        "workspaceRoot": "/workspace",
                    }
                ),
                payload_bytes=50,
            )
            adapter_manager._queue_push(
                _push(_diagnostics_event("file:///workspace/a.py", "after-switch")),
                payload_bytes=120,
            )
            adapter_manager._queue_push(
                _push(_diagnostics_event("file:///workspace/b.py", "second-file")),
                payload_bytes=130,
            )

            task = adapter_manager._push_drain_task
            self.assertIsNotNone(task)
            if task is not None:
                await task

        self.assertEqual(dispatch.await_count, 3)
        first = dispatch.await_args_list[0].args[0]
        second = dispatch.await_args_list[1].args[0]
        third = dispatch.await_args_list[2].args[0]

        self.assertEqual(second["type"], "workspace/switched")
        first_items = first["items"]
        third_items = third["items"]
        self.assertIsInstance(first_items, list)
        self.assertIsInstance(third_items, list)
        if isinstance(first_items, list):
            self.assertEqual(len(first_items), 1)
            self.assertEqual(first_items[0]["markers"][0]["message"], "latest")
        if isinstance(third_items, list):
            self.assertEqual(len(third_items), 2)
            self.assertEqual(
                [item["markers"][0]["message"] for item in third_items],
                ["after-switch", "second-file"],
            )

    async def test_update_does_not_scan_complete_cache_before_processing(self) -> None:
        event = _diagnostics_event("file:///workspace/a.py", "current")
        emit = AsyncMock()
        with (
            patch.object(
                diagnostics_bridge,
                "_diagnostics_project_root",
                return_value="/workspace",
            ),
            patch.object(
                diagnostics_bridge,
                "_prune_cache_to_project",
                wraps=diagnostics_bridge._prune_cache_to_project,
            ) as prune,
            patch.object(
                diagnostics_bridge,
                "_emit_diagnostics_to_explorer_and_ui",
                emit,
            ),
            redirect_stdout(StringIO()),
        ):
            await diagnostics_bridge.handle_wba_diagnostics_update(event)

        prune.assert_not_called()
        emit.assert_awaited_once_with("/workspace")
        self.assertIn(
            ("/workspace/a.py", "test-owner"),
            diagnostics_bridge._diag_cache,
        )


if __name__ == "__main__":
    unittest.main()
