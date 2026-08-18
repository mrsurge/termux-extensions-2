from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock, patch

from app.apps.code_te2 import boot_snapshot_backend
from app.apps.code_te2 import code_server_shell_manager
from app.apps.code_te2 import workbench_adapter_shell_manager
from app.apps.code_te2.extension_registry import CodeServerInstallation
from app.apps.code_te2.host import code_server_backend
from app.apps.code_te2.monaco_editor.editor_backend_services.contracts import JsonMap


def _installation() -> CodeServerInstallation:
    root = Path("/managed/code-server/4.130.0")
    return CodeServerInstallation(
        executable=root / "bin" / "code-server",
        vscode_root=root / "lib" / "vscode",
        source="te2-managed",
    )


class CodeServerLanguageBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_host_state_snapshot_scope_avoids_full_boot_payload(self) -> None:
        host_state = {"activeProject": "/workspace"}
        with patch.object(
            boot_snapshot_backend,
            "_build_host_state_payload",
            return_value=host_state,
        ) as build_host_state:
            result = await boot_snapshot_backend.handle_boot_snapshot_request(
                {"scope": "hostState"},
                source_name="test",
            )

        self.assertEqual(
            {"ok": True, "snapshot": {"host_state": host_state}},
            result,
        )
        build_host_state.assert_called_once_with()

    async def test_full_boot_snapshot_is_single_flight(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def build_snapshot() -> JsonMap:
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return {"ok": True, "snapshot": {}}

        boot_snapshot_backend._boot_snapshot_task = None
        with patch.object(
            boot_snapshot_backend,
            "_build_full_boot_snapshot",
            side_effect=build_snapshot,
        ):
            first = asyncio.create_task(
                boot_snapshot_backend.handle_boot_snapshot_request(
                    {},
                    source_name="first",
                )
            )
            await started.wait()
            second = asyncio.create_task(
                boot_snapshot_backend.handle_boot_snapshot_request(
                    {},
                    source_name="second",
                )
            )
            await asyncio.sleep(0)
            self.assertEqual(1, calls)
            release.set()
            first_result, second_result = await asyncio.gather(first, second)

        self.assertEqual(first_result, second_result)
        self.assertIsNone(boot_snapshot_backend._boot_snapshot_task)

    async def test_legacy_extension_bridge_cleanup_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            extensions_dir = Path(temp_dir)
            bridge_dir = extensions_dir / "te2-extension-api-bridge"
            bridge_dir.mkdir()
            (bridge_dir / "package.json").write_text("{}", encoding="utf-8")
            manifest_path = extensions_dir / "extensions.json"
            manifest_path.write_text(
                json.dumps(
                    [
                        {
                            "identifier": {"id": "te2.te2-extension-api-bridge"},
                            "relativeLocation": "te2-extension-api-bridge",
                        },
                        {
                            "identifier": {"id": "example.keep"},
                            "relativeLocation": "example.keep-1.0.0",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            with patch.object(
                code_server_shell_manager,
                "_EXTENSIONS_DIR",
                extensions_dir,
            ):
                first = code_server_shell_manager.remove_legacy_bridge_extension()
                second = code_server_shell_manager.remove_legacy_bridge_extension()

            self.assertTrue(first)
            self.assertFalse(second)
            self.assertFalse(bridge_dir.exists())
            entries = json.loads(manifest_path.read_text("utf-8"))
            self.assertEqual(["example.keep"], [entry["identifier"]["id"] for entry in entries])

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

    async def test_worker_mode_stops_runtime_preserves_managed_tree_then_persists(self) -> None:
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
        self.assertTrue(data["managedRuntimePreserved"])

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
