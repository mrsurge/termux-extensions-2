# pyright: basic
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import AsyncMock, patch

from app.apps.file_editor_cm6 import runner_profiles
from app.apps.file_editor_cm6 import (
    run_profile_events,
    run_profile_state,
    run_profile_surfaces,
)
from app.apps.file_editor_cm6.monaco_editor.editor_backend_services import save_service
from app.apps.file_editor_cm6.host import terminal_actions_backend
from app.apps.file_editor_cm6.host import runner_profiles_backend
from app.apps.file_editor_cm6.host import run_profiles_config_backend
from app.apps.file_editor_cm6.host import run_target_service
from app.apps.file_editor_cm6.ui_ipc import sidebar_window_state
from app.apps.file_editor_cm6.worker_services import run_profile_fws_bridge


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
            self.assertFalse(profile.dev_tools)
            self.assertEqual(profile.additional_ports, ())
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

    def test_profile_ids_are_unique(self) -> None:
        duplicate = {
            "profileId": "backend",
            "runner": "custom",
            "include": ["src/**"],
            "exec": "server.py",
        }
        with self.assertRaisesRegex(ValueError, "Duplicate run profile id"):
            _ = runner_profiles.parse_run_profiles_config(
                {"version": 1, "profiles": [duplicate, dict(duplicate)]}
            )

    def test_candidates_preserve_all_owners_and_explicit_non_owner(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "src" / "main.py"
            active.parent.mkdir(parents=True)
            _ = active.write_text("print('ok')\n", encoding="utf-8")
            _ = runner_profiles.save_run_profiles_config(
                root,
                json.dumps(
                    {
                        "version": 1,
                        "profiles": [
                            {
                                "profileId": "backend-a",
                                "runner": "custom",
                                "include": ["src/**"],
                                "exec": "server_a.py",
                            },
                            {
                                "profileId": "backend-b",
                                "runner": "custom",
                                "include": ["src/*.py"],
                                "exec": "server_b.py",
                            },
                            {
                                "profileId": "test-backend",
                                "runner": "custom",
                                "include": ["tests/**"],
                                "exec": "test_server.py",
                            },
                        ],
                    }
                ),
            )

            owners = runner_profiles.list_run_profile_candidates(root, active)
            selected = runner_profiles.resolve_run_profile_by_id(
                root,
                active,
                "test-backend",
            )

        self.assertEqual(
            [match.profile.profile_id for match in owners],
            ["backend-a", "backend-b"],
        )
        self.assertEqual(selected.profile.profile_id, "test-backend")
        self.assertEqual(selected.relative_path, "src/main.py")

    def test_dev_tools_is_an_explicit_opt_in(self) -> None:
        base_profile = {
            "profileId": "preview",
            "runner": "pagePreview",
            "entry": "index.html",
        }
        disabled = runner_profiles._profile_from_json(base_profile, index=0)
        enabled = runner_profiles._profile_from_json(
            {**base_profile, "devTools": True},
            index=0,
        )

        self.assertFalse(disabled.dev_tools)
        self.assertTrue(enabled.dev_tools)

    def test_dev_tools_rejects_non_boolean_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "devTools must be true"):
            _ = runner_profiles._profile_from_json(
                {
                    "profileId": "preview",
                    "runner": "pagePreview",
                    "entry": "index.html",
                    "devTools": "yes",
                },
                index=0,
            )

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

    def test_non_preview_profile_accepts_matching_routed_sidebar_port(self) -> None:
        profile = runner_profiles._profile_from_json(
            {
                "profileId": "web",
                "runner": "custom",
                "include": ["src/**"],
                "exec": "npm run dev",
                "sidebarUrl": "http://127.0.0.1:4173/app",
                "port": 4173,
            },
            index=0,
        )

        self.assertEqual(profile.port, 4173)
        self.assertEqual(profile.sidebar_url, "http://127.0.0.1:4173/app")

    def test_non_preview_profile_accepts_labeled_additional_ports(self) -> None:
        profile = runner_profiles._profile_from_json(
            {
                "profileId": "web",
                "runner": "custom",
                "include": ["src/**"],
                "exec": "npm run dev",
                "sidebarUrl": "http://127.0.0.1:4173/app",
                "port": 4173,
                "additionalPorts": [
                    {"port": 5173, "label": "Vite / HMR"},
                    {"port": 9229, "label": "Node inspector"},
                ],
            },
            index=0,
        )

        self.assertEqual(
            profile.additional_ports,
            (
                runner_profiles.RunProfileAdditionalPort(5173, "Vite / HMR"),
                runner_profiles.RunProfileAdditionalPort(9229, "Node inspector"),
            ),
        )

    def test_additional_ports_reject_missing_primary_duplicates_and_excess(self) -> None:
        base = {
            "profileId": "web",
            "runner": "custom",
            "include": ["src/**"],
            "exec": "npm run dev",
            "sidebarUrl": "http://127.0.0.1:4173/app",
        }
        with self.assertRaisesRegex(ValueError, "requires a primary port"):
            _ = runner_profiles._profile_from_json(
                {**base, "additionalPorts": [{"port": 5173, "label": "Vite"}]},
                index=0,
            )
        with self.assertRaisesRegex(ValueError, "duplicate port 4173"):
            _ = runner_profiles._profile_from_json(
                {
                    **base,
                    "port": 4173,
                    "additionalPorts": [{"port": 4173, "label": "Duplicate"}],
                },
                index=0,
            )
        with self.assertRaisesRegex(ValueError, "at most 8"):
            _ = runner_profiles._profile_from_json(
                {
                    **base,
                    "port": 4173,
                    "additionalPorts": [
                        {"port": 5100 + index, "label": f"Service {index}"}
                        for index in range(9)
                    ],
                },
                index=0,
            )

    def test_routed_port_rejects_unsafe_urls(self) -> None:
        for sidebar_url, message in [
            ("https://127.0.0.1:4173/", "must use http"),
            ("http://example.com:4173/", "must use loopback"),
            ("http://127.0.0.1:5173/", "must match port 4173"),
        ]:
            with self.subTest(sidebar_url=sidebar_url):
                with self.assertRaisesRegex(ValueError, message):
                    _ = runner_profiles._profile_from_json(
                        {
                            "profileId": "web",
                            "runner": "custom",
                            "include": ["src/**"],
                            "exec": "npm run dev",
                            "sidebarUrl": sidebar_url,
                            "port": 4173,
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
    async def test_overlapping_owners_return_selection_before_save_or_launch(
        self,
    ) -> None:
        conflict = runner_profiles.RunProfileConflictError(
            relative_path="main.py",
            profile_ids=["backend-a", "backend-b"],
        )
        selection = {
            "ok": True,
            "data": {
                "action": "selectRunProfile",
                "candidates": [
                    {"profileId": "backend-a"},
                    {"profileId": "backend-b"},
                ],
            },
        }
        save = AsyncMock()
        launch = AsyncMock()
        build_selection = AsyncMock(return_value=selection)
        with (
            patch.object(
                runner_profiles_backend,
                "resolve_runner_profile_run_request",
                side_effect=conflict,
            ),
            patch.object(
                runner_profiles_backend,
                "build_run_profile_selection_response",
                build_selection,
            ),
            patch.object(terminal_actions_backend, "_save_before_play", save),
            patch.object(
                runner_profiles_backend,
                "handle_runner_profile_run_request",
                launch,
            ),
        ):
            result = await terminal_actions_backend._handle_host_run_active_file_request(
                {"path": "/project/main.py"},
                project_root=Path("/project"),
                source_name="test",
            )

        self.assertEqual(result, selection)
        build_selection.assert_awaited_once_with({"path": "/project/main.py"})
        save.assert_not_awaited()
        launch.assert_not_awaited()

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

    async def test_active_context_is_revalidated_after_save_before_launch(self) -> None:
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
                show_save_warning=False,
            )
            match = runner_profiles.RunProfileMatch(
                profile=profile,
                project_root=root,
                active_file=active,
                relative_path="main.py",
            )
            save = AsyncMock(return_value=None)
            launch = AsyncMock()
            with (
                patch.object(
                    runner_profiles_backend,
                    "resolve_runner_profile_run_request",
                    return_value=match,
                ),
                patch.object(terminal_actions_backend, "_save_before_play", save),
                patch.object(
                    terminal_actions_backend,
                    "_run_context_is_current",
                    side_effect=[True, False],
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
                    enforce_current_context=True,
                )

        self.assertFalse(result["ok"])
        self.assertTrue(cast(dict[str, object], result["data"])["staleRunIntent"])
        save.assert_awaited_once()
        launch.assert_not_awaited()

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


class RunProfileSidebarDevToolsTests(unittest.IsolatedAsyncioTestCase):
    async def test_sidebar_url_projects_stable_native_target_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            profile = runner_profiles.RunProfile(
                profile_id="preview",
                runner="pagePreview",
                entry="index.html",
                include=("index.html",),
                sidebar_url="http://127.0.0.1:3000/",
                running_behavior="just save",
                exec_command="",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=False,
                dev_tools=True,
            )
            create = AsyncMock(return_value={"ok": True})
            with patch.object(
                run_profile_surfaces,
                "handle_ui_sidebar_window_create_request",
                create,
            ):
                result = await run_profile_surfaces.open_run_profile_surface(
                    project_root=root,
                    profile=profile,
                    shell_id="shell-preview",
                    shell_label="page-preview:test:preview",
                    url="http://127.0.0.1:3000/",
                    title="Page Preview",
                    label="Page Preview",
                    source_name="test",
                )

            self.assertTrue(result["ok"])
            payload = cast(dict[str, object], create.await_args.args[0])
            expected_id = runner_profiles_backend._devtools_target_id(root, "preview")
            self.assertIs(payload["devTools"], True)
            self.assertEqual(payload["devToolsTargetId"], expected_id)
            self.assertEqual(payload["devToolsTargetLabel"], "Page Preview")
            slot = sidebar_window_state._normalize_url_slot(payload)
            surface = cast(dict[str, object], slot["runProfileSurface"])
            self.assertEqual(surface["profileId"], "preview")
            self.assertEqual(surface["shellId"], "shell-preview")
            self.assertTrue(surface["devRuntime"])
            self.assertEqual(
                expected_id,
                runner_profiles_backend._devtools_target_id(root, "preview"),
            )

    def test_target_id_is_project_scoped(self) -> None:
        first = runner_profiles_backend._devtools_target_id(
            Path("/project/one"),
            "preview",
        )
        second = runner_profiles_backend._devtools_target_id(
            Path("/project/two"),
            "preview",
        )

        self.assertNotEqual(first, second)

    def test_disabled_projection_clears_previous_target_metadata(self) -> None:
        enabled = sidebar_window_state._normalize_url_slot(
            {
                "kind": "url",
                "host_id": "runner-profile:preview",
                "url": "http://127.0.0.1:3000/",
                "devTools": True,
                "devToolsTargetId": "run-profile:abc:preview",
            }
        )
        disabled = sidebar_window_state._normalize_url_slot(
            {
                "kind": "url",
                "host_id": "runner-profile:preview",
                "url": "http://127.0.0.1:3000/",
                "devTools": False,
            }
        )
        merged = sidebar_window_state._upsert_slot(
            {
                "slots": {"runner-profile:preview": enabled},
            },
            disabled,
        )
        slot = cast(
            dict[str, object],
            cast(dict[str, object], merged["slots"])["runner-profile:preview"],
        )

        self.assertIs(slot["devTools"], False)
        self.assertNotIn("devToolsTargetId", slot)

    async def test_sidebar_url_projects_run_target_route(self) -> None:
        ticket = "a" * 64
        route = {
            "dto": "RunTargetRoute",
            "version": 1,
            "ticket": ticket,
            "tunnelPath": f"/api/run-targets/{ticket}/tunnel",
            "preferredPort": 4173,
            "originalUrl": "http://127.0.0.1:4173/app",
            "expiresAt": 999,
        }
        profile = runner_profiles.RunProfile(
            profile_id="web",
            runner="custom",
            entry="",
            include=("src/**",),
            sidebar_url="http://127.0.0.1:4173/app",
            running_behavior="just save",
            exec_command="npm run dev",
            cwd="",
            args=(),
            env={},
            save_drafts="included",
            show_save_warning=False,
            port=4173,
        )
        create = AsyncMock(return_value={"ok": True})
        with patch.object(
            run_profile_surfaces,
            "handle_ui_sidebar_window_create_request",
            create,
        ):
            result = await run_profile_surfaces.open_run_profile_surface(
                project_root=Path("/project"),
                profile=profile,
                shell_id="shell-web",
                shell_label="runner-profile:test:web",
                url="http://127.0.0.1:4173/app",
                title="Run web",
                label="Run web",
                source_name="test",
                run_target_route=route,
            )

        self.assertTrue(result["ok"])
        payload = cast(dict[str, object], create.await_args.args[0])
        self.assertEqual(payload["runTargetRoute"], route)
        slot = sidebar_window_state._normalize_url_slot(payload)
        self.assertEqual(slot["runTargetRoute"], route)

    async def test_sidebar_url_projects_labeled_run_target_route_set(self) -> None:
        primary_ticket = "a" * 64
        auxiliary_ticket = "b" * 64
        route_set = {
            "dto": "RunTargetRouteSet",
            "version": 1,
            "ownerId": "runner-profile:test:web",
            "shellId": "shell-web",
            "relayGroupId": primary_ticket,
            "primary": {
                "dto": "RunTargetRoute",
                "version": 1,
                "ticket": primary_ticket,
                "tunnelPath": f"/api/run-targets/{primary_ticket}/tunnel",
                "preferredPort": 4173,
                "originalUrl": "http://127.0.0.1:4173/app",
                "expiresAt": 999,
            },
            "additional": [
                {
                    "dto": "RunTargetRoute",
                    "version": 1,
                    "ticket": auxiliary_ticket,
                    "tunnelPath": f"/api/run-targets/{auxiliary_ticket}/tunnel",
                    "preferredPort": 5173,
                    "originalUrl": "http://127.0.0.1:5173/",
                    "expiresAt": 999,
                    "label": "Vite / HMR",
                }
            ],
        }
        slot = sidebar_window_state._normalize_url_slot(
            {
                "kind": "url",
                "host_id": "runner-profile:web",
                "url": "http://127.0.0.1:4173/app",
                "runTargetRoute": route_set,
            }
        )

        self.assertEqual(slot["runTargetRoute"], route_set)


class RunTargetServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_route_set_registration_validates_and_groups_rust_routes(self) -> None:
        primary_ticket = "a" * 64
        auxiliary_ticket = "b" * 64
        rust_result = {
            "dto": "RunTargetRouteSet",
            "version": 1,
            "ownerId": "runner-profile:test:web",
            "shellId": "shell-web",
            "relayGroupId": primary_ticket,
            "primary": {
                "dto": "RunTargetRoute",
                "version": 1,
                "ticket": primary_ticket,
                "tunnelPath": f"/api/run-targets/{primary_ticket}/tunnel",
                "preferredPort": 4173,
                "originalUrl": "http://127.0.0.1:4173/app",
                "expiresAt": 999,
            },
            "additional": [
                {
                    "dto": "RunTargetRoute",
                    "version": 1,
                    "ticket": auxiliary_ticket,
                    "tunnelPath": f"/api/run-targets/{auxiliary_ticket}/tunnel",
                    "preferredPort": 5173,
                    "originalUrl": "http://127.0.0.1:5173/",
                    "expiresAt": 999,
                    "label": "Vite / HMR",
                }
            ],
        }
        call = AsyncMock(return_value=rust_result)
        with (
            patch.object(run_target_service, "call_async", call),
            patch.object(
                run_target_service,
                "_publish_run_target_routes_best_effort",
                AsyncMock(),
            ),
        ):
            result = await run_target_service.register_run_target_routes(
                owner_id="runner-profile:test:web",
                shell_id="shell-web",
                primary_port=4173,
                primary_url="http://127.0.0.1:4173/app",
                additional_ports=(
                    runner_profiles.RunProfileAdditionalPort(5173, "Vite / HMR"),
                ),
            )

        self.assertEqual(result["dto"], "RunTargetRouteSet")
        self.assertEqual(result["ownerId"], "runner-profile:test:web")
        self.assertEqual(result["shellId"], "shell-web")
        self.assertEqual(len(cast(str, result["relayGroupId"])), 64)
        call.assert_awaited_once()
        self.assertEqual(call.await_args.args[0], "runTarget.routes.register")

    async def test_route_projection_preserves_exact_shell_generation(self) -> None:
        primary_ticket = "a" * 64
        rust_projection = {
            "dto": "RunTargetRouteProjection",
            "version": 1,
            "groups": [
                {
                    "dto": "RunTargetRouteSet",
                    "version": 1,
                    "ownerId": "runner-profile:test:web",
                    "shellId": "shell-web",
                    "relayGroupId": primary_ticket,
                    "primary": {
                        "dto": "RunTargetRoute",
                        "version": 1,
                        "ticket": primary_ticket,
                        "tunnelPath": f"/api/run-targets/{primary_ticket}/tunnel",
                        "preferredPort": 4173,
                        "originalUrl": "http://127.0.0.1:4173/app",
                        "expiresAt": 999,
                    },
                    "additional": [],
                }
            ],
        }
        with patch.object(
            run_target_service,
            "call_async",
            AsyncMock(return_value=rust_projection),
        ):
            projection = await run_target_service.list_run_target_routes()

        groups = cast(list[dict[str, object]], projection["groups"])
        self.assertEqual(groups[0]["ownerId"], "runner-profile:test:web")
        self.assertEqual(groups[0]["shellId"], "shell-web")
        self.assertEqual(groups[0]["relayGroupId"], primary_ticket)

    async def test_release_publishes_the_authoritative_route_projection(self) -> None:
        projection = {
            "dto": "RunTargetRouteProjection",
            "version": 1,
            "groups": [],
        }
        call = AsyncMock(side_effect=[{"released": True}, projection])
        emitter = AsyncMock()
        with (
            patch.object(run_target_service, "call_async", call),
            patch.object(run_target_service, "_run_target_routes_emitter", emitter),
        ):
            released = await run_target_service.release_run_target_route(
                owner_id="runner-profile:test:web",
                shell_id="shell-web",
            )

        self.assertTrue(released)
        self.assertEqual(
            [awaited.args[0] for awaited in call.await_args_list],
            ["runTarget.route.release", "runTarget.routes.list"],
        )
        emitter.assert_awaited_once_with(projection)


class RunProfileProcessStateTests(unittest.IsolatedAsyncioTestCase):
    def _match(self, root: Path) -> runner_profiles.RunProfileMatch:
        active = root / "src" / "main.ts"
        active.parent.mkdir(parents=True, exist_ok=True)
        _ = active.write_text("console.log('ok')\n", encoding="utf-8")
        profile = runner_profiles.RunProfile(
            profile_id="web",
            runner="custom",
            entry="",
            include=("src/**",),
            sidebar_url="http://127.0.0.1:4173/app",
            running_behavior="just save",
            exec_command="npm run dev",
            cwd="",
            args=(),
            env={},
            save_drafts="included",
            show_save_warning=False,
            port=4173,
            additional_ports=(
                runner_profiles.RunProfileAdditionalPort(5173, "Vite / HMR"),
            ),
        )
        return runner_profiles.RunProfileMatch(
            profile=profile,
            project_root=root,
            active_file=active,
            relative_path="src/main.ts",
        )

    async def test_launch_registers_exact_shell_and_projects_ticket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            match = self._match(Path(temp_dir).resolve())
            shell = SimpleNamespace(
                shell_id="shell-4173",
                label="runner-profile:file_editor_cm6:project:web",
                reused=False,
                command_preview="npm run dev",
            )
            ticket = "b" * 64
            auxiliary_ticket = "c" * 64
            route = {
                "dto": "RunTargetRouteSet",
                "version": 1,
                "ownerId": shell.label,
                "shellId": shell.shell_id,
                "relayGroupId": ticket,
                "primary": {
                    "dto": "RunTargetRoute",
                    "version": 1,
                    "ticket": ticket,
                    "tunnelPath": f"/api/run-targets/{ticket}/tunnel",
                    "preferredPort": 4173,
                    "originalUrl": "http://127.0.0.1:4173/app",
                    "expiresAt": 999,
                },
                "additional": [
                    {
                        "dto": "RunTargetRoute",
                        "version": 1,
                        "ticket": auxiliary_ticket,
                        "tunnelPath": f"/api/run-targets/{auxiliary_ticket}/tunnel",
                        "preferredPort": 5173,
                        "originalUrl": "http://127.0.0.1:5173/",
                        "expiresAt": 999,
                        "label": "Vite / HMR",
                    }
                ],
            }
            ensure = AsyncMock(return_value=shell)
            register = AsyncMock(return_value=route)
            open_sidebar = AsyncMock(return_value={"ok": True})
            wait_ready = AsyncMock()
            with (
                patch.object(
                    runner_profiles_backend,
                    "ensure_runner_profile_shell",
                    ensure,
                ),
                patch.object(
                    runner_profiles_backend,
                    "register_run_target_routes",
                    register,
                ),
                patch.object(
                    runner_profiles_backend,
                    "open_run_profile_surface",
                    open_sidebar,
                ),
                patch.object(
                    runner_profiles_backend,
                    "wait_for_run_profile_url",
                    wait_ready,
                ),
                patch.object(
                    runner_profiles_backend,
                    "_publish_run_profile_state_best_effort",
                    AsyncMock(return_value={}),
                ),
            ):
                result = await runner_profiles_backend.handle_runner_profile_run_request(
                    match,
                    source_name="test",
                )

            self.assertTrue(result["ok"])
            register.assert_awaited_once_with(
                owner_id=shell.label,
                shell_id=shell.shell_id,
                primary_port=4173,
                primary_url=match.profile.sidebar_url,
                additional_ports=match.profile.additional_ports,
            )
            projected = cast(
                dict[str, object], open_sidebar.await_args.kwargs["run_target_route"]
            )
            projected_primary = cast(dict[str, object], projected["primary"])
            self.assertEqual(projected_primary["ticket"], ticket)
            self.assertEqual(projected_primary["originalUrl"], match.profile.sidebar_url)
            projected_additional = cast(list[dict[str, object]], projected["additional"])
            self.assertEqual(projected_additional[0]["ticket"], auxiliary_ticket)
            self.assertEqual(
                projected_additional[0]["originalUrl"],
                "http://127.0.0.1:5173/",
            )

    async def test_page_preview_registers_primary_and_hmr_routes_after_readiness(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "index.html"
            _ = active.write_text("<main></main>\n", encoding="utf-8")
            profile = runner_profiles.RunProfile(
                profile_id="preview",
                runner="pagePreview",
                entry="index.html",
                include=("index.html",),
                sidebar_url="http://127.0.0.1:3000/",
                running_behavior="just save",
                exec_command="",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=False,
            )
            match = runner_profiles.RunProfileMatch(
                profile=profile,
                project_root=root,
                active_file=active,
                relative_path="index.html",
            )
            shell = SimpleNamespace(
                shell_id="shell-preview",
                label="page-preview:test:preview",
                url="http://127.0.0.1:3000/",
                reused=False,
            )
            route = {
                "dto": "RunTargetRouteSet",
                "version": 1,
                "ownerId": shell.label,
                "shellId": shell.shell_id,
                "relayGroupId": "d" * 64,
                "primary": {
                    "preferredPort": 3000,
                    "originalUrl": "http://127.0.0.1:3000/",
                },
                "additional": [{
                    "preferredPort": 24678,
                    "originalUrl": "http://127.0.0.1:24678/",
                    "label": "Vite / HMR",
                }],
            }
            register = AsyncMock(return_value=route)
            wait_ready = AsyncMock()
            open_surface = AsyncMock(return_value={"ok": True})
            with (
                patch.object(
                    runner_profiles_backend,
                    "ensure_page_preview_shell",
                    AsyncMock(return_value=shell),
                ),
                patch.object(
                    runner_profiles_backend,
                    "register_run_target_routes",
                    register,
                ),
                patch.object(
                    runner_profiles_backend,
                    "wait_for_run_profile_url",
                    wait_ready,
                ),
                patch.object(
                    runner_profiles_backend,
                    "open_run_profile_surface",
                    open_surface,
                ),
                patch.object(
                    runner_profiles_backend,
                    "_publish_run_profile_state_best_effort",
                    AsyncMock(return_value={}),
                ),
            ):
                result = await runner_profiles_backend.handle_runner_profile_run_request(
                    match,
                    source_name="test",
                )

            self.assertTrue(result["ok"])
            register.assert_awaited_once_with(
                owner_id=shell.label,
                shell_id=shell.shell_id,
                primary_port=3000,
                primary_url="http://127.0.0.1:3000/",
                additional_ports=(
                    runner_profiles.RunProfileAdditionalPort(24678, "Vite / HMR"),
                ),
            )
            wait_ready.assert_awaited_once_with(
                project_root=root,
                profile_id="preview",
                shell_id="shell-preview",
                url="http://127.0.0.1:3000/",
            )
            projected = cast(
                dict[str, object], open_surface.await_args.kwargs["run_target_route"]
            )
            self.assertEqual(
                cast(dict[str, object], projected["primary"])["originalUrl"],
                "http://127.0.0.1:3000/",
            )
            self.assertEqual(
                cast(list[dict[str, object]], projected["additional"])[0][
                    "originalUrl"
                ],
                "http://127.0.0.1:24678/",
            )

    async def test_stop_terminates_exact_profile_and_releases_route(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            match = self._match(Path(temp_dir).resolve())
            stopped = SimpleNamespace(
                shell_id="shell-4173",
                label="runner-profile:file_editor_cm6:project:web",
                running=False,
            )
            stop = AsyncMock(return_value=stopped)
            release = AsyncMock(return_value=True)
            with (
                patch.object(
                    runner_profiles_backend,
                    "run_profile_request_context",
                    return_value=(str(match.project_root), str(match.active_file)),
                ),
                patch.object(
                    runner_profiles_backend,
                    "resolve_runner_profile_run_request",
                    return_value=match,
                ),
                patch.object(
                    runner_profiles_backend,
                    "runner_profile_shell_state",
                    AsyncMock(return_value=stopped),
                ),
                patch.object(
                    runner_profiles_backend,
                    "stop_runner_profile_shell",
                    stop,
                ),
                patch.object(
                    runner_profiles_backend,
                    "release_run_target_route",
                    release,
                ),
                patch.object(
                    runner_profiles_backend,
                    "close_run_profile_surface",
                    AsyncMock(return_value=True),
                ),
                patch.object(
                    runner_profiles_backend,
                    "_publish_run_profile_state_best_effort",
                    AsyncMock(return_value={"runningProfiles": []}),
                ),
            ):
                result = await runner_profiles_backend.handle_run_profile_stop_request(
                    {"path": str(match.active_file)},
                    source_name="test",
                )

            self.assertTrue(result["ok"])
            stop.assert_awaited_once_with(
                project_root=str(match.project_root),
                profile_id="web",
            )
            release.assert_awaited_once_with(
                owner_id=stopped.label,
                shell_id=stopped.shell_id,
            )
            self.assertEqual(
                cast(dict[str, object], result["data"])["runningProfiles"],
                [],
            )


class RunProfileProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_state_projection_uses_existing_shell_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            match = RunProfileProcessStateTests()._match(root)
            shell_state = SimpleNamespace(
                shell_id="shell-4173",
                label="runner-profile:file_editor_cm6:project:web",
                running=True,
            )
            with (
                patch.object(
                    run_profile_state,
                    "run_profile_request_context",
                    return_value=(str(root), str(match.active_file)),
                ),
                patch.object(
                    run_profile_state,
                    "list_run_profile_candidates",
                    return_value=[match],
                ),
                patch.object(
                    run_profile_state,
                    "load_run_profiles",
                    return_value=[match.profile],
                ),
                patch.object(
                    run_profile_state,
                    "runner_profile_shell_state",
                    AsyncMock(return_value=shell_state),
                ),
            ):
                projection = await run_profile_state.build_run_profile_state_projection()

        self.assertEqual(projection["projectPath"], str(root))
        self.assertEqual(projection["path"], str(match.active_file))
        self.assertTrue(projection["matched"])
        self.assertTrue(projection["running"])
        self.assertEqual(projection["shellId"], "shell-4173")
        candidates = cast(list[dict[str, object]], projection["candidates"])
        self.assertEqual(candidates[0]["profileId"], "web")
        self.assertTrue(candidates[0]["ownsActiveFile"])

    async def test_state_projection_keeps_multiple_running_owners_explicit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            active = root / "main.py"
            _ = active.write_text("print('ok')\n", encoding="utf-8")
            base = runner_profiles.RunProfile(
                profile_id="backend-a",
                runner="custom",
                entry="",
                include=("*.py",),
                sidebar_url="",
                running_behavior="just save",
                exec_command="server.py",
                cwd="",
                args=(),
                env={},
                save_drafts="included",
                show_save_warning=False,
            )
            matches = [
                runner_profiles.RunProfileMatch(
                    profile=profile,
                    project_root=root,
                    active_file=active,
                    relative_path="main.py",
                )
                for profile in (base, replace(base, profile_id="backend-b"))
            ]

            def shell_state(*, project_root: str, profile_id: str) -> object:
                del project_root
                return SimpleNamespace(
                    shell_id=f"shell-{profile_id}",
                    label=f"runner:{profile_id}",
                    running=True,
                )

            with (
                patch.object(
                    run_profile_state,
                    "run_profile_request_context",
                    return_value=(str(root), str(active)),
                ),
                patch.object(
                    run_profile_state,
                    "list_run_profile_candidates",
                    return_value=matches,
                ),
                patch.object(
                    run_profile_state,
                    "load_run_profiles",
                    return_value=[match.profile for match in matches],
                ),
                patch.object(
                    run_profile_state,
                    "runner_profile_shell_state",
                    AsyncMock(side_effect=shell_state),
                ),
            ):
                projection = await run_profile_state.build_run_profile_state_projection()

        self.assertTrue(projection["matched"])
        self.assertTrue(projection["running"])
        self.assertTrue(projection["selectionRequired"])
        self.assertEqual(projection["profileId"], "")
        candidates = cast(list[dict[str, object]], projection["candidates"])
        self.assertEqual(
            [candidate["profileId"] for candidate in candidates],
            ["backend-a", "backend-b"],
        )

    async def test_state_projection_keeps_global_running_profiles_without_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            profile = RunProfileProcessStateTests()._match(root).profile
            shell_state = SimpleNamespace(
                shell_id="shell-web",
                label="runner:web",
                running=True,
            )
            with (
                patch.object(
                    run_profile_state,
                    "run_profile_request_context",
                    return_value=(str(root), None),
                ),
                patch.object(
                    run_profile_state,
                    "load_run_profiles",
                    return_value=[profile],
                ),
                patch.object(
                    run_profile_state,
                    "runner_profile_shell_state",
                    AsyncMock(return_value=shell_state),
                ),
            ):
                projection = await run_profile_state.build_run_profile_state_projection()

        self.assertEqual(projection["path"], "")
        self.assertFalse(projection["running"])
        running = cast(list[dict[str, object]], projection["runningProfiles"])
        self.assertEqual([item["profileId"] for item in running], ["web"])

    async def test_unchanged_event_projection_is_deduplicated(self) -> None:
        projection = {
            "projectPath": "/project",
            "path": "/project/main.py",
            "matched": True,
            "running": True,
            "profileId": "python",
            "runner": "python",
            "shellId": "shell-python",
            "label": "runner-profile:file_editor_cm6:project:python",
        }
        publish = AsyncMock()
        run_profile_events._last_projection_signature = None
        run_profile_events._projection_revision = 0
        with (
            patch.object(
                run_profile_events,
                "build_run_profile_state_projection",
                AsyncMock(side_effect=[dict(projection), dict(projection)]),
            ),
            patch.object(run_profile_events, "publish_worker_event", publish),
        ):
            _ = await run_profile_events.refresh_run_profile_state(source="first")
            _ = await run_profile_events.refresh_run_profile_state(source="second")

        publish.assert_awaited_once()

    async def test_fws_lifecycle_filters_to_run_profile_shells(self) -> None:
        refresh = AsyncMock()
        release = AsyncMock(return_value=True)
        close_surface = AsyncMock(return_value=1)
        run_profile_fws_bridge._relevant_shell_labels.clear()
        unrelated = {
            "method": "fws.shell.updated",
            "params": {"shell": {"id": "other", "label": "terminal:other"}},
        }
        relevant = {
            "method": "fws.shell.updated",
            "params": {
                "shell": {
                    "id": "run-shell",
                    "label": "runner-profile:file_editor_cm6:project:python",
                }
            },
        }
        removed = {
            "method": "fws.shell.removed",
            "params": {"shell_id": "run-shell"},
        }
        with (
            patch.object(run_profile_fws_bridge, "refresh_run_profile_state", refresh),
            patch.object(run_profile_fws_bridge, "release_run_target_route", release),
            patch.object(
                run_profile_fws_bridge,
                "close_run_profile_surface_for_shell",
                close_surface,
            ),
        ):
            await run_profile_fws_bridge._on_notification(unrelated)
            await run_profile_fws_bridge._on_notification(relevant)
            await run_profile_fws_bridge._on_notification(removed)

        self.assertEqual(refresh.await_count, 2)
        release.assert_awaited_once_with(
            owner_id="runner-profile:file_editor_cm6:project:python",
            shell_id="run-shell",
        )
        close_surface.assert_awaited_once_with(
            shell_id="run-shell",
            shell_label="runner-profile:file_editor_cm6:project:python",
            source="fws.shell.removed",
        )
        self.assertEqual(
            [call.kwargs["source"] for call in refresh.await_args_list],
            ["fws.shell.updated", "fws.shell.removed"],
        )

    def test_fws_snapshot_tracks_only_running_run_profile_shells(self) -> None:
        run_profile_fws_bridge._relevant_shell_labels.clear()
        try:
            run_profile_fws_bridge._replace_relevant_shell_ids(
                {
                    "result": {
                        "state": {
                            "shells": [
                                {
                                    "id": "running-profile",
                                    "label": "runner-profile:file_editor_cm6:project:python",
                                    "status": "running",
                                },
                                {
                                    "id": "exited-profile",
                                    "label": "runner-profile:file_editor_cm6:project:web",
                                    "status": "exited",
                                },
                                {
                                    "id": "running-terminal",
                                    "label": "terminal:other",
                                    "status": "running",
                                },
                            ]
                        }
                    }
                }
            )

            self.assertEqual(
                run_profile_fws_bridge._relevant_shell_labels,
                {
                    "running-profile": "runner-profile:file_editor_cm6:project:python",
                },
            )
        finally:
            run_profile_fws_bridge._relevant_shell_labels.clear()


class RunProfileRefinementContractTests(unittest.IsolatedAsyncioTestCase):
    def test_page_preview_hides_process_fields_and_dev_runtime_is_exposed(self) -> None:
        fields = cast(
            list[dict[str, object]],
            run_profiles_config_backend._run_profile_contract()["fields"],
        )
        by_key = {cast(str, field["key"]): field for field in fields}
        self.assertEqual(
            by_key["entry"]["visibleWhen"],
            {"field": "runner", "equals": "pagePreview"},
        )
        for key in (
            "exec",
            "args",
            "cwd",
            "env",
            "sidebarUrl",
            "port",
            "additionalPorts",
            "devRuntime",
            "runningBehavior",
        ):
            self.assertEqual(
                by_key[key]["visibleWhen"],
                {"field": "runner", "notEquals": "pagePreview"},
            )

    def test_page_preview_ignores_incompatible_raw_keys(self) -> None:
        raw_profile: dict[str, object] = {
            "profileId": "preview",
            "runner": "pagePreview",
            "entry": "index.html",
            "runningBehavior": "invalid",
            "exec": 42,
            "args": {"invalid": True},
            "cwd": ["invalid"],
            "env": ["invalid"],
            "sidebarUrl": "https://invalid.example/",
            "port": "invalid",
            "additionalPorts": "invalid",
            "devRuntime": "invalid",
        }
        config = runner_profiles.parse_run_profiles_config(
            {"version": 1, "profiles": [raw_profile]}
        )
        self.assertEqual(cast(list[object], config["profiles"])[0], raw_profile)

        profile = runner_profiles._profiles_from_config(config)[0]
        self.assertEqual(profile.running_behavior, "just save")
        self.assertEqual(profile.exec_command, "")
        self.assertEqual(profile.args, ())
        self.assertEqual(profile.cwd, "")
        self.assertEqual(profile.env, {})
        self.assertEqual(profile.sidebar_url, runner_profiles.DEFAULT_PAGE_PREVIEW_URL)
        self.assertIsNone(profile.port)
        self.assertEqual(profile.additional_ports, ())
        self.assertFalse(profile.dev_runtime)

    async def test_saved_included_file_refreshes_running_dev_surface(self) -> None:
        profile = runner_profiles.RunProfile(
            profile_id="api",
            runner="python",
            entry="",
            include=("src/**",),
            sidebar_url="http://127.0.0.1:8000/",
            running_behavior="just save",
            exec_command="src/main.py",
            cwd="",
            args=(),
            env={},
            save_drafts="included",
            show_save_warning=False,
            dev_runtime=True,
        )
        refresh = AsyncMock(return_value=True)
        with (
            patch.object(
                run_profile_surfaces,
                "current_project_generation",
                return_value=7,
            ),
            patch.object(
                run_profile_surfaces,
                "load_run_profiles",
                return_value=[profile],
            ),
            patch.object(
                run_profile_surfaces,
                "runner_profile_shell_state",
                AsyncMock(
                    return_value=SimpleNamespace(
                        shell_id="shell-api",
                        label="runner:api",
                        running=True,
                    )
                ),
            ),
            patch.object(run_profile_surfaces, "_refresh_surface_slot", refresh),
        ):
            await run_profile_surfaces._handle_file_saved(
                cast(
                    object,
                    {
                        "type": "FileSaved",
                        "project_root": "/project",
                        "project_generation": 7,
                        "source": "test",
                        "payload": {
                            "fileSaved": {
                                "relativePath": "src/main.py",
                            }
                        },
                    },
                )
            )

        refresh.assert_awaited_once_with(
            project_root="/project",
            profile=profile,
            shell_id="shell-api",
        )


if __name__ == "__main__":
    _ = unittest.main()
