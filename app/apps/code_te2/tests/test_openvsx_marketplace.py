from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx

from app.apps.code_te2.explorer.context import ExplorerExtensionHandlerContext
from app.apps.code_te2.explorer.handlers.extensions import (
    handle_ext_marketplace_install,
)
from app.apps.code_te2.explorer.services import openvsx_marketplace


_EXT_ID = "detachhead.basedpyright"
_VERSION = "1.39.10"
_API_PATH = "/api/detachhead/basedpyright/1.39.10"
_VSIX_PATH = (
    f"{_API_PATH}/file/detachhead.basedpyright-{_VERSION}.vsix"
)
_SHA256_PATH = (
    f"{_API_PATH}/file/detachhead.basedpyright-{_VERSION}.sha256"
)
_CDN_PREFIX = f"/detachhead/basedpyright/{_VERSION}"


def _metadata(
    *,
    download_url: str | None = None,
    sha256_url: str | None = None,
) -> dict[str, object]:
    return {
        "namespace": "detachhead",
        "name": "basedpyright",
        "version": _VERSION,
        "files": {
            "download": download_url or f"https://open-vsx.org{_VSIX_PATH}",
            "sha256": sha256_url or f"https://open-vsx.org{_SHA256_PATH}",
        },
    }


def _client_for(
    artifact: bytes,
    *,
    metadata: dict[str, object] | None = None,
    declared_sha256: str | None = None,
) -> httpx.AsyncClient:
    expected_sha256 = declared_sha256 or hashlib.sha256(artifact).hexdigest()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == _API_PATH:
            return httpx.Response(200, json=metadata or _metadata())
        if request.url.path == _SHA256_PATH:
            return httpx.Response(
                302,
                headers={
                    "location": (
                        "https://openvsx.eclipsecontent.org"
                        f"{_CDN_PREFIX}/detachhead.basedpyright-{_VERSION}.sha256"
                    )
                },
            )
        if request.url.path == _VSIX_PATH:
            return httpx.Response(
                302,
                headers={
                    "location": (
                        "https://openvsx.eclipsecontent.org"
                        f"{_CDN_PREFIX}/detachhead.basedpyright-{_VERSION}.vsix"
                    )
                },
            )
        if request.url.path == (
            f"{_CDN_PREFIX}/detachhead.basedpyright-{_VERSION}.sha256"
        ):
            return httpx.Response(200, content=expected_sha256.encode("ascii"))
        if request.url.path == (
            f"{_CDN_PREFIX}/detachhead.basedpyright-{_VERSION}.vsix"
        ):
            return httpx.Response(200, content=artifact)
        return httpx.Response(404)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class OpenVsxReadmeTests(unittest.IsolatedAsyncioTestCase):
    async def test_platform_metadata_selects_host_before_verified_download(self) -> None:
        content = b'platform-vsix'
        digest = hashlib.sha256(content).hexdigest()
        requested: list[str] = []
        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path; requested.append(path)
            if path.endswith('.sha256'):
                return httpx.Response(200, text=digest)
            if path.endswith('.vsix'):
                return httpx.Response(200, content=content)
            target = 'linux-x64' if '/linux-x64/' in path else 'alpine-arm64'
            base = f'https://open-vsx.org/api/astral-sh/ty/{target}/1.0.0/file/'
            return httpx.Response(200, json={'namespace':'astral-sh', 'name':'ty', 'version':'1.0.0',
                'targetPlatform':target, 'downloads':{'linux-x64':'available', 'alpine-arm64':'available'},
                'files':{'download':base+'ty.vsix', 'sha256':base+'ty.sha256', 'icon':base+'logo.jpg'}})
        with patch.object(openvsx_marketplace, '_backend_targets', return_value=('linux-x64','universal')):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                detail = await openvsx_marketplace.get_openvsx_detail(ext_id='astral-sh.ty', installed_extensions=[], client=client)
                self.assertEqual(detail['extension']['targetPlatform'], 'linux-x64')
                self.assertIn('/linux-x64/', detail['extension']['iconUrl'])
                artifact = await openvsx_marketplace.download_openvsx_vsix(ext_id='astral-sh.ty', version='1.0.0', client=client)
                try:
                    self.assertEqual(artifact.read_bytes(), content)
                finally:
                    artifact.unlink()
        self.assertFalse(any('/alpine-arm64/' in url for url in requested))

    async def test_resource_paths_accept_real_icons_but_keep_identity_guards(self) -> None:
        for target in ['', 'linux-x64/', 'linux-arm64/']:
            for suffix in ['png','svg','jpg','jpeg','gif','webp']:
                url = f'https://open-vsx.org/api/vendor/example/{target}1.0.0/file/logo.{suffix}'
                self.assertEqual(openvsx_marketplace._openvsx_icon_url({'files':{'icon':url}},namespace='vendor',name='example',version='1.0.0'),url)
        for path in ['other/example/1.0.0/file/icon.png','vendor/example/2.0.0/file/icon.png',
                     'vendor/example/arbitrary/1.0.0/file/icon.png','vendor/example/1.0.0/file/%2e%2e%2ficon.png']:
            self.assertIsNone(openvsx_marketplace._openvsx_icon_url({'files':{'icon':'https://open-vsx.org/api/'+path}},namespace='vendor',name='example',version='1.0.0'))
        url = 'https://openvsx.eclipsecontent.org/vendor/example/linux-x64/1.0.0/a.vsix'
        self.assertTrue(openvsx_marketplace._trusted_openvsx_response_url(url,namespace='vendor',name='example',version='1.0.0',suffix='.vsix',target_platform='linux-x64'))
        self.assertFalse(openvsx_marketplace._trusted_openvsx_response_url(url,namespace='vendor',name='example',version='1.0.0',suffix='.vsix',target_platform='linux-arm64'))

    async def test_termux_targets_prefer_universal_and_never_alpine(self) -> None:
        with patch('app.apps.code_te2.code_server_bootstrap._is_termux_android',return_value=True), patch.object(openvsx_marketplace.platform,'machine',return_value='aarch64'):
            self.assertEqual(openvsx_marketplace._backend_targets(),('universal','linux-arm64'))

    async def test_installed_icons_preserve_formats_and_reject_escapes(self) -> None:
        from app.apps.code_te2 import extension_registry as registry
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'extensions' / 'vendor.example'
            root.mkdir(parents=True)
            ext = {'source': 'user', 'path': str(root), 'version': '1.0.0'}
            with patch.object(registry, '_EXTENSIONS_DIR', root.parent), patch.object(registry, 'load_registry', return_value={'extensions': {'vendor.example': ext}}):
                for suffix, mime in registry._ICON_MIME.items():
                    target = root / ('ICON' + suffix.upper())
                    target.write_bytes(b'icon bytes')
                    ext['icon'] = target.name
                    result = registry.get_installed_extension_icon('vendor.example', '1.0.0')
                    self.assertEqual(result, {'content': b'icon bytes', 'mime': mime})
                    self.assertIn('id=vendor.example&version=1.0.0', registry.get_extension_list()[0]['iconUrl'])
                    self.assertEqual(registry.get_local_marketplace_detail('vendor.example')['iconUrl'], registry.get_extension_list()[0]['iconUrl'])
                with self.assertRaises(RuntimeError):
                    registry.get_installed_extension_icon('vendor.example', '2.0.0')
                outside = base / 'outside.png'; outside.write_bytes(b'outside')
                (root / 'escape.png').symlink_to(outside)
                for raw in ['../outside.png', str(outside), 'escape.png', 'missing.png', 'package.json']:
                    ext['icon'] = raw
                    self.assertIsNone(registry.get_extension_list()[0]['iconUrl'])
                ext['icon'] = 'large.png'; (root / 'large.png').write_bytes(b'x' * (1024 * 1024 + 1))
                self.assertIsNone(registry.get_extension_list()[0]['iconUrl'])
                # Existing persisted registries must work without a registry rebuild.
                ext.pop('icon')
                (root / 'package.json').write_text('{"name":"example","publisher":"vendor","icon":"ICON.PNG"}')
                self.assertEqual(registry.get_installed_extension_icon('vendor.example', '1.0.0')['mime'], 'image/png')
    async def test_readme_is_lazy_exact_version_and_bounded(self) -> None:
        requests: list[str] = []
        metadata = _metadata()
        metadata["files"] = {"readme": f"https://open-vsx.org{_API_PATH}/file/README.md"}
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request.url.path)
            if request.url.path.endswith('/file/README.md'):
                return httpx.Response(200, text="# Readme\n\nBody")
            return httpx.Response(200, json=metadata)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            detail = await openvsx_marketplace.get_openvsx_detail(ext_id=_EXT_ID, installed_extensions=[], client=client)
            self.assertNotIn("readme", detail["extension"])
            self.assertEqual(len(requests), 1)
            detail = await openvsx_marketplace.get_openvsx_detail(ext_id=_EXT_ID, version=_VERSION,
                include_readme=True, installed_extensions=[], client=client)
            self.assertEqual(detail["extension"]["readme"], "# Readme\n\nBody")

    async def test_readme_redirect_cannot_request_private_origin(self) -> None:
        requests: list[str] = []
        metadata = _metadata()
        metadata["files"] = {"readme": f"https://open-vsx.org{_API_PATH}/file/README.md"}
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(str(request.url))
            if request.url.path.endswith('/file/README.md'):
                return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
            return httpx.Response(200, json=metadata)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(openvsx_marketplace.OpenVsxMarketplaceError):
                await openvsx_marketplace.get_openvsx_detail(ext_id=_EXT_ID, include_readme=True,
                    installed_extensions=[], client=client)
        self.assertFalse(any('127.0.0.1' in url for url in requests))

    async def test_readme_rejects_oversized_body(self) -> None:
        metadata = _metadata()
        metadata['files'] = {'readme': f'https://open-vsx.org{_API_PATH}/file/README.md'}
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b'x' * (1024 * 1024 + 1)) if request.url.path.endswith('.md') else httpx.Response(200, json=metadata)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaisesRegex(openvsx_marketplace.OpenVsxMarketplaceError, 'too large'):
                await openvsx_marketplace.get_openvsx_detail(ext_id=_EXT_ID, include_readme=True, installed_extensions=[], client=client)

    async def test_local_metadata_and_readme_reject_symlink_escape(self) -> None:
        from app.apps.code_te2 import extension_registry
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir); installed = root / 'extensions'; extension = installed / 'example'; extension.mkdir(parents=True)
            readme = extension / 'README.md'; readme.write_text('# Local', encoding='utf-8')
            registry = {"extensions": {_EXT_ID: {"path": str(extension), "version": _VERSION,
                "description": "Local description", "display_name": "Example", "source": "user"}}}
            with patch.object(extension_registry, '_EXTENSIONS_DIR', installed), patch.object(extension_registry, 'load_registry', return_value=registry):
                detail = extension_registry.get_local_marketplace_detail(_EXT_ID, True)
                self.assertEqual(detail['readme'], '# Local')
                self.assertEqual(detail['metadataSource'], 'installed')
                readme.unlink(); outside = root / 'secret'; outside.write_text('secret', encoding='utf-8'); readme.symlink_to(outside)
                self.assertEqual(extension_registry.get_local_marketplace_detail(_EXT_ID, True)['readme'], '')

    async def test_handler_uses_installed_fallback_and_rejects_version_change(self) -> None:
        from app.apps.code_te2.explorer.handlers.extensions import handle_ext_marketplace_detail
        emitted = []
        async def emit(method, payload, reply_to=None):
            emitted.append(payload)
        context = ExplorerExtensionHandlerContext(project_root=Path('/workspace'), emit_personal=emit)
        local = {'id': _EXT_ID, 'version': _VERSION, 'readme': '# Local'}
        with patch('app.apps.code_te2.extension_registry.get_extension_list', return_value=[]), \
             patch('app.apps.code_te2.extension_registry.get_local_marketplace_detail', return_value=local), \
             patch.object(openvsx_marketplace, 'get_openvsx_detail', AsyncMock(side_effect=openvsx_marketplace.OpenVsxMarketplaceError('offline'))):
            await handle_ext_marketplace_detail(context, {'ext_id': _EXT_ID, 'readme': True, 'version': _VERSION}, 'one')
            self.assertEqual(emitted[0]['extension']['readme'], '# Local')
            with self.assertRaisesRegex(RuntimeError, 'version changed'):
                await handle_ext_marketplace_detail(context, {'ext_id': _EXT_ID, 'readme': True, 'version': '0.0.0'}, 'two')


class OpenVsxMarketplaceDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_downloads_exact_artifact_and_verifies_sha256(self) -> None:
        artifact = b"verified-vsix"
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(tempfile, "tempdir", temp_dir):
                async with _client_for(artifact) as client:
                    result = await openvsx_marketplace.download_openvsx_vsix(
                        ext_id=_EXT_ID,
                        version=_VERSION,
                        client=client,
                    )
            try:
                self.assertEqual(result.read_bytes(), artifact)
                self.assertEqual(result.suffix, ".vsix")
            finally:
                result.unlink(missing_ok=True)

    async def test_rejects_artifact_outside_exact_openvsx_version_path(self) -> None:
        metadata = _metadata(
            download_url="https://example.com/basedpyright.vsix",
        )
        async with _client_for(b"artifact", metadata=metadata) as client:
            with self.assertRaisesRegex(
                openvsx_marketplace.OpenVsxMarketplaceError,
                "trusted extension artifact",
            ):
                _ = await openvsx_marketplace.download_openvsx_vsix(
                    ext_id=_EXT_ID,
                    version=_VERSION,
                    client=client,
                )

    async def test_digest_mismatch_removes_temporary_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(tempfile, "tempdir", temp_dir):
                async with _client_for(
                    b"artifact",
                    declared_sha256="0" * 64,
                ) as client:
                    with self.assertRaisesRegex(
                        openvsx_marketplace.OpenVsxMarketplaceError,
                        "failed SHA-256 verification",
                    ):
                        _ = await openvsx_marketplace.download_openvsx_vsix(
                            ext_id=_EXT_ID,
                            version=_VERSION,
                            client=client,
                        )
            self.assertEqual(list(Path(temp_dir).iterdir()), [])

    async def test_size_limit_removes_partial_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(tempfile, "tempdir", temp_dir),
                patch.object(openvsx_marketplace, "_MAX_VSIX_BYTES", 4),
            ):
                async with _client_for(b"12345") as client:
                    with self.assertRaisesRegex(
                        openvsx_marketplace.OpenVsxMarketplaceError,
                        "too large",
                    ):
                        _ = await openvsx_marketplace.download_openvsx_vsix(
                            ext_id=_EXT_ID,
                            version=_VERSION,
                            client=client,
                        )
            self.assertEqual(list(Path(temp_dir).iterdir()), [])


class OpenVsxMarketplaceHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_marketplace_installs_verified_vsix_and_removes_it(self) -> None:
        emitted: list[tuple[str, dict[str, object], str | None]] = []

        async def emit_personal(
            method: str,
            payload: dict[str, object],
            reply_to: str | None = None,
        ) -> None:
            emitted.append((method, payload, reply_to))

        context = ExplorerExtensionHandlerContext(
            project_root=Path("/workspace"),
            emit_personal=emit_personal,
        )
        with tempfile.NamedTemporaryFile(suffix=".vsix", delete=False) as handle:
            vsix_path = Path(handle.name)

        install_result: dict[str, object] = {
            "extension": {"id": _EXT_ID, "version": _VERSION},
            "registry_summary": {"total_extensions": 1, "total_slots": 1},
        }
        install_mock = Mock(return_value=install_result)
        detail_mock = AsyncMock(
            return_value={
                "extension": {
                    "id": _EXT_ID,
                    "version": _VERSION,
                    "installSupported": True,
                    "extensionKind": ["ui"],
                }
            }
        )
        download_mock = AsyncMock(return_value=vsix_path)
        restart_mock = AsyncMock()

        with (
            patch(
                "app.apps.code_te2.extension_registry.get_extension_list",
                return_value=[],
            ),
            patch(
                "app.apps.code_te2.extension_registry.install_extension",
                install_mock,
            ),
            patch.object(
                openvsx_marketplace,
                "get_openvsx_detail",
                detail_mock,
            ),
            patch.object(
                openvsx_marketplace,
                "download_openvsx_vsix",
                download_mock,
            ),
            patch(
                "app.apps.code_te2.explorer.handlers.extensions.restart_code_server_and_adapter",
                restart_mock,
            ),
            patch(
                "app.apps.code_te2.extension_registry.get_extension_config_schema",
                return_value={"properties": {"sample.setting": {"type": "boolean"}}},
            ),
        ):
            await handle_ext_marketplace_install(
                context,
                {"ext_id": _EXT_ID, "version": _VERSION},
                "request-1",
            )

        install_mock.assert_called_once_with(
            str(vsix_path),
            expected_ext_id=_EXT_ID,
        )
        self.assertFalse(vsix_path.exists())
        self.assertEqual(emitted[0][0], "ext:marketplace_installed")
        self.assertIn("sample.setting", emitted[0][1]["config_schema"]["properties"])
        restart_mock.assert_awaited_once()


if __name__ == "__main__":
    _ = unittest.main()
