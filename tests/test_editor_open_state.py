from __future__ import annotations

import os
from pathlib import Path
import tempfile
from typing import final
import unittest
from unittest.mock import patch

from app.apps.code_te2.editor_open_state import (
    MAX_EDITOR_PRESENTATIONS, EditorOpenState, EditorPlacement, StaleEditorOpenState,
)
from app.apps.code_te2 import project_sidecar
from app.apps.code_te2.project_sidecar import ProjectSidecar

A = "client_aaaaaaaaaaaa"
B = "client_bbbbbbbbbbbb"
C = "client_cccccccccccc"
FILE = "/project/λ file.cpp"


@final
class EditorOpenStateTests(unittest.TestCase):
    def test_direct_secondary_open_and_unknown_remote_default(self) -> None:
        state = EditorOpenState().connect(A).connect(B).open_document(A, FILE, "secondary")
        self.assertEqual(state.documents, (FILE,))
        self.assertEqual(state.placement(A), EditorPlacement(A, (), (FILE,)))
        self.assertEqual(state.placement(B), EditorPlacement(B, (FILE,), ()))
        joined = state.connect(C)
        self.assertEqual(joined.placement(C).primary, (FILE,))
        self.assertEqual(joined.connect(A), joined)
        self.assertEqual(joined.placement(A).secondary, (FILE,))

    def test_same_file_is_unique_per_area_but_can_have_two_presentations(self) -> None:
        state = EditorOpenState().connect(A).open_document(A, FILE, "primary")
        self.assertIs(state.open_document(A, FILE, "primary"), state)
        state = state.open_document(A, FILE, "secondary")
        self.assertIs(state.open_document(A, FILE, "secondary"), state)
        self.assertEqual(state.documents, (FILE,))
        closed = state.close_presentation(A, FILE, "primary", expected_revision=state.revision)
        self.assertEqual(closed.kind, "presentation")
        self.assertEqual(closed.state.placement(A).secondary, (FILE,))
        self.assertEqual(closed.state.placement(A).primary, ())
        self.assertEqual(closed.state.documents, (FILE,))
        self.assertEqual(state.placement(A).primary, (FILE,))  # No partial mutation.

    def test_last_local_close_removes_every_other_client_presentation(self) -> None:
        state = EditorOpenState().connect(A).connect(B).open_document(A, FILE, "secondary")
        state = state.open_document(B, FILE, "secondary")
        self.assertEqual(state.placement(B), EditorPlacement(B, (FILE,), (FILE,)))
        closed = state.close_presentation(A, FILE, "secondary", expected_revision=state.revision)
        self.assertEqual(closed.kind, "document")
        self.assertEqual(closed.state.documents, ())
        self.assertEqual(closed.state.placement(B), EditorPlacement(B))

    def test_last_primary_close_clears_remote_secondary_and_preserves_other_files(self) -> None:
        state = EditorOpenState().connect(A).connect(B).open_document(A, FILE, "secondary")
        state = state.open_document(A, "/project/other", "primary")
        result = state.close_presentation(B, FILE, "primary", expected_revision=state.revision)
        self.assertEqual(result.kind, "document")
        self.assertEqual(result.state.documents, ("/project/other",))
        self.assertEqual(result.state.placement(A).primary, ("/project/other",))
        self.assertEqual(result.state.placement(A).secondary, ())

    def test_stale_close_cannot_remove_reopened_document_or_new_placement(self) -> None:
        opened = EditorOpenState().connect(A).open_document(A, FILE, "primary")
        placed = opened.open_document(A, FILE, "secondary")
        with self.assertRaises(StaleEditorOpenState):
            placed.close_presentation(A, FILE, "primary", expected_revision=opened.revision)
        closed = placed.close_document(FILE, expected_revision=placed.revision)
        reopened = closed.open_document(A, FILE, "primary")
        with self.assertRaises(StaleEditorOpenState):
            reopened.close_presentation(A, FILE, "primary", expected_revision=placed.revision)
        self.assertEqual(reopened.documents, (FILE,))

    def test_no_disconnect_mutation_and_reconnect_does_not_reopen_closed_file(self) -> None:
        state = EditorOpenState().connect(A).connect(B).open_document(A, FILE, "secondary")
        # B stops sending requests: its count is not a lifetime lease.
        result = state.close_presentation(A, FILE, "secondary", expected_revision=state.revision)
        restored = EditorOpenState.from_data(result.state.to_data()).connect(B)
        self.assertEqual(restored.documents, ())
        self.assertEqual(restored.placement(B).primary, ())

    def test_client_capacity_fails_without_evicting_existing_placement(self) -> None:
        state = EditorOpenState()
        for index in range(MAX_EDITOR_PRESENTATIONS):
            state = state.connect(f"client_{index:012x}")
        with self.assertRaisesRegex(ValueError, "capacity"):
            state.connect(A)
        self.assertEqual(len(state.clients), MAX_EDITOR_PRESENTATIONS)

    def test_untrusted_persistence_rejects_invalid_types_and_invariants(self) -> None:
        invalid: tuple[object, ...] = (
            None, [], {"schemaVersion": 2, "revision": 0, "documents": [], "clients": []},
            {"schemaVersion": True, "revision": 0, "documents": [], "clients": []},
            {"schemaVersion": 1, "revision": False, "documents": [], "clients": []},
            {"schemaVersion": 1, "revision": -1, "documents": [], "clients": []},
            {"schemaVersion": 1, "revision": 0, "documents": [FILE, FILE], "clients": []},
            {"schemaVersion": 1, "revision": 0, "documents": [3], "clients": []},
            {"schemaVersion": 1, "revision": 0, "documents": [FILE], "clients": [
                {"clientId": A, "primary": [], "secondary": []}]},
            {"schemaVersion": 1, "revision": 0, "documents": [], "clients": [
                {"clientId": A, "primary": [FILE], "secondary": []}]},
        )
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                EditorOpenState.from_data(value)
        with self.assertRaises(ValueError):
            EditorPlacement(A, (FILE, FILE))


@final
class EditorOpenStatePersistenceTests(unittest.TestCase):
    temporary: tempfile.TemporaryDirectory[str]
    project: Path
    sidecars: Path

    def setUp(self) -> None:
        scratch = Path(os.environ.get("TMPDIR") or Path(__file__).resolve().parents[1] / ".codex-scratch")
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="editor-open-state-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name) / "project"
        self.project.mkdir()
        self.sidecars = Path(self.temporary.name) / "sidecars"
        self.sidecars.mkdir()

    def test_legacy_migration_is_read_only_and_unknown_clients_default_primary(self) -> None:
        with patch.object(project_sidecar, "_sidecar_root", return_value=self.sidecars):
            sidecar = ProjectSidecar(str(self.project))
            path = str(self.project / "draft.cpp")
            sidecar.record_document_activity(path)
            legacy_revision = sidecar.bump_open_state_revision()
            sidecar.save()
            sidecar_path = ProjectSidecar.get_sidecar_path(str(self.project))
            before = sidecar_path.read_bytes()
            state = sidecar.read_editor_open_state()
            self.assertEqual(state.revision, legacy_revision)
            self.assertEqual(state.documents, (path,))
            self.assertEqual(state.connect(A).placement(A).primary, (path,))
            self.assertEqual(sidecar_path.read_bytes(), before)

    def test_round_trip_keeps_open_membership_separate_from_twelve_item_mru(self) -> None:
        with patch.object(project_sidecar, "_sidecar_root", return_value=self.sidecars):
            sidecar = ProjectSidecar(str(self.project))
            state = sidecar.read_editor_open_state().connect(A)
            for index in range(20):
                path = str(self.project / f"file-{index}.cpp")
                state = state.open_document(A, path, "secondary")
                sidecar.record_document_activity(path)
            self.assertEqual(len(sidecar.list_recent_files()), 12)
            sidecar.set_editor_open_state(state, expected_revision=0)
            sidecar.save()
            restored = ProjectSidecar(str(self.project)).read_editor_open_state()
            self.assertEqual(restored, state)
            self.assertEqual(len(restored.documents), 20)
            self.assertEqual(restored.placement(A).primary, ())
            self.assertEqual(restored.connect(B).placement(B).primary, restored.documents)

    def test_stale_storage_write_and_outside_project_paths_are_rejected(self) -> None:
        with patch.object(project_sidecar, "_sidecar_root", return_value=self.sidecars):
            sidecar = ProjectSidecar(str(self.project))
            state = EditorOpenState().connect(A)
            sidecar.set_editor_open_state(state, expected_revision=0)
            with self.assertRaises(StaleEditorOpenState):
                sidecar.set_editor_open_state(state, expected_revision=0)
            outside = state.open_document(A, str(self.project.parent / "outside"), "primary")
            with self.assertRaises(ValueError):
                sidecar.set_editor_open_state(outside, expected_revision=state.revision)
            self.assertEqual(sidecar.read_editor_open_state(), state)


if __name__ == "__main__":
    unittest.main()
