from __future__ import annotations

# pyright: reportUnannotatedClassAttribute=false, reportUnusedCallResult=false

import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.code_te2.monaco_editor import editor_ws
from app.apps.code_te2.monaco_editor.editor_backend_services.contracts import (
    EditorOpenPayload,
)
from app.apps.code_te2.monaco_editor.editor_backend_services.document_materialization_service import (
    materialize_document_payload,
    materialize_document_payload_async,
)
from app.apps.code_te2.monaco_editor.editor_backend_services.document_open_policy import (
    DocumentOpenRejectedError,
    MAX_EDITOR_DOCUMENT_BYTES,
)
from app.apps.code_te2.monaco_editor.editor_backend_services.open_service import (
    emit_editor_open_from_backend,
)
from app.apps.code_te2.open_state_backend import (
    ClientForegroundPayload,
    SidecarOpenStatePayload,
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

    def get_document_revision(self, project: str, abs_path: str) -> int:
        del project, abs_path
        return 0


class _PreferencesStore:
    def __init__(self, preferences: dict[str, object]) -> None:
        self.preferences = preferences

    def get_preferences(self, project: str) -> dict[str, object]:
        del project
        return self.preferences


class DocumentMaterializationTests(unittest.TestCase):
    def test_shell_script_extension_remains_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            script = Path(temp_dir) / "build.sh"
            script.write_text("#!/bin/sh\nprintf 'ok\\n'\n", encoding="utf-8")

            payload = materialize_document_payload(str(script), None)

        self.assertEqual(payload["content"], "#!/bin/sh\nprintf 'ok\\n'\n")

    def test_known_binary_extension_is_rejected_before_read(self) -> None:
        with patch.object(Path, "read_bytes", side_effect=AssertionError("disk read")):
            with self.assertRaisesRegex(
                DocumentOpenRejectedError,
                r"binary_extension:\.png",
            ):
                materialize_document_payload("/project/image.png", None)

    def test_extensionless_executable_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = Path(temp_dir) / "runner"
            executable.write_text("#!/bin/sh\n", encoding="utf-8")
            os.chmod(executable, 0o755)

            with self.assertRaisesRegex(
                DocumentOpenRejectedError,
                "extensionless_executable",
            ):
                materialize_document_payload(str(executable), None)

    def test_oversized_disk_document_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            document = Path(temp_dir) / "large.txt"
            document.write_bytes(b"x" * (MAX_EDITOR_DOCUMENT_BYTES + 1))

            with self.assertRaisesRegex(DocumentOpenRejectedError, "file_too_large"):
                materialize_document_payload(str(document), None)

    def test_document_at_size_limit_is_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            document = Path(temp_dir) / "limit.txt"
            document.write_bytes(b"x" * MAX_EDITOR_DOCUMENT_BYTES)

            payload = materialize_document_payload(str(document), None)

        self.assertEqual(len(payload["content"]), MAX_EDITOR_DOCUMENT_BYTES)

    def test_oversized_draft_is_rejected_without_reading_disk(self) -> None:
        cached = {
            "unsaved": True,
            "content": "x" * (MAX_EDITOR_DOCUMENT_BYTES + 1),
        }
        with patch.object(Path, "read_bytes", side_effect=AssertionError("disk read")):
            with self.assertRaisesRegex(DocumentOpenRejectedError, "draft_too_large"):
                materialize_document_payload("/project/large.txt", cached)

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
                "document_revision": 0,
            },
        )


class AsyncDocumentMaterializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejected_document_does_not_mutate_open_state(self) -> None:
        mutations: list[str] = []

        def reject_read(project: str, path: str) -> EditorOpenPayload:
            del project
            raise DocumentOpenRejectedError(path, "binary_extension:.png")

        async def emit_open(payload: EditorOpenPayload) -> None:
            del payload
            mutations.append("emit_open")

        async def emit_state(
            open_state: SidecarOpenStatePayload,
            *,
            client_foreground: ClientForegroundPayload | None = None,
            source: str | None = None,
            request_id: str | None = None,
        ) -> None:
            del open_state, client_foreground, source, request_id
            mutations.append("emit_state")

        def record_sidecar(
            project: str,
            abs_path: str,
            *,
            client_instance_id: str,
            reason: str,
        ) -> tuple[SidecarOpenStatePayload, ClientForegroundPayload]:
            del project, abs_path, client_instance_id, reason
            mutations.append("sidecar")
            return ({
                "projectPath": "/project",
                "sidecarPath": "/sidecar",
                "openFile": None,
                "openFileRel": None,
                "openFileExists": False,
                "invalidOpenFile": None,
                "revision": 0,
                "reason": "test",
                "ts": 0,
                "recents": [],
            }, {
                "projectPath": "/project",
                "clientInstanceId": "client_aaaaaaaaaaaa",
                "path": "/project/image.png",
                "rel": "image.png",
                "exists": True,
                "revision": 1,
                "seededFromLegacy": False,
                "reason": "test",
                "ts": 0,
            })

        with self.assertRaises(DocumentOpenRejectedError):
            await emit_editor_open_from_backend(
                {"path": "/project/image.png"},
                source_client="client_aaaaaaaaaaaa",
                request_id="open_rejected",
                active_project=lambda: "/project",
                normalize_abs_path=lambda path: path,
                is_under_project=lambda project, path: path.startswith(project + "/"),
                read_file_payload=reject_read,
                emit_editor_open=emit_open,
                record_sidecar_open_file=record_sidecar,
                emit_open_state_changed=emit_state,
            )

        self.assertEqual(mutations, [])

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
