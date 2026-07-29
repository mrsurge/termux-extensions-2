from __future__ import annotations

import asyncio
import hashlib
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.file_editor_cm6.monaco_editor import editor_ws
from app.apps.file_editor_cm6.monaco_editor.editor_backend_services.document_materialization_service import (
    materialize_document_payload,
    materialize_document_payload_async,
)


class _HistoryStore:
    def __init__(
        self,
        cached_document: dict[str, object] | None,
        *,
        scroll_line: float | None = None,
    ) -> None:
        self.cached_document = cached_document
        self.scroll_line = scroll_line
        self.cache_reads = 0

    def get_file_scroll_line(self, project: str, abs_path: str) -> float | None:
        del project, abs_path
        return self.scroll_line

    def get_cached_document(
        self,
        project: str,
        abs_path: str,
    ) -> dict[str, object] | None:
        del project, abs_path
        self.cache_reads += 1
        return self.cached_document


class _PreferencesStore:
    def __init__(self, preferences: dict[str, object]) -> None:
        self.preferences = preferences

    def get_preferences(self, project: str) -> dict[str, object]:
        del project
        return self.preferences


class DocumentMaterializationTests(unittest.TestCase):
    def test_unsaved_draft_wins_without_reading_disk(self) -> None:
        cached = {
            "unsaved": True,
            "content": "draft text\n",
            "base_sha256": "base",
            "content_sha256": "draft",
        }

        with patch.object(Path, "read_bytes", side_effect=AssertionError("disk read")):
            payload = materialize_document_payload("/missing/file.py", cached)

        self.assertEqual(
            payload,
            {
                "has_draft": True,
                "content": "draft text\n",
                "base_sha256": "base",
                "content_sha256": "draft",
                "state": "mid_session",
                "unsaved": True,
                "reason": "restore",
            },
        )

    def test_clean_document_reads_disk_once_and_hashes_decoded_text(self) -> None:
        with patch.object(Path, "read_bytes", return_value=b"alpha\xffomega\n") as read_bytes:
            payload = materialize_document_payload(
                "/project/sample.txt",
                {"unsaved": False, "content": "ignored"},
            )

        read_bytes.assert_called_once()
        content = "alpha\ufffdomega\n"
        expected_sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
        self.assertEqual(payload["content"], content)
        self.assertEqual(payload.get("base_sha256"), expected_sha)
        self.assertEqual(payload.get("content_sha256"), expected_sha)
        self.assertEqual(payload["has_draft"], False)
        self.assertEqual(payload["state"], "clean")
        self.assertEqual(payload["unsaved"], False)
        self.assertEqual(payload["reason"], "disk")

    def test_unreadable_document_preserves_empty_disk_payload(self) -> None:
        expected_sha = hashlib.sha256(b"").hexdigest()

        payload = materialize_document_payload("/missing/file.py", None)

        self.assertEqual(
            payload,
            {
                "has_draft": False,
                "content": "",
                "base_sha256": expected_sha,
                "content_sha256": expected_sha,
                "state": "clean",
                "unsaved": False,
                "reason": "disk",
            },
        )

    def test_strict_disk_materialization_propagates_read_errors(self) -> None:
        with self.assertRaises(OSError):
            materialize_document_payload(
                "/missing/file.py",
                None,
                strict_disk_errors=True,
            )

    def test_active_open_payload_preserves_existing_contract_and_one_cache_read(
        self,
    ) -> None:
        cached: dict[str, object] = {
            "unsaved": True,
            "content": "draft text",
            "base_sha256": "base",
            "content_sha256": "draft",
        }
        history_store = _HistoryStore(cached, scroll_line=37)
        preferences_store = _PreferencesStore({"editor": {"autoSave": False}})

        with (
            patch.object(editor_ws, "_history_store", history_store),
            patch.object(editor_ws, "_preferences_store", preferences_store),
        ):
            payload = editor_ws.editor_runtime_read_file_payload(
                "/project",
                "/project/file.py",
            )

        self.assertEqual(history_store.cache_reads, 1)
        self.assertEqual(
            payload,
            {
                "path": "/project/file.py",
                "preferences": {"editor": {"autoSave": False}},
                "auto_save": False,
                "scroll_line": 37.0,
                "has_draft": True,
                "content": "draft text",
                "base_sha256": "base",
                "content_sha256": "draft",
                "state": "mid_session",
                "unsaved": True,
                "reason": "restore",
            },
        )


class AsyncDocumentMaterializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_materializer_runs_sync_work_through_to_thread(self) -> None:
        expected = {
            "has_draft": True,
            "content": "draft",
            "state": "mid_session",
            "unsaved": True,
            "reason": "restore",
        }

        with (
            patch.object(
                asyncio,
                "to_thread",
                wraps=asyncio.to_thread,
            ) as to_thread,
        ):
            payload = await materialize_document_payload_async(
                "/missing/file.py",
                {"unsaved": True, "content": "draft"},
            )

        self.assertEqual(payload, expected)
        to_thread.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
