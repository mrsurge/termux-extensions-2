from __future__ import annotations

import asyncio
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import cast
from unittest.mock import patch

from app.apps.code_te2 import project_sidecar
from app.apps.code_te2.file_tabs_projection import (
    build_file_tabs_projection,
)
from app.apps.code_te2.open_state_backend import (
    read_client_foreground,
    read_sidecar_open_state,
    remove_sidecar_recent_file,
    write_client_document_open,
    write_sidecar_open_file,
)


CLIENT_A = "client_aaaaaaaaaaaa"
CLIENT_B = "client_bbbbbbbbbbbb"


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

    def test_remove_recent_file_reconciles_only_affected_client_foreground(self) -> None:
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
                write_client_document_open(
                    str(project),
                    str(first),
                    CLIENT_A,
                    require_existing_sidecar=False,
                )
                _before_a, client_a = write_client_document_open(
                    str(project), str(second), CLIENT_A
                )
                before_close, client_b = write_client_document_open(
                    str(project), str(first), CLIENT_B
                )
                self.assertEqual(client_a["path"], str(second))
                self.assertEqual(client_b["path"], str(first))
                removed, after = remove_sidecar_recent_file(
                    str(project),
                    str(second),
                )

                self.assertTrue(removed)
                self.assertEqual(after["revision"], before_close["revision"] + 1)
                self.assertEqual(
                    [entry["path"] for entry in after["recents"]],
                    [str(first)],
                )
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_A)["path"],
                    str(first),
                )
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_B)["path"],
                    str(first),
                )

                removed_again, unchanged = remove_sidecar_recent_file(
                    str(project),
                    str(second),
                )
                self.assertFalse(removed_again)
                self.assertEqual(unchanged["revision"], after["revision"])

    def test_client_foregrounds_are_independent_and_legacy_seed_is_one_time(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            first = project / "first.py"
            second = project / "second.py"
            first.write_text("first\n", encoding="utf-8")
            second.write_text("second\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                sidecar = project_sidecar.ProjectSidecar.load_or_create(str(project))
                sidecar.record_document_activity(str(first))
                sidecar.record_document_activity(str(second))
                sidecar.set_last_file(str(first))
                sidecar.save()

                seeded = read_client_foreground(str(project), CLIENT_A)
                self.assertEqual(seeded["path"], str(first))
                self.assertTrue(seeded["seededFromLegacy"])

                fallback = read_client_foreground(str(project), CLIENT_B)
                self.assertEqual(fallback["path"], str(second))
                self.assertFalse(fallback["seededFromLegacy"])

                _membership, moved = write_client_document_open(
                    str(project), str(second), CLIENT_A
                )
                self.assertEqual(moved["path"], str(second))
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_B)["path"],
                    str(second),
                )

    def test_client_foreground_projection_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            opened = project / "opened.py"
            opened.write_text("value = 1\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                write_sidecar_open_file(
                    str(project),
                    str(opened),
                    require_existing_sidecar=False,
                )
                for index in range(40):
                    client_id = f"client_{index:012d}"
                    write_client_document_open(
                        str(project),
                        str(opened),
                        client_id,
                    )
                sidecar = project_sidecar.ProjectSidecar.load_or_create(str(project))
                sidecar.reload()
                entries = sidecar.dump_raw().get("client_foregrounds")
                self.assertIsInstance(entries, dict)
                self.assertEqual(len(cast(dict[str, object], entries)), 32)

    def test_simultaneous_client_opens_preserve_shared_membership(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            first = project / "first.py"
            second = project / "second.rs"
            first.write_text("first\n", encoding="utf-8")
            second.write_text("second\n", encoding="utf-8")
            barrier = threading.Barrier(2)

            def open_for_client(path: Path, client_id: str) -> None:
                barrier.wait(timeout=5)
                write_client_document_open(
                    str(project),
                    str(path),
                    client_id,
                    require_existing_sidecar=False,
                )

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    futures = [
                        executor.submit(open_for_client, first, CLIENT_A),
                        executor.submit(open_for_client, second, CLIENT_B),
                    ]
                    for future in futures:
                        future.result(timeout=10)

                state = read_sidecar_open_state(str(project), reason="reconnect")
                self.assertEqual(
                    {entry["path"] for entry in state["recents"]},
                    {str(first), str(second)},
                )
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_A)["path"],
                    str(first),
                )
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_B)["path"],
                    str(second),
                )
                self.assertEqual(state["revision"], 2)

    def test_full_restart_restores_each_stable_client_without_global_foreground(self) -> None:
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
                write_client_document_open(
                    str(project),
                    str(first),
                    CLIENT_A,
                    require_existing_sidecar=False,
                )
                write_client_document_open(str(project), str(second), CLIENT_B)

                project_sidecar.ProjectSidecar._instances.clear()

                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_A)["path"],
                    str(first),
                )
                self.assertEqual(
                    read_client_foreground(str(project), CLIENT_B)["path"],
                    str(second),
                )
                restarted = project_sidecar.ProjectSidecar.load_or_create(str(project))
                self.assertIsNone(restarted.get_last_file())

    def test_project_switch_keeps_each_projects_client_foreground_independent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project_a = root / "project-a"
            project_b = root / "project-b"
            sidecars = root / "sidecars"
            project_a.mkdir()
            project_b.mkdir()
            file_a = project_a / "a.py"
            file_b = project_b / "b.py"
            file_a.write_text("a\n", encoding="utf-8")
            file_b.write_text("b\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                write_client_document_open(
                    str(project_a),
                    str(file_a),
                    CLIENT_A,
                    require_existing_sidecar=False,
                )
                write_client_document_open(
                    str(project_b),
                    str(file_b),
                    CLIENT_A,
                    require_existing_sidecar=False,
                )

                project_sidecar.ProjectSidecar._instances.clear()

                self.assertEqual(
                    read_client_foreground(str(project_a), CLIENT_A)["path"],
                    str(file_a),
                )
                self.assertEqual(
                    read_client_foreground(str(project_b), CLIENT_A)["path"],
                    str(file_b),
                )

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

    def test_file_tabs_projection_does_not_reload_shared_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            project = root / "project"
            sidecars = root / "sidecars"
            project.mkdir()
            opened = project / "opened.py"
            opened.write_text("value = 1\n", encoding="utf-8")

            with patch.object(project_sidecar, "_sidecar_root", return_value=sidecars):
                write_sidecar_open_file(
                    str(project),
                    str(opened),
                    require_existing_sidecar=False,
                )
                shared = project_sidecar.ProjectSidecar.load_or_create(str(project))

                with patch.object(
                    shared,
                    "reload",
                    side_effect=AssertionError("threaded projection reloaded shared sidecar"),
                ):
                    projection = asyncio.run(build_file_tabs_projection(str(project)))

                items = cast(list[dict[str, object]], projection["items"])
                self.assertEqual(
                    [item["path"] for item in items],
                    [str(opened)],
                )


if __name__ == "__main__":
    unittest.main()
