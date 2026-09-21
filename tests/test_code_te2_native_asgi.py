# pyright: strict
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send

from app.apps.code_te2.http_app import build_code_te2_asgi_app, SOCKET_PATHS
from app.apps.code_te2.monaco_editor import editor_asset_routes as assets

ROOT = Path(__file__).resolve().parents[1]


class CodeTe2NativeASGITests(unittest.IsolatedAsyncioTestCase):
    async def test_health_static_errors_and_socket_mount_scopes(self) -> None:
        scopes: list[tuple[str, str]] = []

        async def socket_app(scope: Scope, _receive: Receive, send: Send) -> None:
            scopes.append((scope["path"], scope.get("root_path", "")))
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"socket"})

        with tempfile.TemporaryDirectory(prefix="te2-native-http-") as directory:
            root = Path(directory)
            static = root / "static"
            icons = root / "icons"
            static.mkdir()
            icons.mkdir()
            _ = (static / "host.js").write_text("export const ready = true;")
            _ = (icons / "test.svg").write_text("<svg/>")
            _ = (root / "private.txt").write_text("private")
            (static / "escape.txt").symlink_to(root / "private.txt")
            with patch.object(assets, "__file__", str(root / "app/apps/code_te2/monaco_editor/editor_asset_routes.py")):
                app = build_code_te2_asgi_app(static_dir=static, agent_icon_dir=icons, socket_app=socket_app)
            self.assertEqual(
                {route.path for route in app.routes if isinstance(route, Mount)}, set(SOCKET_PATHS),
            )
            self.assertEqual({route.path for route in app.routes if isinstance(route, Route)}, {
                "/", "/status", "/static/{file_path:path}", "/agent_icons/{name}",
                "/ui/monaco_vscode/esm/{file_path:path}", "/ui/monaco_vscode/lang/{file_path:path}",
                "/ui/monaco_editor/themes/{file_path:path}",
                "/ui/monaco_editor/cs_themes/{ext_id}/{theme_file:path}",
                "/ui/monaco_editor/textmate/{file_path:path}",
            })
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                for url in ("/", "/status"):
                    response = await client.get(url)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.text, '{"ok":true,"data":{"message":"File Editor CM6 app API ready"}}')
                response = await client.get("/static/host.js")
                self.assertEqual(response.text, "export const ready = true;")
                self.assertIn("javascript", response.headers["content-type"])
                response = await client.get("/agent_icons/test.svg")
                self.assertEqual(response.text, "<svg/>")
                self.assertEqual(response.headers["content-type"], "image/svg+xml")
                for url in ("/static/escape.txt", "/static/%2e%2e/private.txt", "/static/missing", "/agent_icons/missing"):
                    response = await client.get(url)
                    self.assertEqual(response.status_code, 404, url)
                    self.assertEqual(response.text, '{"detail":"File not found"}')
                for url in ("/read", "/state", "/diff", "/review/list", "/edit_tracker/status",
                            "/editor/update_diffs", "/docs", "/openapi.json"):
                    response = await client.get(url)
                    self.assertEqual(response.status_code, 404, url)
                    self.assertEqual(response.text, '{"detail":"Not Found"}')
                for url in ("/", "/status", "/static/host.js", "/agent_icons/test.svg"):
                    response = await client.post(url)
                    self.assertEqual(response.status_code, 405)
                    self.assertEqual(response.headers["allow"], "GET")
                    self.assertEqual(response.text, '{"detail":"Method Not Allowed"}')
                    self.assertEqual((await client.head(url)).status_code, 405)
                for path in SOCKET_PATHS:
                    self.assertEqual((await client.get(path + "/?EIO=4&transport=websocket")).text, "socket")
                self.assertEqual(scopes, [(path + "/", path) for path in SOCKET_PATHS])

    def test_real_backend_import_resources_lifespan_and_engineio_without_fastapi(self) -> None:
        self._exercise_import([])

    def test_real_backend_assembles_off_loop_with_early_bootstrap(self) -> None:
        self._exercise_import(["--early-bootstrap"])

    def _exercise_import(self, args: list[str]) -> None:
        # The real backend installs process hooks/stores at import: isolate it in
        # a subprocess with empty state. Do not launch shells or the shared host.
        with tempfile.TemporaryDirectory(prefix="te2-native-import-") as directory:
            env = dict(os.environ)
            for kind in ("CACHE", "DATA", "CONFIG", "RUNTIME"):
                env[f"TE2_{kind}_HOME"] = str(Path(directory) / kind.lower())
            env["PYTHONPATH"] = str(ROOT)
            result = subprocess.run(
                [sys.executable, str(ROOT / "tests/fixtures/code_te2_native_asgi_probe.py"), *args],
                env=env, cwd=ROOT, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertIn(b"native code_te2 probe passed", result.stdout)
