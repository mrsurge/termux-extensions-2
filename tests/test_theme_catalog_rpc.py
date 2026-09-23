"""Theme discovery stays transport-free and shared across surface RPC lanes."""
# pyright: strict
from __future__ import annotations

import json
import io
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
    def test_runtime_debug_theme_trace_uses_stderr_and_no_theme_body(self) -> None:
        output = io.StringIO()
        with (patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "1"}),
              patch("sys.stderr", output)):
            selected = theme_catalog.resolve_selected_theme({"editor": {"theme": "github-dark"}})
        self.assertEqual(selected["id"], "github-dark")
        self.assertIn("source=vendored:dark.json", output.getvalue())
        self.assertIn("sha256=", output.getvalue())
        self.assertNotIn("source.rust", output.getvalue())

    def test_selected_theme_resolves_only_selected_resource(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-selected-theme-") as directory:
            root = Path(directory)
            vendor = root / "vendored/github"
            vendor.mkdir(parents=True)
            _ = (vendor / "theme_index.json").write_text(json.dumps({"vendored": [
                {"id": "github-dark", "file": "dark.json", "uiTheme": "vs-dark"},
            ]}))
            _ = (vendor / "dark.json").write_text('{"tokenColors":[]}')
            extension = root / "extensions/publisher.colors-1.0"
            extension.mkdir(parents=True)
            _ = (extension / "selected.json").write_text('{"semanticTokenColors":{"class":"#abc"}}')
            _ = (extension / "unselected.json").write_text("invalid json")
            registry = {"extensions": {"publisher.colors": {
                "id": "publisher.colors", "path": str(extension), "active": True,
                "themes": [
                    {"label": "Selected", "path": "selected.json", "uiTheme": "hc-black"},
                    {"label": "Unselected", "path": "unselected.json", "uiTheme": "vs"},
                ],
            }}}
            with (patch.object(theme_catalog, "VENDORED_THEMES_DIR", root / "vendored"),
                  patch.object(theme_catalog, "_extension_roots", return_value=(root / "extensions",)),
                  patch.object(extension_registry, "load_registry", return_value=registry)):
                builtin = theme_catalog.resolve_selected_theme({"editor": {"theme": "github-dark"}})
                self.assertEqual(builtin["theme"]["tokenColors"], [])
                selected = theme_catalog.resolve_selected_theme({"editor": {
                    "theme": "ext:publisher.colors:selected",
                }})
                self.assertEqual(selected["uiTheme"], "hc-black")
                self.assertEqual(selected["theme"]["semanticTokenColors"], {"class": "#abc"})
                with self.assertRaisesRegex(ValueError, "unavailable"):
                    _ = theme_catalog.resolve_selected_theme({"editor": {
                        "theme": "ext:publisher.colors:unselected",
                    }})

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
                patch.object(extension_registry, "load_registry", return_value={"extensions": {}}),
                self.assertLogs(theme_catalog.logger, level="WARNING"),
            ):
                result = theme_catalog.build_theme_catalog()
            self.assertEqual([entry["id"] for entry in result["themes"]], ["a", "z"])
            self.assertEqual(result["themes"][0], {
                "id": "a", "label": "a", "uiTheme": "vs-dark", "source": "vendored",
                "sourceLabel": "A", "serveUrl": "monaco_editor/themes/vendored/a/theme.json",
            })

    def test_extension_catalog_preserves_existing_ids_and_resource_urls(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-themes-empty-") as directory:
            root = Path(directory)
            extension_dir = root / "extensions/publisher.theme-1.0"
            theme_file = extension_dir / "themes/blue.json"
            theme_file.parent.mkdir(parents=True)
            _ = theme_file.write_text('{"colors":{"editor.background":"#123456"}}')
            extensions: list[dict[str, object]] = [{
            "id": "publisher.theme", "path": str(extension_dir), "active": True,
            "display_name": "Theme Pack", "themes": [{
                "label": "Blue (Dark)", "path": "./themes/blue.json", "uiTheme": "vs-dark",
            }, {"path": 4}],
            }, {"id": "metadata-without-theme-path", "themes": [{"label": "skip"}]}]
            with (
                patch.object(theme_catalog, "VENDORED_THEMES_DIR", root),
                patch.object(theme_catalog, "_extension_roots", return_value=(root / "extensions",)),
                patch.object(extension_registry, "load_registry", return_value={"extensions": {
                    entry["id"]: entry for entry in extensions
                }}),
            ):
                result = theme_catalog.build_theme_catalog()
            self.assertEqual(result["themes"], [{
                "id": "ext:publisher.theme:blue-dark", "label": "Blue (Dark)",
                "uiTheme": "vs-dark", "source": "extension", "sourceLabel": "Theme Pack",
                "serveUrl": "monaco_editor/cs_themes/publisher.theme-1.0/themes/blue.json",
            }])

    def test_catalog_filters_unsupported_themes_and_resolves_bundled_root(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-theme-roots-") as directory:
            root = Path(directory)
            bundled = root / "bundled/theme-defaults"
            (bundled / "custom").mkdir(parents=True)
            _ = (bundled / "custom/plain.json").write_text(
                '{"colors":{"editor.background":"#111","editor.foreground":"#eee"},' +
                '"tokenColors":[{"scope":"source.base"}]}')
            _ = (bundled / "custom/inherited.json").write_text(
                '{"include":"./plain.json","colors":{"editor.background":"#222"},' +
                '"tokenColors":[{"scope":"source.child"}]}')
            _ = (bundled / "custom/comments.json").write_text(
                '{// comment\n"colors":{"editor.background":"#333",},' +
                '"name":"// not a comment",}')
            _ = (bundled / "custom/cycle.json").write_text('{"include":"./cycle.json"}')
            _ = (bundled / "custom/missing.json").write_text('{"include":"./gone.json"}')
            _ = (bundled / "custom/absolute.json").write_text('{"include":"/outside.json"}')
            _ = (bundled / "custom/semantic.json").write_text(
                '{"include":"./inherited.json","semanticTokenColors":{' +
                '"class":"#fff","variable.readonly":{"foreground":"#abc"}}}')
            (bundled / "custom/escape.json").symlink_to(root / "outside.json")
            _ = (root / "outside.json").write_text('{"colors":{}}')
            entry: dict[str, object] = {
                "id": "vscode.theme-defaults", "path": str(bundled), "active": True,
                "themes": [{"label": "%themeLabel%", "path": "./custom/plain.json"},
                           {"label": "Inherited", "path": "./custom/inherited.json"},
                           {"label": "Comments", "path": "./custom/comments.json"},
                           {"label": "Cycle", "path": "./custom/cycle.json"},
                           {"label": "Missing", "path": "./custom/missing.json"},
                           {"label": "Absolute", "path": "./custom/absolute.json"},
                           {"label": "Semantic", "path": "./custom/semantic.json"},
                           {"label": "Escape", "path": "./custom/escape.json"}],
            }
            with (patch.object(theme_catalog, "VENDORED_THEMES_DIR", root / "missing"),
                  patch.object(theme_catalog, "_extension_roots", return_value=(root / "bundled",)),
                  patch.object(extension_registry, "load_registry", return_value={"extensions": {"vscode.theme-defaults": entry}})):
                catalog = theme_catalog.build_theme_catalog()
                self.assertIsNotNone(theme_catalog.load_extension_theme("theme-defaults", "custom/plain.json"))
                inherited = theme_catalog.load_extension_theme("theme-defaults", "custom/inherited.json")
                self.assertIsNotNone(inherited)
                self.assertEqual(inherited["colors"] if inherited else None, {
                    "editor.background": "#222", "editor.foreground": "#eee",
                })
                self.assertEqual(inherited["tokenColors"] if inherited else None, [
                    {"scope": "source.base"}, {"scope": "source.child"},
                ])
                comments = theme_catalog.load_extension_theme("theme-defaults", "custom/comments.json")
                self.assertEqual(comments["name"] if comments else None, "// not a comment")
                self.assertIsNone(theme_catalog.load_extension_theme("theme-defaults", "custom/cycle.json"))
                self.assertIsNone(theme_catalog.load_extension_theme("theme-defaults", "custom/missing.json"))
                self.assertIsNone(theme_catalog.load_extension_theme("theme-defaults", "custom/absolute.json"))
                semantic = theme_catalog.load_extension_theme("theme-defaults", "custom/semantic.json")
                self.assertEqual(semantic["semanticTokenColors"] if semantic else None, {
                    "class": "#fff", "variable.readonly": {"foreground": "#abc"},
                })
                self.assertEqual(semantic["tokenColors"] if semantic else None, [
                    {"scope": "source.base"}, {"scope": "source.child"},
                ])
                self.assertIsNone(theme_catalog.load_extension_theme("theme-defaults", "custom/escape.json"))
                self.assertIsNone(theme_catalog.load_extension_theme("theme-defaults", "custom/../custom/plain.json"))
            self.assertEqual([(item["id"], item["label"]) for item in catalog["themes"]], [
                ("ext:vscode.theme-defaults:plain", "Plain"),
                ("ext:vscode.theme-defaults:inherited", "Inherited"),
                ("ext:vscode.theme-defaults:comments", "Comments"),
                ("ext:vscode.theme-defaults:semantic", "Semantic"),
            ])

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

    async def test_editor_projects_only_backend_selected_theme(self) -> None:
        from app.apps.code_te2 import stores

        preferences: dict[str, object] = {"editor": {"theme": "github-dark"}}
        selection: theme_catalog.SelectedTheme = {
            "id": "github-dark", "uiTheme": "vs-dark", "theme": {"tokenColors": []},
        }

        class Store:
            def get_preferences(self, project: str | None) -> dict[str, object]:
                del project
                return preferences

        envelope: dict[str, object] = {
            "jsonrpc": "2.0", "id": "selected", "method": "editor.theme.selected", "params": {},
        }
        self.assertIsNotNone(coerce_jsonrpc_request_envelope(envelope))
        with (patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "0"}),
              patch.object(stores, "get_preferences_store", return_value=Store()),
              patch.object(editor_rpc_dispatch, "resolve_selected_theme", return_value=selection) as resolve):
            reply = await editor_runtime_dispatch.dispatch_editor_runtime_request(
                "editor.theme.selected", {}, source_client="primary",
            )
            preferences = {"editor": {"theme": "github-light"}}
            next_selection: theme_catalog.SelectedTheme = {
                "id": "github-light", "uiTheme": "vs", "theme": {"tokenColors": []},
            }
            resolve.return_value = next_selection
            next_reply = await editor_runtime_dispatch.dispatch_editor_runtime_request(
                "editor.theme.selected", {}, source_client="secondary",
            )
        self.assertEqual(reply, selection)
        self.assertEqual(next_reply, next_selection)
        self.assertEqual(resolve.call_count, 2)
        self.assertEqual(resolve.call_args_list[0].args[0]["editor"], {"theme": "github-dark"})
        self.assertEqual(resolve.call_args_list[1].args[0], preferences)

    async def test_selected_theme_rpc_enables_cold_boot_trace_only_in_runtime_debug(self) -> None:
        from app.apps.code_te2 import stores

        selection: theme_catalog.SelectedTheme = {
            "id": "github-dark", "uiTheme": "vs-dark", "theme": {"tokenColors": []},
        }

        class Store:
            def get_preferences(self, project: str | None) -> dict[str, object]:
                del project
                return {"editor": {"theme": "github-dark"}}

        with (patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "1"}),
              patch.object(stores, "get_preferences_store", return_value=Store()),
              patch.object(editor_rpc_dispatch, "resolve_selected_theme", return_value=selection)):
            reply = await editor_runtime_dispatch.dispatch_editor_runtime_request(
                "editor.theme.selected", {}, source_client="primary",
            )
        self.assertEqual(reply, {**selection, "_runtimeDebug": True})
        self.assertNotIn("_runtimeDebug", selection)

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
