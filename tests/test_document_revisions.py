from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import patch

from app.apps.code_te2 import project_sidecar
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.monaco_editor.editor_backend_services import save_service
from app.apps.code_te2.monaco_editor.editor_backend_services.contracts import RuntimeMeta


class DocumentRevisionTests(unittest.TestCase):
    def setUp(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    def tearDown(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    def test_draft_and_clean_transitions_advance_one_durable_revision_stream(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            target = project / "main.py"
            target.write_text("value = 1\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                history = HistoryStore(root / "history.json")
                first = history.upsert_cached_document(
                    str(project),
                    str(target),
                    "value = 2\n",
                    "base",
                    "run",
                    "shell",
                    "shell-run",
                    1,
                    2,
                )
                second = history.upsert_cached_document(
                    str(project),
                    str(target),
                    "value = 3\n",
                    "base",
                    "run",
                    "shell",
                    "shell-run",
                    1,
                    2,
                )
                self.assertEqual(first["document_revision"], 1)
                self.assertEqual(second["document_revision"], 2)

                self.assertTrue(history.clear_cached_document(str(project), str(target)))
                self.assertEqual(history.get_document_revision(str(project), str(target)), 3)

                project_sidecar.ProjectSidecar._instances.clear()
                reloaded = HistoryStore(root / "history.json")
                self.assertEqual(reloaded.get_document_revision(str(project), str(target)), 3)
                self.assertIsNone(reloaded.get_cached_document(str(project), str(target)))

    def test_bounded_revision_map_never_revives_an_evicted_lower_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                sidecar = project_sidecar.ProjectSidecar.load_or_create(str(project))
                first_path = str(project / "file-0.txt")
                for index in range(project_sidecar.MAX_DOCUMENT_REVISION_ENTRIES + 5):
                    sidecar.advance_document_revision(str(project / f"file-{index}.txt"))
                sidecar.save()

                raw_entries = sidecar.dump_raw()["document_revisions"]
                self.assertIsInstance(raw_entries, dict)
                self.assertEqual(
                    len(cast(dict[str, object], raw_entries)),
                    project_sidecar.MAX_DOCUMENT_REVISION_ENTRIES,
                )
                watermark = project_sidecar.MAX_DOCUMENT_REVISION_ENTRIES + 5
                self.assertEqual(sidecar.get_document_revision(first_path), watermark)
                self.assertEqual(sidecar.advance_document_revision(first_path), watermark + 1)


class DocumentRevisionMirrorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    def tearDown(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    async def test_backend_arrival_order_assigns_one_revision_to_each_mirror_projection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            target = project / "main.py"
            target.write_text("value = 1\n", encoding="utf-8")
            history = HistoryStore(root / "history.json")
            emitted: list[tuple[str, dict[str, object]]] = []

            async def emit(event_name: str, payload: dict[str, object]) -> None:
                emitted.append((event_name, payload))

            runtime_meta: RuntimeMeta = {
                "run_id": "run",
                "shell_id": "shell",
                "shell_run_id": "shell-run",
                "launcher_pid": 1,
                "worker_pid": 2,
            }

            with (
                patch.object(project_sidecar, "_sidecar_root", return_value=sidecars),
                patch.object(save_service, "_history_store", history),
            ):
                for content in ("value = 2\n", "value = 3\n"):
                    await save_service.handle_editor_mirror(
                        "client_aaaaaaaaaaaa",
                        {
                            "path": str(target),
                            "content": content,
                            "base_sha256": "0" * 64,
                        },
                        active_project=lambda: str(project),
                        normalize_abs_path=lambda value: str(Path(value).resolve()),
                        is_under_project=lambda project_path, file_path: Path(file_path).is_relative_to(project_path),
                        runtime_meta=lambda: runtime_meta,
                        emit_to_room=emit,
                        notify_draft_state_changed=lambda _project: None,
                    )

            self.assertEqual(
                [payload["document_revision"] for _, payload in emitted],
                [1, 1, 2, 2],
            )
            self.assertEqual(
                [payload["source_client"] for _, payload in emitted],
                ["client_aaaaaaaaaaaa"] * 4,
            )


if __name__ == "__main__":
    unittest.main()
