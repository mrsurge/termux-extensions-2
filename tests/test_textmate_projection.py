from __future__ import annotations

import json
from pathlib import Path
from unittest import TestCase
from typing import cast
from unittest.mock import patch

from app.apps.code_te2.extension_registry import (
    _parse_package_json,  # pyright: ignore[reportPrivateUsage]
    _textmate_revision,  # pyright: ignore[reportPrivateUsage]
    toggle_extension,
)
from app.apps.code_te2.textmate_projection import (
    TextmateProjectionError,
    get_textmate_catalog,
    get_textmate_grammar_body,
)


class TextmateProjectionTests(TestCase):
    def _registry(self, root: Path) -> dict[str, object]:
        grammar_path = root / "syntaxes" / "test.tmLanguage.json"
        stat = grammar_path.stat()
        return {
            "textmate_revision": "revision-1",
            "extensions": {
                "test.extension": {
                    "id": "test.extension",
                    "version": "1.0.0",
                    "path": str(root),
                    "active": True,
                    "language_contributions": [{
                        "id": "test",
                        "extensions": [".test"],
                        "filenames": ["Testfile"],
                    }],
                    "grammars": [{
                        "path": "syntaxes/test.tmLanguage.json",
                        "scopeName": "source.test",
                        "language": "test",
                        "embeddedLanguages": {"meta.embedded": "javascript"},
                        "tokenTypes": {"meta.embedded": "other"},
                        "injectTo": ["source.js"],
                        "balancedBracketScopes": ["*"],
                        "unbalancedBracketScopes": ["comment"],
                        "size": stat.st_size,
                        "mtime_ns": stat.st_mtime_ns,
                    }],
                },
            },
        }

    def test_package_parser_retains_complete_grammar_identity(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            syntax = root / "syntaxes" / "test.tmLanguage.json"
            syntax.parent.mkdir()
            _ = syntax.write_text('{"scopeName":"source.test","patterns":[]}', encoding="utf-8")
            _ = (root / "package.json").write_text(json.dumps({
                "name": "extension",
                "publisher": "test",
                "version": "1.0.0",
                "contributes": {
                    "languages": [{
                        "id": "test",
                        "extensions": [".test"],
                        "filenames": ["Testfile"],
                    }],
                    "grammars": [{
                        "language": "test",
                        "scopeName": "source.test",
                        "path": "./syntaxes/test.tmLanguage.json",
                        "injectTo": ["source.js"],
                    }],
                },
            }), encoding="utf-8")

            parsed = _parse_package_json(root / "package.json")
            self.assertIsNotNone(parsed)
            parsed_entry = cast(dict[str, object], parsed)
            grammar_values = cast(list[object], parsed_entry["grammars"])
            grammar = cast(dict[str, object], grammar_values[0])
            self.assertEqual(grammar["scopeName"], "source.test")
            self.assertEqual(grammar["injectTo"], ["source.js"])
            self.assertEqual(grammar["size"], syntax.stat().st_size)
            language_values = cast(list[object], parsed_entry["language_contributions"])
            language = cast(dict[str, object], language_values[0])
            self.assertEqual(language["extensions"], [".test"])
            self.assertEqual(language["filenames"], ["Testfile"])

    def test_catalog_and_body_share_one_revision(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir()
            _ = grammar_path.write_text('{"scopeName":"source.test","patterns":[]}', encoding="utf-8")
            registry = self._registry(root)
            extensions = cast(dict[str, dict[str, object]], registry["extensions"])
            self.assertIsInstance(extensions, dict)
            revision = _textmate_revision(extensions)
            self.assertEqual(len(revision), 64)

            with (
                patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry),
                patch("app.apps.code_te2.textmate_projection._allowed_extension_roots", return_value=(root.parent,)),
            ):
                catalog = get_textmate_catalog()
                body = get_textmate_grammar_body(
                    "test.extension/syntaxes/test.tmLanguage.json",
                    "revision-1",
                )

            self.assertEqual(catalog["revision"], "revision-1")
            self.assertEqual(catalog["grammars"][0]["scopeName"], "source.test")
            self.assertEqual(catalog["languages"][0]["extensions"], [".test"])
            self.assertIn("source.test", body["raw"])

    def test_changed_resource_is_rejected_until_registry_rebuild(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir()
            _ = grammar_path.write_text('{"scopeName":"source.test","patterns":[]}', encoding="utf-8")
            registry = self._registry(root)
            _ = grammar_path.write_text('{"scopeName":"source.changed","patterns":[]}', encoding="utf-8")

            with (
                patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry),
                patch("app.apps.code_te2.textmate_projection._allowed_extension_roots", return_value=(root.parent,)),
            ):
                with self.assertRaisesRegex(TextmateProjectionError, "resource_changed"):
                    _ = get_textmate_grammar_body(
                        "test.extension/syntaxes/test.tmLanguage.json",
                        "revision-1",
                    )

    def test_toggle_rotates_and_publishes_textmate_revision(self) -> None:
        registry = {
            "textmate_revision": "revision-1",
            "extensions": {
                "test.extension": {
                    "id": "test.extension",
                    "version": "1.0.0",
                    "path": "/extensions/test",
                    "active": True,
                    "language_contributions": [],
                    "grammars": [{
                        "path": "syntaxes/test.tmLanguage.json",
                        "scopeName": "source.test",
                    }],
                },
            },
            "language_slots": {},
        }
        published: list[str] = []
        with (
            patch("app.apps.code_te2.extension_registry.load_registry", return_value=registry),
            patch("app.apps.code_te2.extension_registry.save_registry"),
            patch("app.apps.code_te2.extension_registry.rebuild_settings_gate", return_value={"ok": True}),
            patch(
                "app.apps.code_te2.extension_registry._publish_textmate_projection_changed",
                side_effect=published.append,
            ),
        ):
            _ = toggle_extension("test.extension", False)

        next_revision = cast(str, registry["textmate_revision"])
        self.assertNotEqual(next_revision, "revision-1")
        self.assertEqual(published, [next_revision])
