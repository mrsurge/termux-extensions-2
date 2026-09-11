# pyright: strict
from __future__ import annotations

import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from typing import cast, final, override
from unittest.mock import patch

from app.apps.code_te2 import boot_snapshot_backend, project_sidecar
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.host import secondary_content_backend as backend
from app.apps.code_te2.host.secondary_content_state import HistoricalContent
from app.apps.code_te2.open_state_backend import (
    read_client_foreground, read_sidecar_open_state, write_client_document_open,
)
from app.apps.code_te2.worker_services import event_bus
from app.apps.code_te2.worker_services.history_service import HistoryBlobPair, HistoryBlobSide

CLIENT = "client_bbbbbbbbbbbb"
PRIMARY = "client_aaaaaaaaaaaa"
CONTENT = HistoricalContent("a" * 64, HistoryBlobPair("b" * 40, None, 0,
    HistoryBlobSide("absent", None, None, None),
    HistoryBlobSide("text", "file.py", "c" * 40, "historical\n")))


def mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


@final
class SecondaryContentBackendTests(unittest.IsolatedAsyncioTestCase):
    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.stack: ExitStack = ExitStack()
        self.project: str = ""
        self.path: str = ""

    @override
    def setUp(self) -> None:
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.project = str(root / "project")
        Path(self.project).mkdir()
        self.path = str(Path(self.project) / "file.py")
        _ = Path(self.path).write_text("working\n", encoding="utf-8")
        _ = self.stack.enter_context(patch.object(project_sidecar, "_sidecar_root", return_value=root / "sidecars"))
        _ = self.stack.enter_context(patch.object(HistoryStore, "get_active_project", return_value=self.project))
        _ = self.stack.enter_context(patch.object(event_bus, "current_project_generation", return_value=1))
        _ = write_client_document_open(self.project, self.path, PRIMARY, require_existing_sidecar=False)
        _ = write_client_document_open(self.project, self.path, CLIENT)

    @override
    def tearDown(self) -> None:
        backend.close_secondary_content(CLIENT)
        backend.close_secondary_content(PRIMARY)

    def test_activation_preserves_disk_membership_and_primary(self) -> None:
        sidecar = project_sidecar.ProjectSidecar.load_or_create(self.project)
        draft = sidecar.upsert_cached_document(self.path, "unsaved draft\n", "d" * 64,
            "run", "shell", "shell-run", 1, 2)
        sidecar.save()
        before = read_sidecar_open_state(self.project, reason="test")
        token = backend.begin_historical_content(CLIENT, "secondary")
        result = backend.commit_historical_content(token, CONTENT)
        assert result is not None
        self.assertIsNone(result.foreground["path"])
        self.assertEqual(result.foreground["reason"], backend.HISTORICAL_REASON)
        self.assertEqual(result.open_state["recents"], before["recents"])
        self.assertEqual(read_client_foreground(self.project, PRIMARY)["path"], self.path)
        self.assertEqual(Path(self.path).read_text(), "working\n")
        projection = backend.secondary_content_projection(CLIENT, "secondary", self.project, None)
        assert projection is not None
        self.assertEqual(projection["kind"], "historicalDiff")
        sidecar.reload()
        self.assertEqual(sidecar.get_cached_document(self.path), draft)

    def test_stale_selection_never_clears_working_foreground(self) -> None:
        first = backend.begin_historical_content(CLIENT, "secondary")
        latest = backend.begin_historical_content(CLIENT, "secondary")
        self.assertIsNone(backend.commit_historical_content(first, CONTENT))
        self.assertEqual(read_client_foreground(self.project, CLIENT)["path"], self.path)
        backend.abort_historical_content(latest)
        self.assertIsNone(backend.commit_historical_content(latest, CONTENT))

    def test_queued_old_fact_does_not_clear_new_history(self) -> None:
        previous = read_client_foreground(self.project, CLIENT)
        token = backend.begin_historical_content(CLIENT, "secondary")
        result = backend.commit_historical_content(token, CONTENT)
        assert result is not None
        backend.reconcile_secondary_foreground(previous)
        self.assertIsNotNone(backend.secondary_content_projection(CLIENT, "secondary", self.project, None))
        _, newer = write_client_document_open(self.project, self.path, CLIENT)
        backend.reconcile_secondary_foreground(newer)
        self.assertIsNone(backend.secondary_content_projection(CLIENT, "secondary", self.project, None))

    async def test_project_switch_releases_descriptors_and_pending_reads(self) -> None:
        token = backend.begin_historical_content(CLIENT, "secondary")
        await event_bus.publish(event_bus.build_event("ProjectSwitchStarted", project_root="/new",
            project_generation=2, source="test"))
        self.assertIsNone(backend.commit_historical_content(token, CONTENT))

    def test_boot_projection_is_personal_and_does_not_mutate_shared_snapshot(self) -> None:
        token = backend.begin_historical_content(CLIENT, "secondary")
        self.assertIsNotNone(backend.commit_historical_content(token, CONTENT))
        shared: dict[str, object] = {"snapshot": {"host_state": {"activeProject": self.project, "currentPath": None}}}
        result = boot_snapshot_backend._overlay_secondary_content(shared, CLIENT, "secondary")  # pyright: ignore[reportPrivateUsage]
        host = mapping(mapping(result["snapshot"])["host_state"])
        self.assertEqual(mapping(host["secondaryContent"])["commitId"], "b" * 40)
        self.assertNotIn("secondaryContent", mapping(mapping(shared["snapshot"])["host_state"]))
        self.assertIsNone(backend.secondary_content_projection(PRIMARY, "primary", self.project, None))

    def test_project_generation_mismatch_rejects_before_mutation(self) -> None:
        token = backend.begin_historical_content(CLIENT, "secondary")
        with patch.object(event_bus, "current_project_generation", return_value=2):
            self.assertIsNone(backend.commit_historical_content(token, CONTENT))
        self.assertEqual(read_client_foreground(self.project, CLIENT)["path"], self.path)
