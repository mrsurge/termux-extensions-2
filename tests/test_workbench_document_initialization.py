from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from typing import cast
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import workbench_adapter_shell_manager as manager
from app.apps.code_te2 import workbench_document_initialization as initialization
from app.apps.code_te2.open_state_backend import write_sidecar_open_file
from app.apps.code_te2.project_sidecar import ProjectSidecar


class InitialDocumentsTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_persisted_draft_is_in_connect_request_before_ready(self) -> None:
        scratch = os.environ.get("TMPDIR") or str(Path.cwd() / ".codex-scratch")
        Path(scratch).mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as raw:
            root = Path(raw)
            project = root / "project"
            project.mkdir()
            path = project / "codec.py"
            disk = "import missing\n"
            draft = "import missing  # ty: ignore[unresolved-import]\n# λ 🦀\n"
            path.write_text(disk)
            with (
                patch.object(ProjectSidecar, "get_sidecar_path", return_value=root / "state.json"),
                patch.object(ProjectSidecar, "_instances", {}),
                patch.object(initialization, "current_project_generation", return_value=4),
            ):
                sidecar = ProjectSidecar.load_or_create(str(project))
                sidecar.upsert_cached_document(str(path), draft, hashlib.sha256(disk.encode()).hexdigest(),
                    "test", "test", "test", 0, 0)
                sidecar.save()
                write_sidecar_open_file(str(project), str(path))
                # Drop the in-process sidecar: this must be disk-persisted state.
                ProjectSidecar._instances.clear()
                events: list[str] = []

                async def rpc(method: str, params: dict[str, object], timeout: float) -> dict[str, object]:
                    self.assertEqual(method, "adapter.connect")
                    seed = params["initialDocuments"]
                    assert isinstance(seed, dict)
                    seed = cast(dict[str, object], seed)
                    self.assertEqual(seed["projectGeneration"], 4)
                    documents = cast(list[dict[str, object]], seed["documents"])
                    document = documents[0]
                    self.assertEqual(document["text"], draft)
                    self.assertTrue(document["dirty"])
                    self.assertEqual(document["contentSha256"], hashlib.sha256(draft.encode()).hexdigest())
                    self.assertEqual(path.read_text(), disk)
                    self.assertEqual(events, [])
                    events.append("connect_with_draft")
                    return {"result": {"ok": True}}

                async def ready(project_root: str) -> None:
                    self.assertEqual(events, ["connect_with_draft"])
                    events.append("ready")

                with patch.object(manager, "adapter_rpc", side_effect=rpc), patch.object(manager, "_publish_ready_if_changed", side_effect=ready):
                    await manager._connect_prepared_adapter(str(project), "http://localhost", "/fake.sock", None)
                self.assertEqual(events, ["connect_with_draft", "ready"])

    async def test_ready_open_uses_the_already_materialized_body_not_disk(self) -> None:
        rpc = AsyncMock(return_value={"result": {"ok": True}})
        with patch.object(manager, "get_adapter_state", return_value={"status": "ready", "project": "/project"}), patch.object(manager, "adapter_rpc", rpc):
            await initialization.prepare_open_document("/project", {
                "path": "/project/file.py", "content": "draft", "unsaved": True,
                "base_sha256": "base",
            }, 7)
        assert rpc.await_args is not None
        method, params = rpc.await_args.args
        self.assertEqual(method, "vscode.documents.initialize")
        self.assertEqual(params["documents"][0]["text"], "draft")
        self.assertEqual(params["openStateRevision"], 7)

    async def test_unready_open_does_not_start_another_adapter_or_network_request(self) -> None:
        rpc = AsyncMock()
        with patch.object(manager, "get_adapter_state", return_value={"status": "starting"}), patch.object(manager, "adapter_rpc", rpc):
            await initialization.prepare_open_document("/project", {"path": "/project/file.py", "content": "draft"}, 7)
        rpc.assert_not_awaited()
