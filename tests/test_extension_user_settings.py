from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import override
from unittest.mock import patch

from app.apps.file_editor_cm6 import extension_registry


REPO_ROOT = Path(__file__).resolve().parents[1]


def _extension_entry() -> dict[str, object]:
    return {
        "id": "example.tool",
        "name": "tool",
        "display_name": "Tool",
        "version": "1.0.0",
        "source": "user",
        "active": True,
        "languages": [],
        "grammar_languages": [],
        "configuration_schema": {
            "tool.enabled": {"type": "boolean", "default": False},
            "tool.mode": {"type": "string", "default": "safe"},
        },
    }


class ExtensionUserSettingsTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str]
    root: Path
    registry_path: Path
    settings_path: Path
    patchers: list[object]

    @override
    def setUp(self) -> None:
        scratch_root = Path(os.environ.get("TEMPDIR") or REPO_ROOT / ".codex-scratch")
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=scratch_root)
        self.root = Path(self.temp_dir.name)
        self.registry_path = self.root / "config" / "te2_extension_registry.json"
        self.settings_path = self.root / "config" / "User" / "settings.json"
        self.patchers = [
            patch.object(extension_registry, "_REGISTRY_PATH", self.registry_path),
            patch.object(extension_registry, "_USER_SETTINGS_PATH", self.settings_path),
        ]
        for patcher in self.patchers:
            patcher.start()  # type: ignore[attr-defined]

    @override
    def tearDown(self) -> None:
        for patcher in reversed(self.patchers):
            patcher.stop()  # type: ignore[attr-defined]
        self.temp_dir.cleanup()

    def _save_registry(self, *, user_settings: dict[str, object] | None = None) -> None:
        extension_registry.save_registry(
            {
                "version": 2,
                "updated_at": 0,
                "extensions": {"example.tool": _extension_entry()},
                "language_slots": {},
                "user_settings": dict(user_settings or {}),
            }
        )

    def _read_settings(self) -> dict[str, object]:
        raw = json.loads(self.settings_path.read_text(encoding="utf-8"))
        self.assertIsInstance(raw, dict)
        return raw

    def test_schema_form_writes_non_language_extension_to_global_settings(self) -> None:
        self._save_registry()

        final = extension_registry.set_extension_config(
            "example.tool",
            {"tool.enabled": True, "tool.mode": "fast"},
        )

        self.assertIs(final["tool.enabled"], True)
        self.assertEqual("fast", final["tool.mode"])
        self.assertEqual(final, self._read_settings())
        listed = extension_registry.get_extension_list()
        self.assertEqual(
            {"tool.enabled": True, "tool.mode": "fast"},
            listed[0]["configuration_values"],
        )
        self.assertFalse((self.root / ".vscode" / "settings.json").exists())

    def test_schema_form_and_user_json_share_one_global_map(self) -> None:
        self._save_registry()
        extension_registry.set_custom_settings(
            {
                "tool.enabled": False,
                "unrelated.setting": 7,
                "editor.hover.enabled": True,
            }
        )

        extension_registry.set_extension_config(
            "example.tool",
            {"tool.enabled": True},
        )

        self.assertEqual(
            {
                "tool.enabled": True,
                "unrelated.setting": 7,
                "editor.hover.enabled": True,
            },
            extension_registry.get_custom_settings(),
        )
        final = self._read_settings()
        self.assertIs(final["tool.enabled"], True)
        self.assertEqual(7, final["unrelated.setting"])
        self.assertIs(final["editor.hover.enabled"], True)
        self.assertNotIn("tool.mode", final)

    def test_schema_form_removes_omitted_schema_values(self) -> None:
        self._save_registry(
            user_settings={
                "tool.enabled": True,
                "tool.mode": "fast",
                "unrelated.setting": 7,
            }
        )
        extension_registry.rebuild_settings_gate()

        extension_registry.set_extension_config(
            "example.tool",
            {"tool.mode": "safe"},
        )

        final = self._read_settings()
        self.assertNotIn("tool.enabled", final)
        self.assertEqual("safe", final["tool.mode"])
        self.assertEqual(7, final["unrelated.setting"])

    def test_version_one_registry_migrates_to_one_user_settings_map(self) -> None:
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_extension = _extension_entry()
        legacy_extension["configuration_values"] = {
            "tool.mode": "legacy",
            "tool.enabled": True,
        }
        self.registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "extensions": {"example.tool": legacy_extension},
                    "language_slots": {},
                    "custom_settings": {"tool.mode": "explicit"},
                }
            ),
            encoding="utf-8",
        )
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(
            json.dumps(
                {
                    "tool.mode": "materialized",
                    "file.only": 11,
                    "editor.hover.enabled": False,
                    "files.watcherExclude": {"**/.git/*.lock": True},
                    "[python]": {"editor.hover.enabled": True},
                }
            ),
            encoding="utf-8",
        )

        migrated = extension_registry.load_registry()

        self.assertEqual(2, migrated["version"])
        self.assertNotIn("custom_settings", migrated)
        migrated_extension = migrated["extensions"]["example.tool"]  # type: ignore[index]
        self.assertNotIn("configuration_values", migrated_extension)
        self.assertEqual(
            {"tool.mode": "explicit", "tool.enabled": True, "file.only": 11},
            migrated["user_settings"],
        )

        final = extension_registry.rebuild_settings_gate(migrated)
        self.assertEqual("explicit", final["tool.mode"])
        self.assertIs(final["tool.enabled"], True)
        self.assertEqual(11, final["file.only"])
        self.assertEqual({"**/.git/*.lock": True}, final["files.watcherExclude"])


if __name__ == "__main__":
    unittest.main()
