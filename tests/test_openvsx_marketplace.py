from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from app.apps.file_editor_cm6 import extension_registry
from app.apps.file_editor_cm6.explorer.contracts.extensions import (
    ExplorerExtensionsContractError,
    parse_marketplace_detail_params,
    parse_marketplace_install_params,
    parse_marketplace_search_params,
)
from app.apps.file_editor_cm6.explorer.services.openvsx_marketplace import (
    OpenVsxMarketplaceError,
    get_openvsx_detail,
    search_openvsx,
)


class MarketplaceContractTests(unittest.TestCase):
    def test_search_params_are_trimmed_and_bounded(self) -> None:
        self.assertEqual(
            {"query": "python", "offset": 20, "size": 10},
            parse_marketplace_search_params(
                {"query": "  python  ", "offset": 20, "size": 10}
            ),
        )
        with self.assertRaisesRegex(
            ExplorerExtensionsContractError,
            "at least 2",
        ):
            parse_marketplace_search_params({"query": "p"})
        with self.assertRaisesRegex(
            ExplorerExtensionsContractError,
            "between 1 and 50",
        ):
            parse_marketplace_search_params({"query": "python", "size": 51})

    def test_detail_and_install_require_normalized_identifiers(self) -> None:
        self.assertEqual(
            {"ext_id": "ms-python.python"},
            parse_marketplace_detail_params({"ext_id": "ms-python.python"}),
        )
        self.assertEqual(
            {"ext_id": "ms-python.python", "version": "2026.4.0"},
            parse_marketplace_install_params(
                {"ext_id": "ms-python.python", "version": "2026.4.0"}
            ),
        )
        with self.assertRaisesRegex(
            ExplorerExtensionsContractError,
            "publisher.name",
        ):
            parse_marketplace_detail_params({"ext_id": "not-an-extension-id"})
        with self.assertRaisesRegex(
            ExplorerExtensionsContractError,
            "version is invalid",
        ):
            parse_marketplace_install_params(
                {"ext_id": "ms-python.python", "version": "latest/../../bad"}
            )


class MarketplaceServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_normalizes_and_merges_installed_version(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual("/api/-/search", request.url.path)
            self.assertEqual("python", request.url.params["query"])
            return httpx.Response(
                200,
                json={
                    "offset": 0,
                    "totalSize": 1,
                    "extensions": [
                        {
                            "namespace": "ms-python",
                            "name": "python",
                            "displayName": "Python",
                            "version": "2026.4.0",
                            "description": " Python language support ",
                            "downloadCount": 100,
                            "averageRating": 4.5,
                            "verified": True,
                            "files": {
                                "icon": (
                                    "https://open-vsx.org/api/ms-python/python/"
                                    "2026.4.0/file/icon.png"
                                )
                            },
                        }
                    ],
                },
            )

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            result = await search_openvsx(
                query="python",
                offset=0,
                size=20,
                installed_extensions=[
                    {"id": "MS-PYTHON.PYTHON", "version": "2026.2.0"}
                ],
                client=client,
            )

        self.assertEqual(1, result["total"])
        items = result["items"]
        self.assertIsInstance(items, list)
        assert isinstance(items, list)
        self.assertEqual("2026.2.0", items[0]["installedVersion"])
        self.assertEqual("Python language support", items[0]["description"])
        self.assertEqual(
            "https://open-vsx.org/api/ms-python/python/2026.4.0/file/icon.png",
            items[0]["iconUrl"],
        )

    async def test_detail_marks_ui_only_unsupported_and_filters_http_links(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual("/api/vendor/theme/latest", request.url.path)
            return httpx.Response(
                200,
                json={
                    "namespace": "vendor",
                    "name": "theme",
                    "displayName": "Theme",
                    "version": "1.2.3",
                    "description": "A UI extension",
                    "extensionKind": ["ui"],
                    "engines": {"vscode": "^1.100.0"},
                    "license": "MIT",
                    "repository": "http://example.invalid/repository",
                    "homepage": "https://example.com/theme",
                    "files": {
                        "icon": (
                            "https://open-vsx.org/api/vendor/other/"
                            "1.2.3/file/icon.svg"
                        )
                    },
                },
            )

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            result = await get_openvsx_detail(
                ext_id="vendor.theme",
                installed_extensions=[],
                client=client,
            )

        extension = result["extension"]
        self.assertIsInstance(extension, dict)
        assert isinstance(extension, dict)
        self.assertFalse(extension["installSupported"])
        self.assertEqual(
            "UI extensions are not currently supported.",
            extension["unsupportedReason"],
        )
        self.assertIsNone(extension["repository"])
        self.assertEqual("https://example.com/theme", extension["homepage"])
        self.assertIsNone(extension["iconUrl"])

    async def test_invalid_and_failed_responses_are_concise(self) -> None:
        async def malformed_handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"not json")

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(malformed_handler)
        ) as client:
            with self.assertRaisesRegex(OpenVsxMarketplaceError, "invalid JSON"):
                await search_openvsx(
                    query="python",
                    offset=0,
                    size=20,
                    installed_extensions=[],
                    client=client,
                )

        async def failed_handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(503, json={"error": "unavailable"})

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(failed_handler)
        ) as client:
            with self.assertRaisesRegex(OpenVsxMarketplaceError, "status 503"):
                await get_openvsx_detail(
                    ext_id="vendor.extension",
                    installed_extensions=[],
                    client=client,
                )

    async def test_timeout_is_reported_without_transport_details(self) -> None:
        async def timeout_handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("socket stalled", request=request)

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(timeout_handler)
        ) as client:
            with self.assertRaisesRegex(OpenVsxMarketplaceError, "timed out"):
                await search_openvsx(
                    query="python",
                    offset=0,
                    size=20,
                    installed_extensions=[],
                    client=client,
                )


class MarketplaceInstallCommandTests(unittest.TestCase):
    def test_install_by_id_uses_exact_code_server_spec(self) -> None:
        installation = extension_registry.CodeServerInstallation(
            executable=Path("/opt/code-server/bin/code-server"),
            vscode_root=None,
            source="test",
        )
        completed = SimpleNamespace(returncode=0, stdout="installed", stderr="")
        expected = {
            "ok": True,
            "extension": {"id": "ms-python.python", "version": "2026.4.0"},
            "registry_summary": {"total_extensions": 1, "total_slots": 1},
        }

        with (
            patch.object(
                extension_registry,
                "_require_code_server_installation",
                return_value=installation,
            ),
            patch.object(
                extension_registry,
                "_code_server_subprocess_env",
                return_value={"PATH": "/opt/code-server/bin"},
            ),
            patch.object(
                extension_registry.subprocess,
                "run",
                return_value=completed,
            ) as run,
            patch.object(
                extension_registry,
                "_post_install_result",
                return_value=expected,
            ) as post_install,
        ):
            result = extension_registry.install_extension_by_id(
                "ms-python.python",
                "2026.4.0",
            )

        self.assertEqual(expected, result)
        command = run.call_args.args[0]
        self.assertEqual(
            [
                "/opt/code-server/bin/code-server",
                "--install-extension",
                "ms-python.python@2026.4.0",
                "--extensions-dir",
                str(extension_registry._EXTENSIONS_DIR),
                "--force",
            ],
            command,
        )
        post_install.assert_called_once_with(expected_ext_id="ms-python.python")


if __name__ == "__main__":
    unittest.main()
