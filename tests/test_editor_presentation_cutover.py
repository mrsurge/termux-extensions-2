from __future__ import annotations

from contextlib import ExitStack
import os
from pathlib import Path
import tempfile
from typing import final
import unittest
from unittest.mock import patch

from app.apps.code_te2 import editor_renderer_bindings as bindings, project_sidecar, open_state_events, boot_snapshot_backend
from app.apps.code_te2.editor_open_state import StaleEditorOpenState
from app.apps.code_te2.editor_renderer_bindings import bind_editor_renderer
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.host import recent_files_backend as backend
from app.apps.code_te2.host import secondary_content_backend as secondary_content
from app.apps.code_te2.host.secondary_content_state import SecondaryContentState, HistoricalContent
from app.apps.code_te2.worker_services.history_service import HistoryBlobPair, HistoryBlobSide
from app.apps.code_te2.open_state_backend import (
    ClientForegroundPayload, SidecarOpenStatePayload, close_client_presentation,
    read_client_foreground, read_client_open_state, read_sidecar_open_state, write_client_document_open,
    write_client_foreground, recover_orphaned_secondary,
)
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.worker_services import event_bus

A, S, B, T = ("client_aaaaaaaaaaaa", "client_ssssssssssss", "client_bbbbbbbbbbbb", "client_tttttttttttt")


def generation(_project: str | Path | None = None) -> int:
    return 9


@final
class EditorPresentationCutoverTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.stack = ExitStack()
        self.project: str = ""
        self.path: str = ""
        self.events: list[str] = []
        self.history: HistoryStore | None = None

    def setUp(self) -> None:
        self.addCleanup(self.stack.close)
        scratch = Path(os.environ.get("TMPDIR") or Path(__file__).resolve().parents[1] / ".codex-scratch")
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=scratch)))
        self.project = str(root / "project")
        Path(self.project).mkdir()
        self.path = str(Path(self.project) / "draft.cpp")
        Path(self.path).write_text("working\n")
        self.stack.enter_context(patch.dict(bindings._bindings, clear=True))
        self.stack.enter_context(patch.object(project_sidecar, "_sidecar_root", return_value=root / "sidecars"))
        self.stack.enter_context(patch.object(event_bus, "current_project_generation", new=generation))
        self.history = HistoryStore(root / "history.json")
        self.history.set_active_project(self.project)
        self.stack.enter_context(patch.object(backend, "get_history_store", new=self.get_history))
        self.stack.enter_context(patch.object(secondary_content, "get_history_store", new=self.get_history))
        self.stack.enter_context(patch.object(secondary_content, "_state", new=SecondaryContentState()))
        self.stack.enter_context(patch.object(open_state_events, "publish_open_state_changed", new=self.open_changed))
        self.stack.enter_context(patch.object(open_state_events, "publish_client_foreground_changed", new=self.foreground_changed))
        self.stack.enter_context(patch.object(backend, "publish_document_closed", new=self.document_closed))
        self.stack.enter_context(patch.object(backend, "publish_open_state_changed", new=self.open_changed))
        self.stack.enter_context(patch.object(backend, "publish_client_foreground_changed", new=self.foreground_changed))
        bind_editor_renderer(A, A, "primary")
        bind_editor_renderer(S, A, "secondary")
        bind_editor_renderer(B, B, "primary")
        bind_editor_renderer(T, B, "secondary")
        read_client_foreground(self.project, A)
        read_client_foreground(self.project, B)

    def get_history(self) -> HistoryStore:
        assert self.history is not None
        return self.history

    async def document_closed(self, _state: SidecarOpenStatePayload, **_kwargs: object) -> None:
        self.events.append("document")

    async def open_changed(self, _state: SidecarOpenStatePayload, **_kwargs: object) -> None:
        self.events.append("state")

    async def foreground_changed(self, _state: SidecarOpenStatePayload,
                                 _foreground: ClientForegroundPayload, **_kwargs: object) -> None:
        self.events.append("foreground")

    async def close(self, renderer: str) -> dict[str, object]:
        snapshot = read_client_open_state(self.project, renderer, reason="test")
        return await backend.handle_host_recent_file_close_request({
            "path": self.path, "projectPath": self.project, "revision": snapshot["revision"],
            "projectGeneration": 9,
            "mainPageClientInstanceId": B,  # Cannot override the connection association.
        }, source_name=renderer)

    def test_secondary_open_projects_into_its_own_area_and_remote_primary(self) -> None:
        write_client_document_open(self.project, self.path, S)
        primary = read_client_open_state(self.project, A, reason="test")
        secondary = read_client_open_state(self.project, S, reason="test")
        remote = read_client_open_state(self.project, B, reason="test")
        self.assertFalse(primary["editorPlacement"]["paths"])
        assert secondary["editorPlacement"]["paths"] == [self.path]
        assert remote["editorPlacement"]["paths"] == [self.path]
        self.assertEqual(read_client_foreground(self.project, A)["path"], None)
        self.assertEqual(read_client_foreground(self.project, S, client_role="secondary")["path"], self.path)

    async def test_local_close_does_not_publish_document_close(self) -> None:
        write_client_document_open(self.project, self.path, A)
        write_client_document_open(self.project, self.path, S)
        reply = await self.close(A)
        self.assertEqual(reply["kind"], "presentation")
        self.assertNotIn("document", self.events)
        self.assertFalse(read_client_open_state(self.project, A, reason="test")["editorPlacement"]["paths"])
        assert read_client_open_state(self.project, S, reason="test")["editorPlacement"]["paths"] == [self.path]
        self.assertEqual(read_client_foreground(self.project, A)["path"], None)

    async def test_last_local_close_is_global_even_when_remote_has_both(self) -> None:
        write_client_document_open(self.project, self.path, S)
        write_client_document_open(self.project, self.path, T)
        reply = await self.close(S)
        self.assertEqual(reply["kind"], "document")
        assert self.events == ["document"]
        for renderer in (A, S, B, T):
            state = read_client_open_state(self.project, renderer, reason="test")
            self.assertFalse(state["recents"])
            self.assertFalse(state["editorPlacement"]["paths"])
        self.assertEqual(read_client_foreground(self.project, S, client_role="secondary")["path"], None)

    def test_stale_revision_or_project_generation_rejects_without_mutation(self) -> None:
        write_client_document_open(self.project, self.path, A)
        snapshot = read_sidecar_open_state(self.project, reason="test")
        other = str(Path(self.project) / "other.cpp")
        Path(other).write_text("other")
        write_client_document_open(self.project, other, B)
        with self.assertRaises(StaleEditorOpenState):
            close_client_presentation(self.project, self.path, A, expected_revision=snapshot["revision"], expected_generation=9)
        latest = read_sidecar_open_state(self.project, reason="test")
        with self.assertRaisesRegex(ValueError, "generation"):
            close_client_presentation(self.project, self.path, A, expected_revision=latest["revision"], expected_generation=8)
        self.assertEqual(len(latest["recents"]), 2)

    def test_open_projection_and_decorations_are_not_limited_by_mru(self) -> None:
        for index in range(20):
            path = str(Path(self.project) / f"file-{index}.cpp")
            Path(path).write_text("working")
            write_client_document_open(self.project, path, S)
        sidecar = ProjectSidecar(self.project)
        self.assertEqual(len(sidecar.list_recent_files()), 12)
        self.assertEqual(len(sidecar.list_open_documents()), 20)
        self.assertEqual(len(read_client_open_state(self.project, S, reason="test")["editorPlacement"]["paths"]), 20)

    def test_binding_cannot_be_reassigned_or_primary_claim_another_owner(self) -> None:
        with self.assertRaisesRegex(ValueError, "already_bound"):
            bind_editor_renderer(S, B, "secondary")
        with self.assertRaises(ValueError):
            bind_editor_renderer(A, B, "primary")

    async def test_delayed_close_does_not_publish_after_document_reopens(self) -> None:
        write_client_document_open(self.project, self.path, A)
        snapshot = read_sidecar_open_state(self.project, reason="test")
        result = close_client_presentation(self.project, self.path, A,
            expected_revision=snapshot["revision"], expected_generation=9)
        write_client_document_open(self.project, self.path, A)
        event = event_bus.build_event("DocumentClosed", project_root=self.project,
            project_generation=9, source="test", payload={
                "openState": dict(result["openState"]), "closedPath": self.path,
                "affectedForegrounds": [],
            })
        with patch.object(open_state_events, "publish_open_state_changed", new=self.open_changed):
            await open_state_events._handle_document_closed_event(event)
        self.assertFalse(self.events)

    async def close_secondary_area(self) -> dict[str, object]:
        snapshot = read_client_open_state(self.project, S, reason="test")
        return await backend.handle_host_client_foreground_clear_request({
            "clientInstanceId": S, "clientRole": "secondary",
            "projectPath": self.project, "revision": snapshot["revision"], "projectGeneration": 9,
        }, source_name=S)

    async def test_actual_secondary_close_route_closes_last_local_document_everywhere(self) -> None:
        write_client_document_open(self.project, self.path, S)
        write_client_document_open(self.project, self.path, T)
        await self.close_secondary_area()
        assert self.events == ["document"]
        for renderer in (A, S, B, T):
            self.assertFalse(read_client_open_state(self.project, renderer, reason="test")["recents"])
            self.assertIsNone(read_client_foreground(self.project, renderer)["path"])

    async def test_actual_area_close_preserves_primary_copy_but_closes_secondary_only_files(self) -> None:
        write_client_document_open(self.project, self.path, A)
        write_client_document_open(self.project, self.path, S)
        other = str(Path(self.project) / "other.cpp")
        Path(other).write_text("other")
        write_client_document_open(self.project, other, S)
        await self.close_secondary_area()
        assert ProjectSidecar(self.project).read_editor_open_state().documents == (self.path,)
        self.assertFalse(read_client_open_state(self.project, S, reason="test")["editorPlacement"]["paths"])
        assert read_client_open_state(self.project, A, reason="test")["editorPlacement"]["paths"] == [self.path]
        assert self.events == ["document"]

    def test_existing_empty_primary_foreground_recovers_backend_open_document(self) -> None:
        self.assertIsNone(read_client_foreground(self.project, A)["path"])
        write_client_document_open(self.project, self.path, B)
        self.assertEqual(read_client_foreground(self.project, A)["path"], self.path)

    async def test_area_close_stale_request_does_not_close_any_document(self) -> None:
        write_client_document_open(self.project, self.path, S)
        snapshot = read_client_open_state(self.project, S, reason="test")
        with self.assertRaises(StaleEditorOpenState):
            await backend.handle_host_client_foreground_clear_request({
                "clientInstanceId": S, "clientRole": "secondary", "projectPath": self.project,
                "revision": snapshot["revision"] - 1, "projectGeneration": 9,
            }, source_name=S)
        assert ProjectSidecar(self.project).read_editor_open_state().documents == (self.path,)
        self.assertFalse(self.events)

    async def test_area_close_preserves_draft_and_disk_content(self) -> None:
        write_client_document_open(self.project, self.path, S)
        sidecar = ProjectSidecar(self.project)
        sidecar.upsert_cached_document(self.path, "draft β\n", "0" * 64, "run", "shell", "shell-run", 1, 2)
        sidecar.save()
        await self.close_secondary_area()
        draft = ProjectSidecar(self.project).get_cached_document(self.path)
        assert draft is not None
        self.assertEqual(draft.get("content"), "draft β\n")
        self.assertEqual(Path(self.path).read_text(), "working\n")

    async def test_pixel_orphaned_secondary_restores_into_primary_without_global_close(self) -> None:
        write_client_document_open(self.project, self.path, S)
        write_client_foreground(self.project, None, S, client_role="secondary", reason="legacy_close")
        before = ProjectSidecar(self.project).read_editor_open_state()
        self.assertIsNone(read_client_foreground(self.project, A)["path"])
        self.assertTrue(await secondary_content.reconcile_secondary_restore(S, "secondary"))
        after = ProjectSidecar(self.project).read_editor_open_state()
        assert after.documents == before.documents
        assert after.placement(A).primary == (self.path,)
        assert after.placement(A).secondary == ()
        assert after.placement(B) == before.placement(B)
        self.assertEqual(read_client_foreground(self.project, A)["path"], self.path)
        self.assertIsNone(read_client_foreground(self.project, S, client_role="secondary")["path"])
        assert self.events == ["state", "foreground"]
        self.assertFalse(await secondary_content.reconcile_secondary_restore(S, "secondary"))
        self.assertEqual(ProjectSidecar(self.project).read_editor_open_state().revision, after.revision)

    async def test_valid_working_secondary_restore_keeps_placement(self) -> None:
        write_client_document_open(self.project, self.path, S)
        before = ProjectSidecar(self.project).read_editor_open_state()
        self.assertFalse(await secondary_content.reconcile_secondary_restore(S, "secondary"))
        self.assertEqual(ProjectSidecar(self.project).read_editor_open_state(), before)

    async def test_pending_and_active_history_prevent_rehoming(self) -> None:
        write_client_document_open(self.project, self.path, S)
        token = secondary_content.begin_historical_content(S, "secondary")
        write_client_foreground(self.project, None, S, client_role="secondary", reason="preparing_history")
        before = ProjectSidecar(self.project).read_editor_open_state()
        self.assertFalse(await secondary_content.reconcile_secondary_restore(S, "secondary"))
        content = HistoricalContent("c" * 64, HistoryBlobPair("a" * 40, None, 0,
            HistoryBlobSide("absent", None, None, None),
            HistoryBlobSide("text", "file.cpp", "b" * 40, "historical\n")))
        secondary_content.commit_historical_content(token, content)
        self.assertFalse(await secondary_content.reconcile_secondary_restore(S, "secondary"))
        self.assertEqual(ProjectSidecar(self.project).read_editor_open_state(), before)

    def test_orphan_recovery_generation_fence_prevents_mutation(self) -> None:
        write_client_document_open(self.project, self.path, S)
        write_client_foreground(self.project, None, S, client_role="secondary", reason="legacy_close")
        before = ProjectSidecar(self.project).read_editor_open_state()
        with self.assertRaisesRegex(ValueError, "generation"):
            recover_orphaned_secondary(self.project, S, expected_generation=8)
        self.assertEqual(ProjectSidecar(self.project).read_editor_open_state(), before)

    def host_state_for_restore_test(self) -> dict[str, object]:
        return {"activeProject": self.project}

    async def test_actual_secondary_boot_repairs_orphan_before_snapshot_projection(self) -> None:
        write_client_document_open(self.project, self.path, S)
        write_client_foreground(self.project, None, S, client_role="secondary", reason="legacy_close")
        with patch.object(boot_snapshot_backend, "_build_host_state_payload", new=self.host_state_for_restore_test):
            await boot_snapshot_backend.handle_boot_snapshot_request({
                "scope": "hostState", "clientInstanceId": S, "clientRole": "secondary",
            }, source_name=S)
        assert read_client_open_state(self.project, A, reason="test")["editorPlacement"]["paths"] == [self.path]
        self.assertFalse(read_client_open_state(self.project, S, reason="test")["editorPlacement"]["paths"])
        self.assertEqual(read_client_foreground(self.project, A)["path"], self.path)
        self.assertNotIn("document", self.events)
