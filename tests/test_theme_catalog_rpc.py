"""Theme discovery stays transport-free and shared across surface RPC lanes."""
# pyright: strict
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from app.apps.code_te2 import extension_registry, theme_catalog
from app.apps.code_te2.monaco_editor import editor_rpc_dispatch, editor_runtime_dispatch
from app.apps.code_te2.monaco_editor.editor_rpc_contract import coerce_jsonrpc_request_envelope
from app.apps.code_te2.ui_ipc import rpc_dispatch
from app.apps.code_te2.ui_ipc.rpc_contract import parse_ui_ipc_rpc_request


class ThemeCatalogTests(unittest.IsolatedAsyncioTestCase):
    def test_bundled_indexes_are_ordered_and_malformed_entries_are_skipped(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-theme-catalog-") as directory:
            root = Path(directory)
            for name in ("z", "a", "bad", "missing"):
                (root / name).mkdir()
            for name in ("z", "a"):
                _ = (root / name / "theme_index.json").write_text(json.dumps({
                    "source": name.upper(), "vendored": [None, {"id": 1}, {
                        "id": name, "label": name, "file": "theme.json",
                    }],
                }))
            _ = (root / "bad" / "theme_index.json").write_text("not json")
            with (
                patch.object(theme_catalog, "VENDORED_THEMES_DIR", root),
                patch.object(extension_registry, "get_extension_list", return_value=[]),
                self.assertLogs(theme_catalog.logger, level="WARNING"),
            ):
                result = theme_catalog.build_theme_catalog()
            self.assertEqual([entry["id"] for entry in result["themes"]], ["a", "z"])
            self.assertEqual(result["themes"][0], {
                "id": "a", "label": "a", "uiTheme": "vs-dark", "source": "vendored",
                "sourceLabel": "A", "serveUrl": "monaco_editor/themes/vendored/a/theme.json",
            })

    def test_extension_catalog_preserves_existing_ids_and_resource_urls(self) -> None:
        extensions: list[dict[str, object]] = [{
            "id": "publisher.theme", "path": "/extensions/publisher.theme-1.0",
            "display_name": "Theme Pack", "themes": [{
                "label": "Blue (Dark)", "path": "./themes/blue.json", "uiTheme": "vs-dark",
            }, {"path": 4}],
        }, {"id": "metadata-without-theme-path", "themes": [{"label": "skip"}]}]
        with (
            tempfile.TemporaryDirectory(prefix="te2-themes-empty-") as directory,
            patch.object(theme_catalog, "VENDORED_THEMES_DIR", Path(directory)),
            patch.object(extension_registry, "get_extension_list", return_value=extensions),
        ):
            result = theme_catalog.build_theme_catalog()
        self.assertEqual(result["themes"], [{
            "id": "ext:publisher.theme:blue-dark", "label": "Blue (Dark)",
            "uiTheme": "vs-dark", "source": "extension", "sourceLabel": "Theme Pack",
            "serveUrl": "monaco_editor/cs_themes/publisher.theme-1.0/blue.json",
        }])

    async def test_catalog_disk_reads_run_off_the_rpc_event_loop(self) -> None:
        owner = threading.get_ident()
        threads: list[int] = []

        def scan() -> theme_catalog.ThemeCatalog:
            threads.append(threading.get_ident())
            return {"themes": []}

        with patch.object(theme_catalog, "build_theme_catalog", scan):
            self.assertEqual(await theme_catalog.get_theme_catalog(), {"themes": []})
        self.assertEqual(len(threads), 1)
        self.assertNotEqual(threads[0], owner)

    async def test_host_and_editor_dispatch_share_catalog_service(self) -> None:
        expected: theme_catalog.ThemeCatalog = {"themes": []}
        envelope: dict[str, object] = {
            "jsonrpc": "2.0", "id": "themes", "method": "ui.host.themes.list", "params": {},
        }
        self.assertIsNotNone(parse_ui_ipc_rpc_request(envelope))
        with patch.object(rpc_dispatch, "get_theme_catalog", return_value=expected) as request:
            reply = await rpc_dispatch.dispatch_ui_ipc_rpc_request(
                "ui.host.themes.list", {}, source_name="primary",
            )
            self.assertEqual(reply, expected)
            _ = request.assert_awaited_once_with()
        envelope["method"] = "editor.themes.list"
        self.assertIsNotNone(coerce_jsonrpc_request_envelope(envelope))
        with patch.object(editor_rpc_dispatch, "get_theme_catalog", return_value=expected) as request:
            reply = await editor_runtime_dispatch.dispatch_editor_runtime_request(
                "editor.themes.list", {}, source_client="secondary",
            )
            self.assertEqual(reply, expected)
            _ = request.assert_awaited_once_with()

    async def test_scan_failures_are_not_successful_empty_catalogs(self) -> None:
        with patch.object(theme_catalog, "build_theme_catalog", side_effect=OSError("unavailable")):
            with self.assertRaisesRegex(OSError, "unavailable"):
                _ = await theme_catalog.get_theme_catalog()

    def test_catalog_http_removed_while_resource_routes_remain(self) -> None:
        source = (Path(__file__).parents[1] / "app/apps/code_te2/monaco_editor/editor_asset_routes.py").read_text()
        self.assertNotIn("available_themes", source)
        for route in ("/monaco_editor/themes/", "/monaco_editor/cs_themes/", "/monaco_editor/textmate/"):
            self.assertIn(route, source)

    def test_service_import_and_execution_do_not_require_web_frameworks(self) -> None:
        script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'pydantic', 'pydantic_core', 'starlette'}:
            raise ImportError('forbidden: ' + fullname)
sys.meta_path.insert(0, Block())
import asyncio
from unittest.mock import patch
from app.apps.code_te2 import theme_catalog, extension_registry
with patch.object(extension_registry, 'get_extension_list', return_value=[]):
    result = asyncio.run(theme_catalog.get_theme_catalog())
assert result['themes'], 'bundled catalog should remain available'
"""
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=30,
                                cwd=Path(__file__).parents[1])
        self.assertEqual(result.returncode, 0, result.stderr.decode())
