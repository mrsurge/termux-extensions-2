from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from typing import cast, override
from unittest.mock import patch

from app.apps.code_te2 import logical_document_reconciler as reconciler_module
from app.apps.code_te2.logical_document_reconciler import (
    LogicalDocumentDescriptor,
    LogicalDocumentReconciler,
    LogicalDocumentSnapshot,
    LogicalHydrationRequest,
    build_logical_document_snapshot,
    materialize_logical_document_hydration,
)
from app.apps.code_te2.open_state_backend import SidecarOpenStatePayload
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2.worker_services.event_bus import JsonObject, WorkerEvent


class _FakeSidecar:
    entries: dict[str, dict[str, object]] = {}

    def __init__(self, project_path: str) -> None:
        self.project_path: str = project_path

    def get_cached_document(self, file_path: str) -> dict[str, object] | None:
        entry = self.entries.get(file_path)
        return dict(entry) if entry is not None else None


def _open_state(
    project: str,
    *,
    revision: int,
    active: str | None,
    recents: list[str],
) -> SidecarOpenStatePayload:
    return {
        "projectPath": project,
        "sidecarPath": "/sidecar.json",
        "openFile": active,
        "openFileRel": Path(active).name if active else None,
        "openFileExists": active is not None,
        "invalidOpenFile": None,
        "revision": revision,
        "reason": "file_open",
        "ts": 1,
        "recents": [
            {
                "path": path,
                "label": Path(path).name,
                "opened_at": None,
                "exists": True,
                "scroll_line": None,
            }
            for path in recents
        ],
    }


def _event(
    event_type: str,
    project: str | None,
    payload: JsonObject,
) -> WorkerEvent:
    return cast(
        WorkerEvent,
        cast(object, {
            "type": event_type,
            "project_root": project,
            "project_generation": None,
            "emitted_at_ms": 1,
            "source": "test",
            "correlation_id": None,
            "payload": payload,
        }),
    )


def _temp_dir() -> tempfile.TemporaryDirectory[str]:
    return tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR") or str(Path.cwd()))


class LogicalDocumentSnapshotTests(unittest.TestCase):
    @override
    def setUp(self) -> None:
        _FakeSidecar.entries = {}

    def test_snapshot_uses_draft_sha_and_clean_stat_without_reading_content(
        self,
    ) -> None:
        with _temp_dir() as raw_project:
            project = str(Path(raw_project).resolve())
            active = str(Path(project, "active.py"))
            draft = str(Path(project, "draft.py"))
            clean = str(Path(project, "clean.py"))
            missing = str(Path(project, "missing.py"))
            _ = Path(active).write_text("active\n", encoding="utf-8")
            _ = Path(clean).write_text("clean\n", encoding="utf-8")
            _FakeSidecar.entries[draft] = {
                "unsaved": True,
                "content": "draft\n",
                "content_sha256": "draft-sha",
                "base_sha256": "base-sha",
            }
            state = _open_state(
                project,
                revision=7,
                active=active,
                recents=[active, draft, clean, missing, "/outside.py"],
            )

            with (
                patch.object(reconciler_module, "ProjectSidecar", _FakeSidecar),
                patch.object(Path, "read_bytes", side_effect=AssertionError("content read")),
            ):
                snapshot = build_logical_document_snapshot(state, 3)

        self.assertEqual(snapshot["projectGeneration"], 3)
        self.assertEqual(snapshot["openStateRevision"], 7)
        self.assertIsNone(snapshot["activePath"])
        self.assertEqual(
            [item["path"] for item in snapshot["background"]],
            [active, draft, clean],
        )
        self.assertEqual(
            snapshot["background"][1],
            {
                "path": draft,
                "contentIdentity": "sha256:draft-sha",
                "baseSha256": "base-sha",
                "dirty": True,
            },
        )
        self.assertTrue(
            snapshot["background"][2]["contentIdentity"].startswith("stat-v1:")
        )
        self.assertFalse(snapshot["background"][2]["dirty"])

    def test_draft_hydration_works_without_a_disk_file(self) -> None:
        with _temp_dir() as raw_project:
            project = str(Path(raw_project).resolve())
            draft = str(Path(project, "draft.py"))
            _FakeSidecar.entries[draft] = {
                "unsaved": True,
                "content": "draft only\n",
                "content_sha256": "draft-sha",
                "base_sha256": "base-sha",
            }
            request: LogicalHydrationRequest = {
                "path": draft,
                "languageId": "python",
                "contentIdentity": "sha256:draft-sha",
                "baseSha256": "base-sha",
                "dirty": True,
                "reason": "missing",
                "expectedActiveEpoch": 4,
            }

            with patch.object(reconciler_module, "ProjectSidecar", _FakeSidecar):
                payload = materialize_logical_document_hydration(project, request)

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["text"], "draft only\n")
        self.assertEqual(payload["expectedActiveEpoch"], 4)

    def test_clean_hydration_rejects_a_stale_stat_identity(self) -> None:
        with _temp_dir() as raw_project:
            project = str(Path(raw_project).resolve())
            clean = str(Path(project, "clean.py"))
            _ = Path(clean).write_text("clean\n", encoding="utf-8")
            request: LogicalHydrationRequest = {
                "path": clean,
                "languageId": "python",
                "contentIdentity": "stat-v1:stale",
                "baseSha256": None,
                "dirty": False,
                "reason": "content_identity_mismatch",
                "expectedActiveEpoch": 2,
            }

            with (
                patch.object(reconciler_module, "ProjectSidecar", _FakeSidecar),
                patch.object(Path, "read_bytes", side_effect=AssertionError("stale read")),
            ):
                payload = materialize_logical_document_hydration(project, request)

        self.assertIsNone(payload)

    def test_snapshot_enforces_the_twelve_document_bound(self) -> None:
        with _temp_dir() as raw_project:
            project = str(Path(raw_project).resolve())
            paths = [str(Path(project, f"draft-{index}.py")) for index in range(14)]
            _FakeSidecar.entries = {
                path: {
                    "unsaved": True,
                    "content": f"draft {index}\n",
                    "content_sha256": f"sha-{index}",
                    "base_sha256": "base",
                }
                for index, path in enumerate(paths)
            }
            state = _open_state(
                project,
                revision=11,
                active=None,
                recents=paths,
            )

            with patch.object(reconciler_module, "ProjectSidecar", _FakeSidecar):
                snapshot = build_logical_document_snapshot(state, 4)

        self.assertEqual(len(snapshot["background"]), 12)
        self.assertEqual(
            [item["path"] for item in snapshot["background"]],
            paths[:12],
        )


class LogicalDocumentReconcilerTests(unittest.IsolatedAsyncioTestCase):
    def _snapshot_builder(
        self,
        open_state: SidecarOpenStatePayload,
        project_generation: int,
    ) -> LogicalDocumentSnapshot:
        project = open_state["projectPath"]
        background: list[LogicalDocumentDescriptor] = []
        for recent in open_state["recents"]:
            path = recent["path"]
            if path == open_state["openFile"]:
                continue
            background.append(
                {
                    "path": path,
                    "contentIdentity": f"revision:{open_state['revision']}:{path}",
                    "baseSha256": None,
                    "dirty": False,
                }
            )
        return {
            "projectPath": project,
            "projectGeneration": project_generation,
            "openStateRevision": open_state["revision"],
            "activePath": open_state["openFile"],
            "background": background,
        }

    async def test_ready_replays_snapshot_and_hydrates_only_requested_paths(
        self,
    ) -> None:
        project = "/workspace"
        active = f"{project}/active.py"
        requested = f"{project}/requested.py"
        unchanged = f"{project}/unchanged.py"
        calls: list[tuple[str, JsonObject]] = []
        materialized: list[str] = []

        async def adapter_call(
            method: str,
            params: JsonObject | None = None,
            timeout: float = 30.0,
        ) -> JsonObject:
            del timeout
            assert params is not None
            calls.append((method, params))
            if method.endswith("reconcile"):
                background = cast(list[JsonObject], params["background"])
                target = next(item for item in background if item["path"] == requested)
                return {
                    "result": {
                        "ok": True,
                        "hydration": [
                            {
                                **target,
                                "languageId": "python",
                                "reason": "missing",
                                "expectedActiveEpoch": 5,
                            }
                        ],
                    }
                }
            return {"result": {"ok": True, "action": "retained"}}

        def materializer(
            _project: str,
            request: LogicalHydrationRequest,
        ) -> JsonObject:
            materialized.append(request["path"])
            return {
                "path": request["path"],
                "text": "content\n",
                "languageId": request["languageId"],
                "contentIdentity": request["contentIdentity"],
                "baseSha256": request["baseSha256"],
                "dirty": request["dirty"],
                "expectedActiveEpoch": request["expectedActiveEpoch"],
            }

        reconciler = LogicalDocumentReconciler(
            adapter_call=adapter_call,
            snapshot_builder=self._snapshot_builder,
            hydration_materializer=materializer,
        )
        state = _open_state(
            project,
            revision=8,
            active=active,
            recents=[active, requested, unchanged],
        )
        with patch.object(reconciler_module, "current_project_generation", return_value=None):
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": state})
            )
            self.assertEqual(calls, [])
            await reconciler.handle_adapter_state(
                _event(
                    "AdapterStateChanged",
                    project,
                    {"state": {"status": "ready", "project": project}},
                )
            )
            await reconciler.wait_idle()

        self.assertEqual(
            [method for method, _params in calls],
            [
                "vscode.logicalDocuments.reconcile",
                "vscode.documents.initialize",
            ],
        )
        self.assertEqual(materialized, [requested])
        self.assertNotIn("text", calls[0][1])
        self.assertEqual(calls[1][1]["openStateRevision"], 8)

    async def test_newer_open_state_cancels_an_in_flight_older_revision(self) -> None:
        project = "/workspace"
        active = f"{project}/active.py"
        first_started = asyncio.Event()
        release_first = asyncio.Event()
        seen_revisions: list[int] = []

        async def adapter_call(
            method: str,
            params: JsonObject | None = None,
            timeout: float = 30.0,
        ) -> JsonObject:
            del timeout
            assert params is not None
            if method.endswith("reconcile"):
                revision = cast(int, params["openStateRevision"])
                seen_revisions.append(revision)
                if revision == 1:
                    _ = first_started.set()
                    _ = await release_first.wait()
                return {"result": {"ok": True, "hydration": []}}
            raise AssertionError(method)

        reconciler = LogicalDocumentReconciler(
            adapter_call=adapter_call,
            snapshot_builder=self._snapshot_builder,
        )
        first = _open_state(
            project,
            revision=1,
            active=active,
            recents=[active],
        )
        second = _open_state(
            project,
            revision=2,
            active=active,
            recents=[active],
        )
        with patch.object(reconciler_module, "current_project_generation", return_value=None):
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": first})
            )
            await reconciler.handle_adapter_state(
                _event(
                    "AdapterStateChanged",
                    project,
                    {"state": {"status": "ready", "project": project}},
                )
            )
            _ = await first_started.wait()
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": second})
            )
            _ = release_first.set()
            await reconciler.wait_idle()

        self.assertEqual(seen_revisions, [1, 2])

    async def test_adapter_reset_cancels_pending_work(self) -> None:
        project = "/workspace"
        started = asyncio.Event()
        release = asyncio.Event()

        async def adapter_call(
            method: str,
            params: JsonObject | None = None,
            timeout: float = 30.0,
        ) -> JsonObject:
            del method, params, timeout
            _ = started.set()
            _ = await release.wait()
            return {"result": {"ok": True, "hydration": []}}

        reconciler = LogicalDocumentReconciler(
            adapter_call=adapter_call,
            snapshot_builder=self._snapshot_builder,
        )
        state = _open_state(
            project,
            revision=1,
            active=None,
            recents=[],
        )
        with patch.object(reconciler_module, "current_project_generation", return_value=None):
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": state})
            )
            await reconciler.handle_adapter_state(
                _event(
                    "AdapterStateChanged",
                    project,
                    {"state": {"status": "ready", "project": project}},
                )
            )
            _ = await started.wait()
            await reconciler.handle_adapter_reset(
                _event("AdapterSessionReset", project, {})
            )
            _ = release.set()
            await reconciler.wait_idle()

        self.assertTrue(started.is_set())

    async def test_active_document_fact_reconciles_after_wba_promotion(self) -> None:
        project = "/workspace"
        active = f"{project}/active.py"
        revisions: list[int] = []

        async def adapter_call(
            method: str,
            params: JsonObject | None = None,
            timeout: float = 30.0,
        ) -> JsonObject:
            del timeout
            assert params is not None
            if method.endswith("reconcile"):
                revisions.append(cast(int, params["openStateRevision"]))
                return {"result": {"ok": True, "hydration": []}}
            raise AssertionError(method)

        reconciler = LogicalDocumentReconciler(
            adapter_call=adapter_call,
            snapshot_builder=self._snapshot_builder,
        )
        state = _open_state(
            project,
            revision=9,
            active=active,
            recents=[active],
        )
        with patch.object(reconciler_module, "current_project_generation", return_value=None):
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": state})
            )
            await reconciler.handle_adapter_state(
                _event(
                    "AdapterStateChanged",
                    project,
                    {"state": {"status": "ready", "project": project}},
                )
            )
            await reconciler.wait_idle()
            await reconciler.handle_active_document_changed(
                _event(
                    "AdapterActiveDocumentChanged",
                    project,
                    {"path": active, "activeEpoch": 1},
                )
            )
            await reconciler.wait_idle()

        self.assertEqual(revisions, [9, 9])

    async def test_draft_change_and_adapter_restart_replay_latest_snapshot(
        self,
    ) -> None:
        project = "/workspace"
        active = f"{project}/active.py"
        calls: list[int] = []

        async def adapter_call(
            method: str,
            params: JsonObject | None = None,
            timeout: float = 30.0,
        ) -> JsonObject:
            del timeout
            assert params is not None
            if method.endswith("reconcile"):
                calls.append(cast(int, params["openStateRevision"]))
                return {"result": {"ok": True, "hydration": []}}
            raise AssertionError(method)

        reconciler = LogicalDocumentReconciler(
            adapter_call=adapter_call,
            snapshot_builder=self._snapshot_builder,
        )
        state = _open_state(
            project,
            revision=12,
            active=active,
            recents=[active, f"{project}/background.py"],
        )
        with patch.object(reconciler_module, "current_project_generation", return_value=None):
            await reconciler.handle_open_state(
                _event("OpenStateChanged", project, {"openState": state})
            )
            ready = _event(
                "AdapterStateChanged",
                project,
                {"state": {"status": "ready", "project": project}},
            )
            await reconciler.handle_adapter_state(ready)
            await reconciler.wait_idle()
            await reconciler.handle_draft_state(
                _event("DraftStateChanged", project, {"drafts": {}})
            )
            await reconciler.wait_idle()
            await reconciler.handle_adapter_reset(
                _event("AdapterSessionReset", project, {})
            )
            await reconciler.handle_adapter_state(ready)
            await reconciler.wait_idle()

        self.assertEqual(calls, [12, 12, 12])

    async def test_switch_away_and_back_hydrates_real_sidecar_drafts_in_both_ready_orders(self) -> None:
        """Do not substitute disk text when restoring foreground/background recents."""
        with _temp_dir() as raw_root:
            root = Path(raw_root).resolve()
            generation = 1
            hydration: list[JsonObject] = []

            def sidecar_path(project: str) -> Path:
                return root / "state" / (hashlib.sha256(project.encode()).hexdigest() + ".json")

            async def adapter_call(
                method: str, params: JsonObject | None = None, timeout: float = 30.0,
            ) -> JsonObject:
                del timeout
                assert params is not None
                if method.endswith("reconcile"):
                    descriptors = cast(list[LogicalDocumentDescriptor], params["background"])
                    return {"result": {"ok": True, "hydration": [
                        {**item, "languageId": "rust", "reason": "missing", "expectedActiveEpoch": 0}
                        for item in descriptors
                    ]}}
                self.assertEqual(method, "vscode.documents.initialize")
                documents = cast(list[JsonObject], params["documents"])
                hydration.extend({**params, **document} for document in documents)
                return {"result": {"ok": True}}

            with (
                patch.object(ProjectSidecar, "get_sidecar_path", side_effect=sidecar_path),
                patch.object(ProjectSidecar, "_instances", {}),
                patch.object(reconciler_module, "current_project_generation", side_effect=lambda _project: generation),
            ):
                projects: list[tuple[str, list[str]]] = []
                for name in ("first", "second"):
                    project = root / name
                    project.mkdir()
                    sidecar = ProjectSidecar.load_or_create(str(project))
                    paths: list[str] = []
                    for filename in ("foreground.rs", "background.rs"):
                        path = project / filename
                        disk = f"// disk {name} {filename}\n"
                        path.write_text(disk, encoding="utf-8")
                        draft = f"// draft {name} {filename} λ\n"
                        sidecar.upsert_cached_document(
                            str(path), draft, hashlib.sha256(disk.encode()).hexdigest(),
                            "test", "test", "test", 0, 0,
                        )
                        paths.append(str(path))
                    sidecar.save()
                    projects.append((str(project), paths))

                reconciler = LogicalDocumentReconciler(adapter_call=adapter_call)
                for index, (project, paths) in enumerate((projects[0], projects[1], projects[0]), start=1):
                    generation = index
                    hydration.clear()
                    started = _event("ProjectSwitchStarted", project, {})
                    started["project_generation"] = generation
                    await reconciler.handle_project_switch_started(started)
                    state = _open_state(project, revision=index, active=paths[0], recents=paths)
                    opened = _event("OpenStateChanged", project, {"openState": state})
                    opened["project_generation"] = generation
                    ready = _event("AdapterWorkspaceReady", project, {})
                    ready["project_generation"] = generation
                    if index == 2:
                        await reconciler.handle_adapter_workspace_ready(ready)
                        await reconciler.handle_open_state(opened)
                    else:
                        await reconciler.handle_open_state(opened)
                        await reconciler.wait_idle()
                        self.assertEqual(hydration, [], "no hydration before adapter readiness")
                        await reconciler.handle_adapter_workspace_ready(ready)
                    await reconciler.wait_idle()
                    self.assertEqual([item["path"] for item in hydration], paths)
                    for item in hydration:
                        self.assertTrue(item["dirty"])
                        self.assertEqual(item["projectGeneration"], generation)
                        self.assertIn("// draft", str(item["text"]))
                        self.assertNotIn("// disk", str(item["text"]))
                        self.assertIn("λ", str(item["text"]))
                    stale = _event("OpenStateChanged", projects[1][0], {"openState": state})
                    stale["project_generation"] = generation - 1
                    hydration.clear()
                    await reconciler.handle_open_state(stale)
                    await reconciler.wait_idle()
                    self.assertEqual(hydration, [])
