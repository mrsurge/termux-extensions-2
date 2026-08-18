from __future__ import annotations

import unittest
from unittest.mock import patch

from app.apps.code_te2 import extension_navigation_backend


CLIENT_ID = "client_abcdefghijkl"


class ExtensionNavigationBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_open_waits_for_exact_editor_completion_before_wba_ack(self) -> None:
        adapter_calls: list[tuple[str, dict[str, object], float]] = []

        async def open_file(
            payload: dict[str, object],
            *,
            source_name: str,
            request_prefix: str,
        ) -> dict[str, object]:
            self.assertEqual(CLIENT_ID, source_name)
            self.assertEqual("extension_open", request_prefix)
            self.assertEqual("ext-open-1", payload["request_id"])
            self.assertTrue(
                extension_navigation_backend.resolve_extension_open_complete(
                    {
                        "request_id": "ext-open-1",
                        "path": "/workspace/main.ts",
                    },
                    CLIENT_ID,
                )
            )
            return {
                "ok": True,
                "request_id": "ext-open-1",
                "path": "/workspace/main.ts",
                "rel": "main.ts",
            }

        async def adapter_rpc(
            method: str,
            params: dict[str, object] | None = None,
            timeout: float = 30.0,
        ) -> dict[str, object]:
            self.assertIsNotNone(params)
            assert params is not None
            adapter_calls.append((method, params, timeout))
            return {"result": {"ok": True}}

        with (
            patch(
                "app.apps.code_te2.host.file_ops_backend.handle_host_open_request",
                open_file,
            ),
            patch(
                "app.apps.code_te2.workbench_adapter_shell_manager.adapter_rpc",
                adapter_rpc,
            ),
        ):
            await extension_navigation_backend._run_extension_open(  # pyright: ignore[reportPrivateUsage]
                {
                    "requestId": "ext-open-1",
                    "path": "/workspace/main.ts",
                    "line": 4,
                    "column": 2,
                    "focus": True,
                    "clientInstanceId": CLIENT_ID,
                }
            )

        self.assertEqual(
            [
                (
                    "vscode.extensionNavigation.complete",
                    {
                        "ok": True,
                        "requestId": "ext-open-1",
                        "path": "/workspace/main.ts",
                        "clientInstanceId": CLIENT_ID,
                    },
                    10.0,
                )
            ],
            adapter_calls,
        )


if __name__ == "__main__":
    _ = unittest.main()
