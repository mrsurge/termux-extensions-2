# pyright: strict
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framework_shells.record import ShellRecord

from app.apps.code_te2.code_server_shell_manager import code_server_connection_target
from app.apps.code_te2.main_page.backend.workbench_routes import (
    ShellRecordLike,
    WorkbenchExtensionSidecarLike,
)
from app.apps.code_te2.project_sidecar import ProjectSidecar


class WorkbenchRouteContractTests(unittest.TestCase):
    def test_framework_record_satisfies_routes_and_connection_target(self) -> None:
        # Direct assignment checks the real provider type, without a cast hiding drift.
        record: ShellRecordLike = ShellRecord(
            id="test-shell", command=["code-server", "--socket", "/test.sock"],
            label="code-server", cwd="/", env_overrides={"TE_CODE_SERVER_SOCKET": "/test.sock"},
            pid=None, status="running", created_at=0, updated_at=0,
            autostart=False, stdout_log="", stderr_log="",
        )
        self.assertEqual(code_server_connection_target(record), ("http://localhost", "/test.sock"))

    def test_sidecar_setters_return_updated_enabled_list(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-route-contract-") as scratch:
            path = Path(scratch)
            with patch.object(ProjectSidecar, "get_sidecar_path", return_value=path / "sidecar.json"):
                sidecar: WorkbenchExtensionSidecarLike = ProjectSidecar(str(path))
                self.assertEqual(sidecar.set_workbench_enabled_extensions(["a", "a"]), ["a"])
                self.assertEqual(sidecar.enable_workbench_extension("b"), ["a", "b"])
                self.assertEqual(sidecar.disable_workbench_extension("a"), ["b"])
                sidecar.save()
                self.assertEqual(sidecar.get_workbench_enabled_extensions(), ["b"])
