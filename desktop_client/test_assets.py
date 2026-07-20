from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.request import urlopen

from desktop_client.assets import (
    REQUIRED_DESKTOP_ASSET_FILES,
    DesktopAssetManager,
    DesktopAssetServer,
    compare_asset_versions,
    map_local_asset_path,
)


def asset_bundle(version: str, *, complete: bool = True) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("version.txt", version)
        archive.writestr("android-shell/settings.html", "android-only")
        if complete:
            for relative in REQUIRED_DESKTOP_ASSET_FILES:
                if relative == "version.txt":
                    continue
                archive.writestr(relative, f"fixture:{relative}")
    return output.getvalue()


class FixtureAssetManager(DesktopAssetManager):
    def __init__(self, asset_root: Path, version: str, bundle: bytes) -> None:
        super().__init__(asset_root)
        self.server_version = version
        self.bundle = bundle

    def fetch_server_version(self, base_url: str) -> str:
        del base_url
        return self.server_version

    def _download_bundle(self, base_url: str, output) -> None:
        del base_url
        output.write(self.bundle)


class DesktopAssetTests(unittest.TestCase):
    def test_version_comparison_matches_monotonic_ota_order(self) -> None:
        self.assertGreater(compare_asset_versions("0.2.10", "0.2.9"), 0)
        self.assertEqual(compare_asset_versions("0.2.9", "0.2.9.0"), 0)
        self.assertLess(compare_asset_versions("0.1.99", "0.2.0"), 0)

    def test_static_mapping_never_claims_dynamic_routes(self) -> None:
        self.assertEqual(
            map_local_asset_path(
                "/apps/by-id/file_editor_cm6/static/dist/host.js"
            ),
            "/apps/file_editor_cm6/static/dist/host.js",
        )
        self.assertEqual(
            map_local_asset_path(
                "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/json.worker.js"
            ),
            "/static/vendor/monaco-editor-core/te2-lang/workers/json.worker.js",
        )
        self.assertIsNone(map_local_asset_path("/api/apps/catalog"))
        self.assertIsNone(map_local_asset_path("/ui_ipc_ws/socket.io"))

    def test_install_is_complete_atomic_and_omits_android_shell(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "desktop_assets"
            manager = FixtureAssetManager(root, "0.2.10", asset_bundle("0.2.10"))
            result = manager.update_from_server("http://framework")
            self.assertTrue(result.ok)
            self.assertTrue(result.updated)
            self.assertEqual(manager.local_version(), "0.2.10")
            self.assertTrue(manager.has_valid_assets())
            self.assertFalse((root / "android-shell").exists())

            manager.server_version = "0.2.9"
            manager.bundle = asset_bundle("0.2.9")
            downgrade = manager.update_from_server(
                "http://framework",
                force=True,
            )
            self.assertFalse(downgrade.ok)
            self.assertEqual(manager.local_version(), "0.2.10")

    def test_incomplete_bundle_preserves_last_valid_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "desktop_assets"
            manager = FixtureAssetManager(root, "1.0.0", asset_bundle("1.0.0"))
            self.assertTrue(manager.update_from_server("http://framework").ok)

            manager.server_version = "1.0.1"
            manager.bundle = asset_bundle("1.0.1", complete=False)
            result = manager.update_from_server("http://framework")
            self.assertFalse(result.ok)
            self.assertEqual(manager.local_version(), "1.0.0")
            self.assertTrue(manager.has_valid_assets())

    def test_loopback_server_serves_only_installed_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "desktop_assets"
            target = root / "static" / "fixture.js"
            target.parent.mkdir(parents=True)
            target.write_text("window.fixture = true;", encoding="utf-8")
            server = DesktopAssetServer(root)
            base_url = server.start()
            try:
                with urlopen(f"{base_url}/static/fixture.js") as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(
                        response.read(),
                        b"window.fixture = true;",
                    )
            finally:
                server.stop()


if __name__ == "__main__":
    unittest.main()
