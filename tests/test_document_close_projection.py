from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.apps.code_te2 import open_state_events
from app.apps.code_te2.worker_services.event_bus import build_event


class DocumentCloseProjectionTests(unittest.TestCase):
    def test_document_close_projects_only_affected_exact_clients(self) -> None:
        project = "/workspace/project"
        open_state = {
            "projectPath": project,
            "sidecarPath": "/state/project.json",
            "openFile": None,
            "openFileRel": None,
            "openFileExists": False,
            "invalidOpenFile": None,
            "revision": 9,
            "reason": "recent_file_closed",
            "ts": 1,
            "recents": [],
        }
        affected = [
            {
                "projectPath": project,
                "clientInstanceId": "client_aaaaaaaaaaaa",
                "path": None,
                "rel": None,
                "exists": False,
                "revision": 4,
                "seededFromLegacy": False,
                "clientRole": "secondary",
                "reason": "recent_file_closed",
                "ts": 1,
            }
        ]
        event = build_event(
            "DocumentClosed",
            project_root=project,
            project_generation=7,
            source="test:close",
            payload={
                "openState": open_state,
                "affectedForegrounds": affected,
                "source": "test:close",
            },
        )
        published_open: list[dict[str, object]] = []
        published_foregrounds: list[tuple[dict[str, object], dict[str, object]]] = []

        async def publish_open(
            payload: object,
            **kwargs: object,
        ) -> None:
            published_open.append({"payload": payload, **kwargs})

        async def publish_foreground(
            _open_state: object,
            foreground: object,
            **kwargs: object,
        ) -> None:
            published_foregrounds.append(
                ({"foreground": foreground}, dict(kwargs))
            )

        with (
            patch.object(
                open_state_events,
                "current_project_generation",
                return_value=7,
            ),
            patch.object(
                open_state_events,
                "publish_open_state_changed",
                side_effect=publish_open,
            ),
            patch.object(
                open_state_events,
                "publish_client_foreground_changed",
                side_effect=publish_foreground,
            ),
        ):
            asyncio.run(open_state_events._handle_document_closed_event(event))

        self.assertEqual(len(published_open), 1)
        self.assertEqual(len(published_foregrounds), 1)
        foreground_call, foreground_kwargs = published_foregrounds[0]
        self.assertIs(foreground_kwargs["project_editor_snapshot"], True)
        foreground = foreground_call["foreground"]
        self.assertIsInstance(foreground, dict)
        self.assertEqual(
            foreground["clientInstanceId"],
            "client_aaaaaaaaaaaa",
        )


if __name__ == "__main__":
    unittest.main()
