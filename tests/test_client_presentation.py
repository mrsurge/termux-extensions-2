from __future__ import annotations

import copy
import unittest
from typing import cast
from unittest.mock import patch

from app.apps.code_te2 import boot_snapshot_backend
from app.apps.code_te2.client_presentation import (
    client_presentation_identity_from_environ,
    client_presentation_room,
)


class ClientPresentationIdentityTests(unittest.TestCase):
    def test_parses_stable_client_and_optional_window_identity(self) -> None:
        identity = client_presentation_identity_from_environ(
            {
                "QUERY_STRING": (
                    "app_id=code_te2&client_instance_id=client_aaaaaaaaaaaa"
                    "&window_id=window_aaaaaaaaaaaaaaaaaaaa"
                )
            }
        )
        self.assertEqual(
            identity,
            {
                "clientInstanceId": "client_aaaaaaaaaaaa",
                "windowId": "window_aaaaaaaaaaaaaaaaaaaa",
            },
        )
        self.assertEqual(
            client_presentation_room("client_aaaaaaaaaaaa"),
            "code_te2:client:client_aaaaaaaaaaaa",
        )

    def test_rejects_missing_or_malformed_client_identity(self) -> None:
        with self.assertRaisesRegex(ValueError, "client_identity_required"):
            client_presentation_identity_from_environ({"QUERY_STRING": ""})
        with self.assertRaisesRegex(ValueError, "client_identity_required"):
            client_presentation_identity_from_environ(
                {"QUERY_STRING": "client_instance_id=window_wrong"}
            )

    def test_boot_overlay_keeps_shared_snapshot_and_foregrounds_independent(self) -> None:
        shared: dict[str, object] = {
            "ok": True,
            "snapshot": {
                "host_state": {
                    "activeProject": "/workspace",
                    "openState": {
                        "projectPath": "/workspace",
                        "recents": [
                            {"path": "/workspace/a.py"},
                            {"path": "/workspace/b.rs"},
                        ],
                    },
                },
                "editor_ssot": {},
                "explorer_bootstrap": {},
            },
        }
        original = copy.deepcopy(shared)

        def editor_snapshot(*, client_instance_id: str) -> dict[str, object]:
            client_id = client_instance_id
            path = "/workspace/a.py" if client_id == "client_aaaaaaaaaaaa" else "/workspace/b.rs"
            return {
                "clientInstanceId": client_id,
                "clientForeground": {
                    "clientInstanceId": client_id,
                    "path": path,
                    "rel": path.rsplit("/", 1)[-1],
                },
                "currentPath": path,
                "file": {
                    "path": path,
                    "content": client_id,
                    "document_revision": 1,
                },
            }

        with patch.object(
            boot_snapshot_backend,
            "_editor_snapshot_builder",
            side_effect=editor_snapshot,
        ):
            client_a = boot_snapshot_backend._overlay_client_foreground(  # pyright: ignore[reportPrivateUsage]
                shared,
                client_instance_id="client_aaaaaaaaaaaa",
            )
            client_b = boot_snapshot_backend._overlay_client_foreground(  # pyright: ignore[reportPrivateUsage]
                shared,
                client_instance_id="client_bbbbbbbbbbbb",
            )

        self.assertEqual(shared, original)
        snapshot_a = cast(dict[str, object], client_a["snapshot"])
        snapshot_b = cast(dict[str, object], client_b["snapshot"])
        assert isinstance(snapshot_a, dict)
        assert isinstance(snapshot_b, dict)
        host_a = cast(dict[str, object], snapshot_a["host_state"])
        host_b = cast(dict[str, object], snapshot_b["host_state"])
        assert isinstance(host_a, dict)
        assert isinstance(host_b, dict)
        self.assertEqual(host_a["currentPath"], "/workspace/a.py")
        self.assertEqual(host_b["currentPath"], "/workspace/b.rs")
        editor_a = cast(dict[str, object], snapshot_a["editor_ssot"])
        editor_b = cast(dict[str, object], snapshot_b["editor_ssot"])
        assert isinstance(editor_a, dict)
        assert isinstance(editor_b, dict)
        file_a = cast(dict[str, object], editor_a["file"])
        file_b = cast(dict[str, object], editor_b["file"])
        assert isinstance(file_a, dict)
        assert isinstance(file_b, dict)
        self.assertEqual(file_a["content"], "client_aaaaaaaaaaaa")
        self.assertEqual(file_b["content"], "client_bbbbbbbbbbbb")


if __name__ == "__main__":
    unittest.main()
