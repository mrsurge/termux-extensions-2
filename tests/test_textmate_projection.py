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
    MAX_GRAMMAR_BATCH_SIZE,
    TextmateProjectionError,
    get_textmate_catalog,
    get_textmate_grammar_body,
    get_textmate_grammar_bodies,
    get_textmate_grammar_closure,
    get_textmate_grammar_chunk,
    get_textmate_http_grammar,
)


class TextmateProjectionTests(TestCase):
    def test_closure_uses_guarded_bodies_and_omits_known_revision_resources(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            parent = Path(temp_dir)
            root = parent / "extension"
            syntax = root / "syntaxes" / "test.tmLanguage.json"
            syntax.parent.mkdir(parents=True)
            syntax.write_text('{"scopeName":"source.test","patterns":[]}', encoding="utf-8")
            registry = self._registry(root)
            with patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry), \
                 patch("app.apps.code_te2.textmate_projection._allowed_extension_roots", return_value=(parent,)):
                result = get_textmate_grammar_closure("source.test", "revision-1", [])
                assert len(result["ids"]) == 1
                assert list(result["bodies"]) == result["ids"]
                assert result["complete"] is True
                metadata = get_textmate_grammar_closure("source.test", "revision-1", [], True)
                assert metadata["bodies"] == {}
                assert metadata["fingerprints"] == result["fingerprints"]
                chunk = get_textmate_grammar_chunk(result["ids"][0], "revision-1", 0)
                assert chunk["raw"] == syntax.read_text(encoding="utf-8")
                assert chunk["done"] is True
                assert chunk["sha256"] == metadata["fingerprints"][result["ids"][0]]
                resource = get_textmate_http_grammar(result["ids"][0], "revision-1", str(chunk["sha256"]))
                assert resource["raw"] == chunk["raw"]
                assert resource["sha256"] == chunk["sha256"]
                with self.assertRaisesRegex(TextmateProjectionError, "fingerprint_changed"):
                    get_textmate_http_grammar(result["ids"][0], "revision-1", "0" * 64)
                with self.assertRaisesRegex(TextmateProjectionError, "revision_changed"):
                    get_textmate_http_grammar(result["ids"][0], "stale")
                warm = get_textmate_grammar_closure("source.test", "revision-1", result["ids"])
                assert warm["bodies"] == {}
                with patch("app.apps.code_te2.textmate_projection._MAX_GRAMMAR_BATCH_BYTES", 1):
                    prefix = get_textmate_grammar_closure("source.test", "revision-1", [])
                    assert prefix["complete"] is False
                    assert prefix["bodies"] == {}
                with self.assertRaisesRegex(TextmateProjectionError, "revision_changed"):
                    get_textmate_grammar_closure("source.test", "stale", [])
                with self.assertRaisesRegex(TextmateProjectionError, "offset_invalid"):
                    get_textmate_grammar_chunk(result["ids"][0], "revision-1", -1)
                # Known bodies do not bypass current filesystem identity checks.
                syntax.write_text('{"scopeName":"source.test","patterns":[],"changed":true}', encoding="utf-8")
                with self.assertRaisesRegex(TextmateProjectionError, "resource_changed"):
                    get_textmate_grammar_closure("source.test", "revision-1", result["ids"])

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

    def test_body_resolves_only_requested_extension_and_allowed_roots_once(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "test"
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir(parents=True)
            _ = grammar_path.write_text('{"scopeName":"source.test"}', encoding="utf-8")
            registry = self._registry(root)
            extensions = cast(dict[str, dict[str, object]], registry["extensions"])
            registry["extensions"] = {
                "other.extension": {
                    "path": str(Path(temp_dir) / "missing"),
                    "active": True,
                    "grammars": [{"path": "syntaxes/other.tmLanguage.json"}],
                },
                **extensions,
            }

            with (
                patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry),
                patch(
                    "app.apps.code_te2.textmate_projection._allowed_extension_roots",
                    return_value=(Path(temp_dir),),
                ) as allowed_roots,
            ):
                body = get_textmate_grammar_body(
                    "test.extension/syntaxes/test.tmLanguage.json", "revision-1",
                )

            self.assertIn("source.test", body["raw"])
            allowed_roots.assert_called_once_with()

    def test_batch_uses_one_registry_snapshot_and_isolates_bad_grammar(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "test"
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir(parents=True)
            _ = grammar_path.write_text('{"scopeName":"source.test"}', encoding="utf-8")
            registry = self._registry(root)
            with (
                patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry) as load,
                patch("app.apps.code_te2.textmate_projection._allowed_extension_roots", return_value=(Path(temp_dir),)) as roots,
            ):
                result = get_textmate_grammar_bodies(
                    ["test.extension/syntaxes/test.tmLanguage.json", "test.extension/syntaxes/missing.json"],
                    "revision-1",
                )

            self.assertEqual(result["revision"], "revision-1")
            self.assertTrue(result["bodies"]["test.extension/syntaxes/test.tmLanguage.json"]["ok"])
            self.assertFalse(result["bodies"]["test.extension/syntaxes/missing.json"]["ok"])
            load.assert_called_once_with()
            roots.assert_called_once_with()

    def test_batch_rejects_stale_revision_and_unbounded_or_duplicate_requests(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "test"
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir(parents=True)
            _ = grammar_path.write_text('{"scopeName":"source.test"}', encoding="utf-8")
            registry = self._registry(root)
            with patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry):
                with self.assertRaisesRegex(TextmateProjectionError, "revision_changed"):
                    _ = get_textmate_grammar_bodies(["test.extension/syntaxes/test.tmLanguage.json"], "old")
                with self.assertRaisesRegex(TextmateProjectionError, "batch_invalid"):
                    _ = get_textmate_grammar_bodies(["same", "same"], "revision-1")
                with self.assertRaisesRegex(TextmateProjectionError, "batch_invalid"):
                    _ = get_textmate_grammar_bodies([f"id/{index}" for index in range(MAX_GRAMMAR_BATCH_SIZE + 1)], "revision-1")

    def test_body_rejects_declared_grammar_escaping_extension_root(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "test"
            grammar_path = root / "syntaxes" / "test.tmLanguage.json"
            grammar_path.parent.mkdir(parents=True)
            _ = grammar_path.write_text('{"scopeName":"source.test"}', encoding="utf-8")
            registry = self._registry(root)
            extensions = cast(dict[str, dict[str, object]], registry["extensions"])
            grammars = cast(list[dict[str, object]], extensions["test.extension"]["grammars"])
            grammars[0]["path"] = "../outside.tmLanguage.json"

            with (
                patch("app.apps.code_te2.textmate_projection.load_registry", return_value=registry),
                patch("app.apps.code_te2.textmate_projection._allowed_extension_roots", return_value=(Path(temp_dir),)),
            ):
                with self.assertRaisesRegex(TextmateProjectionError, "path_outside_extension"):
                    _ = get_textmate_grammar_body(
                        "test.extension/../outside.tmLanguage.json", "revision-1",
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
