from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from app.apps.file_editor_cm6.extension_registry import (
    NidExtractionError,
    _extract_nids_from_bundle_result,
    _extract_nids_from_protocol_source_result,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


def _bundle(factory: str) -> str:
    return (
        "(()=>{var before=1;"
        f'var F={{MainThreadAuthentication:{factory}("MainThreadAuthentication"),'
        f'MainThreadDialogs:{factory}("MainThreadDiaglogs"),'
        f'MainThreadOutputService:{factory}("MainThreadOutputService")}},'
        f'ge={{ExtHostCodeMapper:{factory}("ExtHostCodeMapper"),'
        f'ExtHostConfiguration:{factory}("ExtHostConfiguration"),'
        f'ExtHostOutputService:{factory}("ExtHostOutputService")}};'
        "return [F,ge]})();"
    )


SOURCE = """
export const MainContext = {
    MainThreadAuthentication: createProxyIdentifier<MainThreadAuthenticationShape>('MainThreadAuthentication'),
    MainThreadDialogs: createProxyIdentifier<MainThreadDiaglogsShape>('MainThreadDiaglogs'),
    MainThreadOutputService: createProxyIdentifier<MainThreadOutputServiceShape>('MainThreadOutputService'),
};

export const ExtHostContext = {
    ExtHostCodeMapper: createProxyIdentifier<ExtHostCodeMapperShape>('ExtHostCodeMapper'),
    ExtHostConfiguration: createProxyIdentifier<ExtHostConfigurationShape>('ExtHostConfiguration'),
    ExtHostOutputService: createProxyIdentifier<ExtHostOutputServiceShape>('ExtHostOutputService'),
};
"""


class NidExtractionTests(unittest.TestCase):
    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or REPO_ROOT / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write(self, name: str, content: str) -> Path:
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_current_alphanumeric_factory_shape(self) -> None:
        result = _extract_nids_from_bundle_result(str(self._write("current.js", _bundle("N"))))

        self.assertEqual("minified-proxy-objects:N", result.strategy)
        self.assertEqual(3, result.nids["MainThreadOutputService"])
        self.assertEqual(5, result.nids["ExtHostConfiguration"])
        self.assertEqual(6, result.nids["ExtHostOutputService"])
        self.assertIn("MainThreadDialogs", result.nids)
        self.assertNotIn("MainThreadDiaglogs", result.nids)

    def test_code_server_4_117_dollar_factory_shape(self) -> None:
        result = _extract_nids_from_bundle_result(str(self._write("code-server-4.117.js", _bundle("$"))))

        self.assertEqual("minified-proxy-objects:$", result.strategy)
        self.assertEqual(6, len(result.nids))
        self.assertEqual(5, result.nids["ExtHostConfiguration"])

    def test_protocol_source_order_matches_bundle_order(self) -> None:
        bundle_result = _extract_nids_from_bundle_result(str(self._write("bundle.js", _bundle("$"))))
        source_result = _extract_nids_from_protocol_source_result(
            str(self._write("extHost.protocol.ts", SOURCE))
        )

        self.assertEqual("extHost.protocol.ts", source_result.strategy)
        self.assertEqual(bundle_result.nids, source_result.nids)

    def test_missing_ext_host_object_has_precise_error(self) -> None:
        incomplete = 'var F={MainThreadAuthentication:$("MainThreadAuthentication")};'
        path = self._write("incomplete.js", incomplete)

        with self.assertRaisesRegex(NidExtractionError, "ExtHostContext object anchor"):
            _extract_nids_from_bundle_result(str(path))


if __name__ == "__main__":
    unittest.main()
