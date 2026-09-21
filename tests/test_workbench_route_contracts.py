# pyright: strict
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framework_shells.record import ShellRecord

from app.apps.code_te2.code_server_shell_manager import (
    ConnectionRecord,
    code_server_connection_target,
)
from app.apps.code_te2.project_sidecar import ProjectSidecar


class WorkbenchRouteContractTests(unittest.TestCase):
    def test_framework_record_satisfies_active_connection_target(self) -> None:
        # Direct assignment checks the real provider type, without a cast hiding drift.
        record: ConnectionRecord = ShellRecord(
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
                sidecar = ProjectSidecar(str(path))
                self.assertEqual(sidecar.set_workbench_enabled_extensions(["a", "a"]), ["a"])
                self.assertEqual(sidecar.enable_workbench_extension("b"), ["a", "b"])
                self.assertEqual(sidecar.disable_workbench_extension("a"), ["b"])
                sidecar.save()
                self.assertEqual(sidecar.get_workbench_enabled_extensions(), ["b"])

    def test_http_router_removed_without_replacing_live_startup(self) -> None:
        root = Path(__file__).resolve().parents[1] / "app/apps/code_te2"
        self.assertFalse((root / "main_page/backend/workbench_routes.py").exists())
        source = (root / "main.py").read_text()
        for retired in ("workbench_routes", "_WORKBENCH_ROUTES_DEPS", "_for_routes", "_get_framework_shell_by_id"):
            self.assertNotIn(retired, source)
        self.assertIn("set_code_server_runtime_primer(_prime_code_server_runtime)", source)
        self.assertIn("await prime_intelligence_runtime(project_root)", source)
        self.assertIn("start_worker_runtime(_initialize_application_project, _eager_start_code_server)", source)
        self.assertNotIn("_ensure_workbench_json_sync", source)
        self.assertIn("IntelligenceStateStore().read().web_workers_enabled", source)
        self.assertIn("socket_app=CODE_TE2_ASGI_APP", source)
