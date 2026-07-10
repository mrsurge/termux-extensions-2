from __future__ import annotations

import unittest
from pathlib import Path

from app.extensions.apps.manifest_validation import validate_proxy_shell_manifest
from app.extensions.apps.registry import AppRegistry


REPO_ROOT = Path(__file__).resolve().parents[1]


class ManifestSupportTests(unittest.TestCase):
    def test_builtin_catalog_loads_current_apps(self) -> None:
        app_ids = {app.app_id for app in AppRegistry().reload()}
        self.assertIn("file_editor_cm6", app_ids)
        self.assertIn("terminal", app_ids)
        self.assertNotIn("codex_agent", app_ids)

    def test_proxy_manifest_validation_is_runtime_independent(self) -> None:
        errors = validate_proxy_shell_manifest(
            {
                "id": "example",
                "proxy_shell": {
                    "start_path": "/",
                    "health_path": "/health",
                    "rewrite": {
                        "ws_template_marker": "__WS__",
                        "ws_template_replacement": "{proxy_prefix}/ws",
                    },
                },
            }
        )
        self.assertEqual([], errors)

        errors = validate_proxy_shell_manifest(
            {"id": "broken", "proxy_shell": {"start_path": "/"}}
        )
        self.assertTrue(any("health_path" in error for error in errors))


class PruneBoundaryTests(unittest.TestCase):
    def test_retired_python_framework_modules_are_absent(self) -> None:
        retired = [
            "app/main.py",
            "app/supervisor.py",
            "app/cli/run_framework.py",
            "app/ipc/server.py",
            "app/extensions/apps/loader.py",
            "app/extensions/apps/runtime.py",
            "app/libs/app_lifecycle.py",
            "app/libs/git_service.py",
        ]
        present = [path for path in retired if (REPO_ROOT / path).exists()]
        self.assertEqual([], present)


if __name__ == "__main__":
    unittest.main()
