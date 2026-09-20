"""Keep editor state independent while preserving resource HTTP and WBA grammar RPC."""
# pyright: strict
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
import httpx

from app.apps.code_te2.code_te2_paths import resolve_code_te2_paths
from app.apps.code_te2.monaco_editor import editor_asset_routes as assets

ROOT = Path(__file__).resolve().parents[1]


class EditorAssetRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def test_resources_preserve_urls_bytes_css_shim_head_and_containment(self) -> None:
        # Real ASGI requests, isolated resource trees: no server or live store.
        with tempfile.TemporaryDirectory(prefix="te2-editor-assets-") as directory:
            root = Path(directory)
            module = root / "app/apps/code_te2/monaco_editor/editor_asset_routes.py"
            monaco = root / "app/static/vendor/monaco-editor-core"
            paths = resolve_code_te2_paths({"HOME": str(root)}, home=root)
            fixtures = {
                monaco / "esm/editor.js": b"export const editor = true;",
                monaco / "esm/editor.css": b".editor { color: red; }",
                monaco / "te2-lang/worker.js": b"postMessage('ready');",
                module.parent / "themes/vendored/test/theme.json": b'{"colors":{}}',
                module.parent / "textmate/onig.wasm": b"\x00asm\x01\x00\x00\x00",
                paths.code_server_extensions_dir / "test.ext/themes/theme.json": b'{"name":"extension"}',
                root / "secret.json": b"private",
            }
            for file, content in fixtures.items():
                file.parent.mkdir(parents=True, exist_ok=True)
                _ = file.write_bytes(content)
            (module.parent / "themes/escape.json").symlink_to(root / "secret.json")
            with patch.object(assets, "__file__", str(module)), patch.object(assets, "code_te2_paths", return_value=paths):
                app = FastAPI()
                assets.register_monaco_editor_routes(app)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                    resources = {
                        "/ui/monaco_vscode/esm/editor.js": monaco / "esm/editor.js",
                        "/ui/monaco_vscode/lang/worker.js": monaco / "te2-lang/worker.js",
                        "/ui/monaco_editor/themes/vendored/test/theme.json": module.parent / "themes/vendored/test/theme.json",
                        "/ui/monaco_editor/textmate/onig.wasm": module.parent / "textmate/onig.wasm",
                        "/ui/monaco_editor/cs_themes/test.ext/theme.json": paths.code_server_extensions_dir / "test.ext/themes/theme.json",
                    }
                    for url, file in resources.items():
                        response = await client.get(url)
                        self.assertEqual(response.status_code, 200, url)
                        self.assertEqual(response.content, fixtures[file], url)
                    wasm = await client.get("/ui/monaco_editor/textmate/onig.wasm")
                    self.assertEqual(wasm.headers["content-type"], "application/wasm")
                    theme = await client.get("/ui/monaco_editor/themes/vendored/test/theme.json")
                    self.assertEqual(theme.headers["content-type"], "application/json")
                    shim = await client.get("/ui/monaco_vscode/esm/editor.css")
                    self.assertIn("application/javascript", shim.headers["content-type"])
                    self.assertIn("url.searchParams.set('raw', '1')", shim.text)
                    raw = await client.get("/ui/monaco_vscode/esm/editor.css?raw=1")
                    self.assertEqual(raw.content, fixtures[monaco / "esm/editor.css"])
                    self.assertIn("text/css", raw.headers["content-type"])
                    for url in ("/ui/monaco_vscode/esm/editor.css?raw=1", "/ui/monaco_vscode/lang/worker.js"):
                        head = await client.head(url)
                        get = await client.get(url)
                        self.assertEqual(head.status_code, 200)
                        self.assertEqual(head.content, b"")
                        self.assertEqual(head.headers["content-length"], get.headers["content-length"])
                    for url in (
                        "/ui/monaco_editor/themes/escape.json",
                        "/ui/monaco_editor/themes/%2e%2e/editor_asset_routes.py",
                        "/ui/monaco_vscode/esm/%2e%2e/%2e%2e/secret.json",
                        "/ui/monaco_editor/textmate/missing.wasm",
                        "/ui/monaco_editor/available_themes",
                        "/editor/debug/state",
                    ):
                        self.assertEqual((await client.get(url)).status_code, 404, url)
                    for url in ("/editor/refresh_diffs", "/editor/jump_to_line", "/editor/search/open"):
                        self.assertEqual((await client.post(url, json={})).status_code, 404, url)
                    self.assertEqual((await client.post("/ui/monaco_editor/textmate/onig.wasm")).status_code, 405)

    async def test_missing_builds_keep_explicit_not_found_responses(self) -> None:
        with tempfile.TemporaryDirectory(prefix="te2-editor-assets-missing-") as directory:
            root = Path(directory)
            with patch.object(assets, "__file__", str(root / "app/apps/code_te2/monaco_editor/editor_asset_routes.py")):
                app = FastAPI()
                assets.register_monaco_editor_routes(app, "/resources")
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                    for target in ("esm", "lang"):
                        response = await client.get(f"/resources/monaco_vscode/{target}/missing.js")
                        self.assertEqual(response.status_code, 404)
                        self.assertIn("not built", response.text)

    def test_editor_backend_imports_without_web_frameworks_or_asset_routes(self) -> None:
        script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'pydantic', 'pydantic_core', 'starlette'}:
            raise ImportError('forbidden: ' + fullname)
sys.meta_path.insert(0, Block())
from app.apps.code_te2.monaco_editor import editor_backend, editor_preferences_backend
from app.apps.code_te2.host import transport_state_backend
assert callable(editor_backend._get_view_state_dict)
assert not hasattr(editor_backend, 'editor_router')
assert 'app.apps.code_te2.monaco_editor.editor_asset_routes' not in sys.modules
"""
        with tempfile.TemporaryDirectory(prefix="te2-editor-import-") as directory:
            env = dict(os.environ)
            for kind in ("CACHE", "DATA", "CONFIG", "RUNTIME"):
                env[f"TE2_{kind}_HOME"] = str(Path(directory) / kind.lower())
            result = subprocess.run([sys.executable, "-c", script], env=env,
                                    capture_output=True, timeout=30, cwd=ROOT)
            self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_main_mounts_only_resources_from_editor_http_boundary(self) -> None:
        source = (ROOT / "app/apps/code_te2/main.py").read_text()
        self.assertIn("from .monaco_editor.editor_asset_routes import register_monaco_editor_routes", source)
        self.assertNotIn("include_router(editor_router)", source)
        self.assertNotIn("from .monaco_editor.editor_backend import", source)

