from __future__ import annotations

import unittest

from desktop_client.ui import app_id_from_uri


class DesktopUiTests(unittest.TestCase):
    def test_app_id_is_resolved_from_framework_app_path(self) -> None:
        self.assertEqual(
            app_id_from_uri("http://127.0.0.1:8089/app/file_editor_cm6"),
            "file_editor_cm6",
        )

    def test_app_id_is_resolved_from_legacy_query_shape(self) -> None:
        self.assertEqual(
            app_id_from_uri(
                "https://framework.example/app?app_id=terminal"
            ),
            "terminal",
        )

    def test_non_app_and_invalid_app_urls_are_rejected(self) -> None:
        self.assertIsNone(app_id_from_uri("app://android_shell/index.html"))
        self.assertIsNone(
            app_id_from_uri("http://127.0.0.1:8089/app/not%2Fsafe")
        )


if __name__ == "__main__":
    unittest.main()
