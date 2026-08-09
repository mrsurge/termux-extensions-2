from __future__ import annotations

# pyright: reportPrivateUsage=false
import unittest
from typing import cast, override
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import code_inspector_backend, code_inspector_projection


def projection(
    *,
    request_id: str = "request-1",
    sequence: int = 1,
    revision: int = 0,
) -> dict[str, object]:
    return {
        "requestId": request_id,
        "requestSequence": sequence,
        "revision": revision,
        "status": "loading",
        "mode": "references",
        "target": {"path": "/workspace/main.rs"},
        "summary": {"count": 0},
        "tree": [],
        "error": None,
    }


class CodeInspectorProjectionTests(unittest.IsolatedAsyncioTestCase):
    @override
    def setUp(self) -> None:
        _ = code_inspector_projection.clear_code_inspector_projection_state()

    async def test_rejects_stale_sequences_and_revisions(self) -> None:
        publish = AsyncMock()
        with (
            patch.object(code_inspector_backend, "publish_worker_event", publish),
            patch.object(code_inspector_backend, "_active_project", return_value="/workspace"),
            patch.object(code_inspector_backend, "current_project_generation", return_value=3),
        ):
            first = await code_inspector_backend.publish_code_inspector_projection(
                {"projection": projection(revision=1)},
                source_client="editor",
            )
            stale_revision = await code_inspector_backend.publish_code_inspector_projection(
                {"projection": projection(revision=1)},
                source_client="editor",
            )
            stale_sequence = await code_inspector_backend.publish_code_inspector_projection(
                {"projection": projection(request_id="request-0", sequence=0, revision=9)},
                source_client="editor",
            )
            latest = await code_inspector_backend.publish_code_inspector_projection(
                {"projection": projection(request_id="request-2", sequence=2, revision=0)},
                source_client="editor",
            )

        self.assertTrue(first["accepted"])
        self.assertFalse(stale_revision["accepted"])
        self.assertFalse(stale_sequence["accepted"])
        self.assertTrue(latest["accepted"])
        current = code_inspector_projection.get_code_inspector_projection()
        self.assertIsNotNone(current)
        assert current is not None
        self.assertEqual(current["requestId"], "request-2")
        self.assertEqual(publish.await_count, 2)

    async def test_clear_emits_an_empty_projection_fact(self) -> None:
        publish = AsyncMock()
        _ = code_inspector_projection.replace_code_inspector_projection(
            code_inspector_backend._coerce_projection(projection(revision=1))
        )
        with (
            patch.object(code_inspector_backend, "publish_worker_event", publish),
            patch.object(code_inspector_backend, "_active_project", return_value="/workspace"),
            patch.object(code_inspector_backend, "current_project_generation", return_value=3),
        ):
            await code_inspector_backend.clear_code_inspector_projection(
                reason="adapter_session_reset",
                source="test",
            )

        self.assertIsNone(code_inspector_projection.get_code_inspector_projection())
        awaited = publish.await_args
        self.assertIsNotNone(awaited)
        assert awaited is not None
        event = cast(dict[str, object], awaited.args[0])
        payload = cast(dict[str, object], event["payload"])
        self.assertIsNone(payload["projection"])
        self.assertEqual(payload["reason"], "adapter_session_reset")

    async def test_replacement_releases_retained_hierarchy_projection(self) -> None:
        publish = AsyncMock()
        release = AsyncMock()
        hierarchy = projection(revision=1)
        hierarchy["mode"] = "callHierarchy"
        _ = code_inspector_projection.replace_code_inspector_projection(
            code_inspector_backend._coerce_projection(hierarchy)
        )
        with (
            patch.object(code_inspector_backend, "publish_worker_event", publish),
            patch.object(code_inspector_backend, "_release_projection", release),
            patch.object(code_inspector_backend, "_active_project", return_value="/workspace"),
            patch.object(code_inspector_backend, "current_project_generation", return_value=3),
        ):
            result = await code_inspector_backend.publish_code_inspector_projection(
                {
                    "projection": projection(
                        request_id="request-2",
                        sequence=2,
                    )
                },
                source_client="editor",
            )

        self.assertTrue(result["accepted"])
        release.assert_awaited_once()
        release_args = release.await_args
        self.assertIsNotNone(release_args)
        assert release_args is not None
        released = cast(dict[str, object], release_args.args[0])
        self.assertEqual(released["requestId"], "request-1")

    async def test_routes_validated_direction_commands(self) -> None:
        hierarchy = projection(revision=1)
        hierarchy["mode"] = "callHierarchy"
        hierarchy["status"] = "ready"
        hierarchy["summary"] = {"count": 1, "direction": "incoming"}
        _ = code_inspector_projection.replace_code_inspector_projection(
            code_inspector_backend._coerce_projection(hierarchy)
        )
        emit = AsyncMock()
        with patch.object(code_inspector_backend, "_emit_editor_command", emit):
            result = await code_inspector_backend.handle_code_inspector_command(
                {
                    "action": "direction",
                    "requestId": "request-1",
                    "direction": "outgoing",
                },
                source_name="host",
            )

        self.assertEqual(result["action"], "direction")
        emit.assert_awaited_once()
        awaited = emit.await_args
        self.assertIsNotNone(awaited)
        assert awaited is not None
        emitted = cast(dict[str, object], awaited.args[0])
        self.assertEqual(emitted["direction"], "outgoing")
        self.assertEqual(emitted["projection"], hierarchy)

    async def test_rejects_invalid_direction_commands(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_code_inspector_direction"):
            _ = await code_inspector_backend.handle_code_inspector_command(
                {
                    "action": "direction",
                    "requestId": "request-1",
                    "direction": "sideways",
                },
                source_name="host",
            )
