from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.code_te2.explorer.context import ExplorerExtensionHandlerContext
from app.apps.code_te2.explorer.contracts.extension_menus import (
    ExplorerExtensionMenuContractError,
    parse_extension_command_params,
    parse_extension_menu_resolve_params,
)
from app.apps.code_te2.explorer.handlers.extension_menus import (
    handle_extension_menu_resolve,
)


class ExtensionMenuContractTests(unittest.TestCase):
    def test_menu_and_command_params_are_bounded(self) -> None:
        self.assertEqual(
            {"rel": "src"},
            parse_extension_menu_resolve_params({"rel": " src "}),
        )
        self.assertEqual(
            {
                "rel": "src",
                "selected_rels": ["src", "tests"],
                "command": "sample.inspect",
            },
            parse_extension_command_params(
                {
                    "rel": "src",
                    "selected_rels": ["src", "tests"],
                    "command": "sample.inspect",
                }
            ),
        )
        with self.assertRaisesRegex(
            ExplorerExtensionMenuContractError,
            "selected_rels",
        ):
            _ = parse_extension_command_params(
                {
                    "rel": "src",
                    "selected_rels": [1],
                    "command": "sample.inspect",
                }
            )


class ExtensionMenuHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_projects_verified_explorer_context(self) -> None:
        scratch_root = Path.cwd() / ".codex-scratch-tests"
        scratch_root.mkdir(exist_ok=True)
        emitted: list[tuple[str, dict[str, object], str | None]] = []

        async def emit(
            method: str,
            payload: dict[str, object],
            reply_to: str | None = None,
        ) -> None:
            emitted.append((method, payload, reply_to))

        try:
            with tempfile.TemporaryDirectory(dir=scratch_root) as temporary:
                root = Path(temporary)
                (root / "src").mkdir()
                context = ExplorerExtensionHandlerContext(
                    project_root=root,
                    emit_personal=emit,
                )
                adapter_calls: list[tuple[str, dict[str, object], float]] = []

                async def adapter(
                    method: str,
                    params: dict[str, object] | None = None,
                    timeout: float = 30.0,
                ) -> dict[str, object]:
                    self.assertIsNotNone(params)
                    assert params is not None
                    adapter_calls.append((method, params, timeout))
                    return {"result": {"ok": True, "actions": []}}

                with patch(
                    "app.apps.code_te2.workbench_adapter_shell_manager.adapter_rpc",
                    adapter,
                ):
                    await handle_extension_menu_resolve(
                        context,
                        {"rel": "src"},
                        "rpc-1",
                    )
                request = adapter_calls[0][1]
                self.assertEqual("explorer/context", request["menu"])
                self.assertEqual(str((root / "src").resolve()), request["path"])
                context_raw = request["context"]
                self.assertIsInstance(context_raw, dict)
                assert isinstance(context_raw, dict)
                self.assertTrue(context_raw["explorerResourceIsFolder"])
                self.assertFalse(context_raw["explorerResourceIsRoot"])
                self.assertEqual(
                    ("explorer.extensions.menu.resolved", {"ok": True, "actions": []}, "rpc-1"),
                    emitted[0],
                )
        finally:
            shutil.rmtree(scratch_root, ignore_errors=True)
