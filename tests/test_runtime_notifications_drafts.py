from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

from app.apps.code_te2.explorer.services import runtime_notifications


def test_draft_notification_without_explorer_clients_does_not_forward_http() -> None:
    async def exercise() -> None:
        runtime_notifications.set_explorer_event_loop(asyncio.get_running_loop())
        try:
            with (
                patch.object(runtime_notifications.manager, "has_connections", return_value=False),
                patch.object(runtime_notifications, "mark_draft_cache_dirty") as mark_dirty,
                patch.object(runtime_notifications, "_schedule_debounce_task") as schedule,
            ):
                runtime_notifications.notify_draft_state_changed("/workspace/project")
            mark_dirty.assert_not_called()
            schedule.assert_not_called()
        finally:
            runtime_notifications.set_explorer_event_loop(None)

    asyncio.run(exercise())


def test_draft_notification_with_explorer_clients_keeps_local_publication() -> None:
    async def exercise() -> None:
        runtime_notifications.set_explorer_event_loop(asyncio.get_running_loop())
        try:
            with (
                patch.object(runtime_notifications.manager, "has_connections", return_value=True),
                patch.object(runtime_notifications, "mark_draft_cache_dirty") as mark_dirty,
                patch.object(runtime_notifications, "_schedule_debounce_task") as schedule,
            ):
                runtime_notifications.notify_draft_state_changed("/workspace/project")
            mark_dirty.assert_called_once_with(Path("/workspace/project"))
            assert schedule.call_args.kwargs["name"] == "code_te2_draft_decorations"
        finally:
            runtime_notifications.set_explorer_event_loop(None)

    asyncio.run(exercise())
