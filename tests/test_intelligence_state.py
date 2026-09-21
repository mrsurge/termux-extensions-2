# pyright: strict
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from app.apps.code_te2.intelligence_state import IntelligenceStateStore
from app.apps.code_te2.preferences_store import PreferencesStore


class IntelligenceStateTests(unittest.TestCase):
    def test_migration_preserves_mode_and_removes_duplicate_authority(self) -> None:
        for enabled in (False, True):
            with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
                path = Path(directory) / "preferences.json"
                ledger = {"installed": True, "version": "4.130.0", "layout": "termux"}
                _ = path.write_text(json.dumps({
                    "ui": {"webWorkersEnabled": enabled, "gitIndicators": False},
                    "codeServerInstallation": ledger,
                }))
                prefs = PreferencesStore(path)
                snapshot = prefs.intelligence_state.read()
                self.assertEqual(snapshot.web_workers_enabled, enabled)
                self.assertEqual(snapshot.installation, {"installed": False} if enabled else ledger)
                self.assertNotIn('"webWorkersEnabled"', path.read_text())
                self.assertNotIn('"codeServerInstallation"', path.read_text())
                self.assertEqual(prefs.get_preferences()["ui"], prefs.update_preferences()["ui"])

    def test_canonical_state_wins_after_interrupted_legacy_cleanup(self) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            path = Path(directory) / "preferences.json"
            store = IntelligenceStateStore(path)
            store.set_web_workers_enabled(True)
            _ = path.write_text('{"ui":{"webWorkersEnabled":false},"codeServerInstallation":{"installed":true}}')
            prefs = PreferencesStore(path)
            self.assertTrue(prefs.intelligence_state.read().web_workers_enabled)
            self.assertEqual(prefs.get_code_server_installation(), {"installed": False})
            # Once initialized, startup needs neither preferences nor app imports.
            path.unlink()
            self.assertTrue(IntelligenceStateStore(path).read().web_workers_enabled)

    def test_invalid_canonical_state_does_not_fall_back_to_preferences(self) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            path = Path(directory) / "preferences.json"
            _ = path.write_text('{"ui":{"webWorkersEnabled":false}}')
            store = IntelligenceStateStore(path)
            for content in (
                '{',
                '{"version":2,"webWorkersEnabled":false,"codeServerInstallation":null}',
                '{"version":1,"webWorkersEnabled":"false","codeServerInstallation":null}',
                '{"version":1,"webWorkersEnabled":false}',
            ):
                _ = store.path.write_text(content)
                with self.assertRaises(ValueError):
                    _ = PreferencesStore(path)
                self.assertIn('"webWorkersEnabled"', path.read_text())

    def test_failed_migration_keeps_legacy_fields(self) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            path = Path(directory) / "preferences.json"
            original = '{"ui":{"webWorkersEnabled":true}}'
            _ = path.write_text(original)
            with patch.object(Path, "replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    _ = PreferencesStore(path)
            self.assertEqual(path.read_text(), original)
            self.assertFalse(IntelligenceStateStore(path).path.exists())
            self.assertEqual(list(path.parent.glob("intelligence.json.*")), [])

    def test_independent_instances_share_atomic_mode_and_ledger(self) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            path = Path(directory) / "preferences.json"

            def exercise(index: int) -> None:
                store = IntelligenceStateStore(path)
                if index % 2:
                    store.set_web_workers_enabled(True)
                else:
                    store.set_web_workers_enabled(False)
                snapshot = store.read()
                if snapshot.web_workers_enabled:
                    self.assertEqual(snapshot.installation, {"installed": False})

            with ThreadPoolExecutor(max_workers=4) as executor:
                _ = list(executor.map(exercise, range(40)))
            prefs = PreferencesStore(path)
            prefs.set_code_server_installation({"installed": True})
            _ = prefs.update_preferences(ui={"webWorkersEnabled": True})
            self.assertEqual(IntelligenceStateStore(path).read().installation, {"installed": False})

    def test_custom_preference_stores_are_isolated_and_reject_invalid_mode(self) -> None:
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            first = PreferencesStore(Path(directory) / "one.json")
            second = PreferencesStore(Path(directory) / "two.json")
            _ = first.update_preferences(ui={"webWorkersEnabled": True})
            self.assertFalse(second.intelligence_state.read().web_workers_enabled)
            with self.assertRaises(ValueError):
                _ = second.update_preferences(ui={"webWorkersEnabled": "true"})
            self.assertFalse(second.intelligence_state.read().web_workers_enabled)

    def test_import_boundary_does_not_load_app_or_networking(self) -> None:
        script = '''
import sys
from app.apps.code_te2 import intelligence_state, code_server_install_state
for name in ("fastapi", "pydantic", "socketio", "app.apps.code_te2.stores", "app.apps.code_te2.preferences_store"):
    assert name not in sys.modules, name
'''
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
