from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.apps.file_editor_cm6 import project_sidecar
from app.apps.file_editor_cm6.open_state_backend import (
    read_sidecar_open_state,
    remove_sidecar_recent_file,
    write_sidecar_open_file,
)


class OpenStateRecentsTests(unittest.TestCase):
    def setUp(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    def tearDown(self) -> None:
        project_sidecar.ProjectSidecar._instances.clear()

    def test_open_state_projects_bounded_sidecar_recents(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            first = project / "first.py"
            second = project / "second.rs"
            first.write_text("first\n", encoding="utf-8")
            second.write_text("second\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                first_state = write_sidecar_open_file(
                    str(project),
                    str(first),
                    require_existing_sidecar=False,
                )
                second_state = write_sidecar_open_file(str(project), str(second))

                self.assertEqual(
                    [entry["path"] for entry in second_state["recents"]],
                    [str(second), str(first)],
                )
                self.assertTrue(all(entry["exists"] for entry in second_state["recents"]))
                self.assertEqual(first_state["recents"][0]["label"], "first.py")

                first.unlink()
                replay = read_sidecar_open_state(project.as_posix(), reason="reconnect")
                missing = next(
                    entry for entry in replay["recents"] if entry["path"] == str(first)
                )
                self.assertFalse(missing["exists"])

    def test_remove_recent_file_clears_active_and_bumps_revision_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            first = project / "first.py"
            second = project / "second.rs"
            first.write_text("first\n", encoding="utf-8")
            second.write_text("second\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                write_sidecar_open_file(
                    str(project),
                    str(first),
                    require_existing_sidecar=False,
                )
                before = write_sidecar_open_file(str(project), str(second))
                removed, after = remove_sidecar_recent_file(
                    str(project),
                    str(second),
                )

                self.assertTrue(removed)
                self.assertIsNone(after["openFile"])
                self.assertEqual(after["revision"], before["revision"] + 1)
                self.assertEqual(
                    [entry["path"] for entry in after["recents"]],
                    [str(first)],
                )

                removed_again, unchanged = remove_sidecar_recent_file(
                    str(project),
                    str(second),
                )
                self.assertFalse(removed_again)
                self.assertEqual(unchanged["revision"], after["revision"])

    def test_recent_file_preserves_top_visible_line_across_mru_reordering(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            first = project / "first.py"
            second = project / "second.rs"
            first.write_text("first\n", encoding="utf-8")
            second.write_text("second\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                sidecar = project_sidecar.ProjectSidecar.load_or_create(str(project))
                sidecar.record_file_activity(str(first), scroll_line=37)
                sidecar.record_file_activity(str(second), scroll_line=12)
                sidecar.record_file_activity(str(first))
                sidecar.save()

                state = read_sidecar_open_state(str(project), reason="reconnect")
                by_path = {entry["path"]: entry for entry in state["recents"]}
                self.assertEqual(by_path[str(first)]["scroll_line"], 37)
                self.assertEqual(by_path[str(second)]["scroll_line"], 12)


if __name__ == "__main__":
    unittest.main()
