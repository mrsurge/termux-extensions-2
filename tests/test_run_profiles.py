# pyright: basic
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from typing import cast, override
from unittest.mock import AsyncMock, patch

from app.apps.file_editor_cm6 import runner_profiles
from app.apps.file_editor_cm6.monaco_editor.editor_backend_services import save_service
from app.apps.file_editor_cm6.host import terminal_actions_backend
from app.apps.file_editor_cm6.host import runner_profiles_backend


class _FakeHistoryStore:
    _drafts: list[dict[str, object]]
    _opened: list[dict[str, object]]

    def __init__(
        self,
        *,
        drafts: list[dict[str, object]],
        opened: list[dict[str, object]],
    ) -> None:
        self._drafts = drafts
        self._opened = opened

    def list_project_drafts(self, project_path: str) -> list[dict[str, object]]:
        del project_path
        return list(self._drafts)

    def list_files(self, project_path: str) -> list[dict[str, object]]:
        del project_path
        return list(self._opened)


class RunProfileContractTests(unittest.TestCase):
    def test_legacy_profile_defaults_to_included_with_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = runner_profiles.parse_run_profiles_config(
                {
                    "version": 1,
                    "profiles": [
                        {
                            "profileId": "python",
                            "runner": "python",
                            "include": ["src/**"],
                            "exec": "src/main.py",
                        }
                    ],
                }
            )
            profile = runner_profiles._profiles_from_config(config)[0]

            self.assertEqual(profile.save_drafts, "included")
            self.assertTrue(profile.show_save_warning)
            self.assertTrue(
                runner_profiles.run_profile_matches_path(
                    profile,
                    "src/package/main.py",
                    project_root=root,
                )
            )

    def test_warning_accepts_boolean_and_numeric_values(self) -> None:
        base_profile = {
            "profileId": "custom",
            "runner": "custom",
            "include": ["*"],
            "exec": "echo",
        }
        for value, expected in [(True, True), (False, False), (1, True), (0, False)]:
            with self.subTest(value=value):
                profile = runner_profiles._profile_from_json(
                    {**base_profile, "showSaveWarning": value},
                    index=0,
                )
                self.assertEqual(profile.show_save_warning, expected)

    def test_invalid_save_mode_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown saveDrafts"):
            _ = runner_profiles._profile_from_json(
                {
                    "profileId": "custom",
                    "runner": "custom",
                    "include": ["*"],
                    "exec": "echo",
                    "saveDrafts": "sometimes",
                },
                index=0,
            )

    def test_warning_preferences_persist_for_profile_and_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = runner_profiles.run_profiles_config_path(root)
            config_path.parent.mkdir(parents=True)
            _ = config_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "profiles": [
                            {
                                "profileId": "custom",
                                "runner": "custom",
                                "include": ["*"],
                                "exec": "echo",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            _ = runner_profiles.set_run_save_warning(
                root,
                profile_id="custom",
                enabled=False,
            )
            _ = runner_profiles.set_run_save_warning(
                root,
                profile_id=None,
                enabled=False,
            )

            saved = runner_profiles.load_run_profiles_config(root)
            profiles = cast(list[object], saved["profiles"])
            profile = cast(dict[str, object], profiles[0])
            self.assertIs(profile["showSaveWarning"], False)
            self.assertFalse(runner_profiles.fallback_show_save_warning(root))


class RunDraftSelectionTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str]
    root: Path
    active: Path
    included: Path
    opened: Path
    other: Path
    profile: runner_profiles.RunProfile
    match: runner_profiles.RunProfileMatch

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name).resolve()
        self.active = self.root / "src" / "main.py"
        self.included = self.root / "src" / "helper.py"
        self.opened = self.root / "notes.md"
        self.other = self.root / "other.txt"
        for path in (self.active, self.included, self.opened, self.other):
            path.parent.mkdir(parents=True, exist_ok=True)
            _ = path.write_text(path.name, encoding="utf-8")
        self.profile = runner_profiles.RunProfile(
            profile_id="python",
            runner="python",
            entry="",
            include=("src/**",),
            sidebar_url="",
            running_behavior="just save",
            exec_command="src/main.py",
            cwd="",
            args=(),
            env={},
            save_drafts="included",
            show_save_warning=True,
        )
        self.match = runner_profiles.RunProfileMatch(
            profile=self.profile,
            project_root=self.root,
            active_file=self.active,
            relative_path="src/main.py",
        )

    @override
    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _select(self, mode: str) -> list[str]:
        history = _FakeHistoryStore(
            drafts=[
                {"file_path": str(self.active), "unsaved": True},
                {"file_path": str(self.included), "unsaved": True},
                {"file_path": str(self.opened), "unsaved": True},
                {"file_path": str(self.other), "unsaved": True},
            ],
            opened=[
                {"path": str(self.active)},
                {"path": str(self.opened)},
            ],
        )
        with patch.object(
            terminal_actions_backend,
            "get_history_store",
            return_value=history,
        ):
            return terminal_actions_backend._background_draft_paths(
                project_root=self.root,
                active_file=self.active,
                match=self.match,
                save_mode=mode,
            )

    def test_included_selects_matching_background_drafts(self) -> None:
        self.assertEqual(self._select("included"), ["src/helper.py"])

    def test_opened_selects_canonical_open_background_drafts(self) -> None:
        self.assertEqual(self._select("opened"), ["notes.md"])

    def test_all_selects_every_background_draft(self) -> None:
        self.assertEqual(
            self._select("all"),
            ["notes.md", "other.txt", "src/helper.py"],
        )

    def test_none_and_active_have_no_background_drafts(self) -> None:
        self.assertEqual(self._select("none"), [])
        self.assertEqual(self._select("active"), [])


class RunRequestTransactionTests(unittest.IsolatedAsyncioTestCase):
    async def test_warning_stops_before_save_and_launch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "main.py"
            _ = active.write_text("print('ok')\n", encoding="utf-8")
            profile = runner_profiles.RunProfile(
                profile_id="python",
                runner="python",
                entry="",
                include=("*.py",),
                sidebar_url="",
                running_behavior="just save",
                exec_command="main.py",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=True,
            )
            match = runner_profiles.RunProfileMatch(
                profile=profile,
                project_root=root,
                active_file=active,
                relative_path="main.py",
            )
            save = AsyncMock()
            launch = AsyncMock()
            with (
                patch.object(
                    runner_profiles_backend,
                    "resolve_runner_profile_run_request",
                    return_value=match,
                ),
                patch.object(
                    terminal_actions_backend,
                    "_save_before_play",
                    save,
                ),
                patch.object(
                    runner_profiles_backend,
                    "handle_runner_profile_run_request",
                    launch,
                ),
            ):
                result = await terminal_actions_backend._handle_host_run_active_file_request(
                    {"path": str(active)},
                    project_root=root,
                    source_name="test",
                )

            result_data = cast(dict[str, object], result["data"])
            self.assertEqual(result_data["action"], "confirmDraftSave")
            self.assertIsInstance(result_data["confirmationKey"], str)
            save.assert_not_awaited()
            launch.assert_not_awaited()

    async def test_confirmed_run_saves_before_profile_launch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "main.py"
            _ = active.write_text("print('ok')\n", encoding="utf-8")
            profile = runner_profiles.RunProfile(
                profile_id="python",
                runner="python",
                entry="",
                include=("*.py",),
                sidebar_url="",
                running_behavior="just save",
                exec_command="main.py",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=True,
            )
            match = runner_profiles.RunProfileMatch(
                profile=profile,
                project_root=root,
                active_file=active,
                relative_path="main.py",
            )
            save = AsyncMock(return_value=None)
            launch = AsyncMock(
                return_value={"ok": True, "data": {"action": "runProfile"}}
            )
            confirmation_key = terminal_actions_backend._draft_save_confirmation_key(
                active_file=active,
                match=match,
                save_mode=profile.save_drafts,
            )
            with (
                patch.object(
                    runner_profiles_backend,
                    "resolve_runner_profile_run_request",
                    return_value=replace(match),
                ),
                patch.object(
                    terminal_actions_backend,
                    "_save_before_play",
                    save,
                ),
                patch.object(
                    runner_profiles_backend,
                    "handle_runner_profile_run_request",
                    launch,
                ),
            ):
                result = await terminal_actions_backend._handle_host_run_active_file_request(
                    {
                        "path": str(active),
                        "confirmDraftSave": True,
                        "draftSaveConfirmationKey": confirmation_key,
                    },
                    project_root=root,
                    source_name="test",
                )

            self.assertTrue(result["ok"])
            save.assert_awaited_once()
            launch.assert_awaited_once_with(match, source_name="test")

    async def test_stale_confirmation_does_not_save_or_launch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "main.py"
            _ = active.write_text("print('ok')\n", encoding="utf-8")
            profile = runner_profiles.RunProfile(
                profile_id="python",
                runner="python",
                entry="",
                include=("*.py",),
                sidebar_url="",
                running_behavior="just save",
                exec_command="main.py",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=True,
            )
            match = runner_profiles.RunProfileMatch(
                profile=profile,
                project_root=root,
                active_file=active,
                relative_path="main.py",
            )
            save = AsyncMock()
            launch = AsyncMock()
            with (
                patch.object(
                    runner_profiles_backend,
                    "resolve_runner_profile_run_request",
                    return_value=match,
                ),
                patch.object(
                    terminal_actions_backend,
                    "_save_before_play",
                    save,
                ),
                patch.object(
                    runner_profiles_backend,
                    "handle_runner_profile_run_request",
                    launch,
                ),
            ):
                result = await terminal_actions_backend._handle_host_run_active_file_request(
                    {
                        "path": str(active),
                        "confirmDraftSave": True,
                        "draftSaveConfirmationKey": "stale",
                    },
                    project_root=root,
                    source_name="test",
                )

            result_data = cast(dict[str, object], result["data"])
            self.assertEqual(result_data["action"], "confirmDraftSave")
            save.assert_not_awaited()
            launch.assert_not_awaited()

    async def test_expected_active_path_rejects_mismatched_editor_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            expected = root / "expected.py"
            current = root / "current.py"
            _ = expected.write_text("expected\n", encoding="utf-8")
            _ = current.write_text("current\n", encoding="utf-8")
            write = AsyncMock()

            async def request_snapshot(request_id: str) -> dict[str, object]:
                del request_id
                return {
                    "path": str(current),
                    "content": "changed current\n",
                }

            async def emit_to_room(event: str, payload: dict[str, object]) -> None:
                del event, payload

            with patch.object(asyncio, "to_thread", write):
                result = await save_service.handle_editor_save_request(
                    "test",
                    {
                        "path": str(expected),
                        "expected_path": str(expected),
                    },
                    active_project=lambda: str(root),
                    normalize_abs_path=lambda value: (
                        str(Path(value).resolve(strict=False)) if value else None
                    ),
                    is_under_project=lambda project, path: path.startswith(project),
                    request_snapshot=request_snapshot,
                    emit_to_room=emit_to_room,
                    notify_draft_state_changed=lambda project: None,
                    record_save_sha=lambda path, sha: None,
                )

            self.assertFalse(result["ok"])
            self.assertEqual(result["error"], "active_file_changed")
            write.assert_not_awaited()


if __name__ == "__main__":
    _ = unittest.main()
