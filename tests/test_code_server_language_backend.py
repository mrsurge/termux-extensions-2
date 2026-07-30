from __future__ import annotations

import unittest
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock, patch

from app.apps.file_editor_cm6 import boot_snapshot_backend
from app.apps.file_editor_cm6 import code_server_shell_manager
from app.apps.file_editor_cm6 import workbench_adapter_shell_manager
from app.apps.file_editor_cm6.extension_registry import CodeServerInstallation
from app.apps.file_editor_cm6.host import code_server_backend
from app.apps.file_editor_cm6.monaco_editor.editor_backend_services.contracts import JsonMap


def _installation() -> CodeServerInstallation:
    root = Path("/managed/code-server/4.130.0")
    return CodeServerInstallation(
        executable=root / "bin" / "code-server",
        vscode_root=root / "lib" / "vscode",
        source="te2-managed",
    )


class CodeServerLanguageBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_code_server_mode_persists_only_after_runtime_prime(self) -> None:
        installation = _installation()
        persist = AsyncMock(return_value={"webWorkersEnabled": False})
        prime = AsyncMock()
        with (
            patch.object(
                code_server_backend,
                "install_code_server_installation",
                return_value=installation,
            ),
            patch.object(code_server_backend, "_active_project", return_value="/workspace"),
            patch.object(code_server_backend, "prime_code_server_runtime", prime),
            patch.object(code_server_backend, "_persist_mode", persist),
            patch.object(
                code_server_backend,
                "inspect_code_server_prerequisite",
            ) as prerequisite,
        ):
            prerequisite.return_value.payload.return_value = {"compatible": True}
            response = await code_server_backend.handle_host_language_backend_set_request(
                {"mode": "code-server"},
                source_name="test",
            )

        self.assertTrue(response["ok"])
        prime.assert_awaited_once_with("/workspace")
        persist.assert_awaited_once_with(web_workers_enabled=False)

    async def test_failed_runtime_prime_does_not_change_mode(self) -> None:
        persist = AsyncMock()
        with (
            patch.object(
                code_server_backend,
                "install_code_server_installation",
                return_value=_installation(),
            ),
            patch.object(code_server_backend, "_active_project", return_value="/workspace"),
            patch.object(
                code_server_backend,
                "prime_code_server_runtime",
                AsyncMock(side_effect=RuntimeError("prime failed")),
            ),
            patch.object(code_server_backend, "_persist_mode", persist),
            patch.object(
                code_server_backend,
                "inspect_code_server_prerequisite",
            ) as prerequisite,
        ):
            prerequisite.return_value.payload.return_value = {"compatible": True}
            response = await code_server_backend.handle_host_language_backend_set_request(
                {"mode": "code-server"},
                source_name="test",
            )

        self.assertFalse(response["ok"])
        persist.assert_not_awaited()

    async def test_worker_mode_stops_runtime_removes_managed_tree_then_persists(self) -> None:
        persist = AsyncMock(return_value={"webWorkersEnabled": True})
        cancel = AsyncMock()
        stop_adapter = AsyncMock(return_value=True)
        stop_code_server = AsyncMock(return_value=True)
        with (
            patch.object(
                code_server_backend,
                "cancel_backend_runtime_prepare_tasks",
                cancel,
            ),
            patch.object(
                workbench_adapter_shell_manager,
                "terminate_adapter_shell",
                stop_adapter,
            ),
            patch.object(
                code_server_shell_manager,
                "terminate_code_server_shell",
                stop_code_server,
            ),
            patch.object(
                code_server_backend,
                "remove_code_server_installation",
                return_value=True,
            ),
            patch.object(code_server_backend, "_persist_mode", persist),
            patch.object(
                code_server_backend,
                "inspect_code_server_prerequisite",
            ) as prerequisite,
        ):
            prerequisite.return_value.payload.return_value = {"compatible": False}
            response = await code_server_backend.handle_host_language_backend_set_request(
                {"mode": "web-workers"},
                source_name="test",
            )

        self.assertTrue(response["ok"])
        cancel.assert_awaited_once()
        stop_adapter.assert_awaited_once()
        stop_code_server.assert_awaited_once()
        persist.assert_awaited_once_with(web_workers_enabled=True)
        data = cast(JsonMap, response["data"])
        self.assertTrue(data["managedRuntimeRemoved"])

    async def test_backend_boot_prime_is_skipped_in_worker_mode(self) -> None:
        prime = AsyncMock()
        with (
            patch.object(boot_snapshot_backend, "_web_workers_enabled", return_value=True),
            patch.object(boot_snapshot_backend, "prime_code_server_runtime", prime),
        ):
            await boot_snapshot_backend._prime_backend_runtime("/workspace")

        prime.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
