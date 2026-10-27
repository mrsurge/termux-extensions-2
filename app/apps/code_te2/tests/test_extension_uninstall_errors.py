from __future__ import annotations

from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from app.apps.code_te2 import extension_registry as registry
from app.apps.code_te2.code_server_identity import CodeServerInstallation


DEPENDENCY = (
    "Cannot uninstall 'Language Support for Java(TM) by Red Hat' extension. "
    "'Code Groovy' extension depends on this."
)
TRACE = "\n[error] Uncaught exception: Canceled\n    at uninstallExtensions (server-main.js:1:2)"


class ExtensionUninstallErrorsTest(unittest.TestCase):
    def test_dependency_explanation_excludes_following_trace(self) -> None:
        message = registry._uninstall_failure_message("redhat.java", DEPENDENCY + TRACE, 1)
        self.assertIn("Code Groovy", message)
        self.assertIn("Uninstall the dependent extension(s) first", message)
        self.assertNotIn("Canceled", message)
        self.assertNotIn("server-main", message)

    def test_dependency_can_follow_other_process_output(self) -> None:
        message = registry._uninstall_failure_message("redhat.java", "Preparing…\n" + DEPENDENCY, 1)
        self.assertIn("Code Groovy", message)

    def test_unknown_failure_is_short_and_points_to_logs(self) -> None:
        message = registry._uninstall_failure_message("redhat.java", TRACE * 500, 2)
        self.assertIn("redhat.java", message)
        self.assertIn("exit code 2", message)
        self.assertIn("worker logs", message)
        self.assertLess(len(message), 200)
        self.assertNotIn("server-main", message)

    def test_failed_uninstall_logs_both_streams_and_does_not_rescan(self) -> None:
        def load() -> registry.Registry:
            return {"extensions": {"redhat.java": {"source": "user"}}}

        def installation() -> CodeServerInstallation:
            return CodeServerInstallation(Path("/not-executed/code-server"), None, "test")

        def run(
            command: list[str], *, capture_output: bool, text: bool,
            timeout: int, env: dict[str, str],
        ) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(command, 1, DEPENDENCY, TRACE)

        def rescan() -> registry.Registry:
            self.fail("A failed uninstall must not publish a successful registry rescan")

        def environment(installation: CodeServerInstallation) -> dict[str, str]:
            return {}

        with (
            patch.object(registry, "load_registry", new=load),
            patch.object(registry, "_require_code_server_installation", new=installation),
            patch.object(registry, "_code_server_subprocess_env", new=environment),
            patch.object(subprocess, "run", new=run),
            patch.object(registry, "scan_and_rebuild", new=rescan),
            self.assertLogs(registry.__name__, level="ERROR") as logs,
        ):
            with self.assertRaisesRegex(RuntimeError, "Code Groovy") as raised:
                registry.uninstall_extension("redhat.java")
        self.assertNotIn("server-main", str(raised.exception))
        self.assertIn(DEPENDENCY, "\n".join(logs.output))
        self.assertIn(TRACE, "\n".join(logs.output))
