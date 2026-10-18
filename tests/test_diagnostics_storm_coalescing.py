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


    async def test_owner_clear_is_a_pipe_barrier_not_an_empty_disposable_update(self) -> None:
        dispatch = AsyncMock()
        clear: dict[str, object] = {"type": "diagnostics/clear", "owner": "ty"}
        with patch.object(wba_event_bridge, "dispatch_wba_pipe_event", dispatch):
            for event in (
                _diagnostics_event("file:///workspace/a.py", "old", owner="ty"),
                clear,
                _diagnostics_event("file:///workspace/a.py", "new", owner="ty"),
            ):
                adapter_manager._queue_push(_push(event), payload_bytes=100)
            task = adapter_manager._push_drain_task
            self.assertIsNotNone(task)
            if task is not None:
                await task
        self.assertEqual(dispatch.await_count, 3)
        self.assertEqual(dispatch.await_args_list[1].args[0], clear)
        self.assertEqual(dispatch.await_args_list[0].args[0]["items"][0]["markers"][0]["message"], "old")
        self.assertEqual(dispatch.await_args_list[2].args[0]["items"][0]["markers"][0]["message"], "new")

    async def test_clear_dispatch_evicts_only_its_owner_and_projects_empty_counts(self) -> None:
        from app.apps.code_te2.file_tabs_projection import _diagnostics_from_detail

        emitted = AsyncMock()
        detail = AsyncMock()
        with (
            patch.object(diagnostics_bridge, "_diagnostics_project_root", return_value="/workspace"),
            patch.object(diagnostics_bridge, "_emit_diagnostics_to_explorer_and_ui", emitted),
            patch.object(diagnostics_bridge, "_publish_diagnostics_detail_changed", detail),
            redirect_stdout(StringIO()),
        ):
            await wba_event_bridge.dispatch_wba_pipe_event(
                _diagnostics_event("file:///workspace/a.py", "ty stale", owner="ty"))
            await wba_event_bridge.dispatch_wba_pipe_event(
                _diagnostics_event("file:///workspace/b.py", "ty stale", owner="ty"))
            await wba_event_bridge.dispatch_wba_pipe_event(
                _diagnostics_event("file:///workspace/b.py", "other retained", owner="other"))
            await wba_event_bridge.dispatch_wba_pipe_event({"type": "diagnostics/clear", "owner": "ty"})
            self.assertEqual(set(diagnostics_bridge._diag_cache), {("/workspace/b.py", "other")})
            await diagnostics_bridge._emit_diagnostics_debounced()
            assert detail.await_args is not None
            projected = detail.await_args.args[1]
            self.assertEqual(set(projected), {"/workspace/b.py"})
            self.assertEqual(_diagnostics_from_detail(projected), {"/workspace/b.py": {"errors": 1, "warnings": 0}})
            for invalid_owner in (None, "", 123):
                await wba_event_bridge.dispatch_wba_pipe_event({"type": "diagnostics/clear", "owner": invalid_owner})
            self.assertEqual(set(diagnostics_bridge._diag_cache), {("/workspace/b.py", "other")})
            await wba_event_bridge.dispatch_wba_pipe_event({"type": "diagnostics/clear", "owner": "other"})
            await diagnostics_bridge._emit_diagnostics_debounced()
            assert detail.await_args is not None
            self.assertEqual(detail.await_args.args[1], {})
            self.assertEqual(_diagnostics_from_detail(detail.await_args.args[1]), {})
        self.assertEqual(emitted.await_count, 5)


if __name__ == "__main__":
    unittest.main()
