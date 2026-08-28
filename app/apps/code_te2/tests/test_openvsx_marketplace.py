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
        restart_mock.assert_awaited_once()


if __name__ == "__main__":
    _ = unittest.main()
