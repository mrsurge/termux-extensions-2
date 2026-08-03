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
from app.apps.file_editor_cm6 import run_profile_events, run_profile_state
from app.apps.file_editor_cm6.monaco_editor.editor_backend_services import save_service
from app.apps.file_editor_cm6.host import terminal_actions_backend
from app.apps.file_editor_cm6.host import runner_profiles_backend
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

    def test_routed_port_rejects_page_preview_and_unsafe_urls(self) -> None:
        with self.assertRaisesRegex(ValueError, "not supported for Page Preview"):
            _ = runner_profiles._profile_from_json(
                {
                    "profileId": "preview",
                    "runner": "pagePreview",
                    "entry": "index.html",
                    "port": 3000,
                },
                index=0,
            )
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


class RunProfileSidebarDevToolsTests(unittest.IsolatedAsyncioTestCase):
    async def test_sidebar_url_projects_stable_native_target_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            create = AsyncMock(return_value={"ok": True})
            with patch.object(
                runner_profiles_backend,
                "handle_ui_sidebar_window_create_request",
                create,
            ):
                result = await runner_profiles_backend._open_sidebar_url(
                    url="http://127.0.0.1:3000/",
                    profile_id="preview",
                    title="Page Preview",
                    label="Page Preview",
                    host_prefix="page-preview",
                    source_name="test",
                    project_root=root,
                    dev_tools=True,
                )

            self.assertTrue(result["ok"])
            payload = cast(dict[str, object], create.await_args.args[0])
            expected_id = runner_profiles_backend._devtools_target_id(root, "preview")
            self.assertIs(payload["devTools"], True)
            self.assertEqual(payload["devToolsTargetId"], expected_id)
            self.assertEqual(payload["devToolsTargetLabel"], "Page Preview")
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
                "order": ["launcher", "runner-profile:preview"],
            },
            disabled,
            activate=True,
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
        create = AsyncMock(return_value={"ok": True})
        with patch.object(
            runner_profiles_backend,
            "handle_ui_sidebar_window_create_request",
            create,
        ):
            result = await runner_profiles_backend._open_sidebar_url(
                url="http://127.0.0.1:4173/app",
                profile_id="web",
                title="Run web",
                label="Run web",
                host_prefix="runner-profile",
                source_name="test",
                project_root=Path("/project"),
                dev_tools=False,
                run_target_route=route,
            )

        self.assertTrue(result["ok"])
        payload = cast(dict[str, object], create.await_args.args[0])
        self.assertEqual(payload["runTargetRoute"], route)
        slot = sidebar_window_state._normalize_url_slot(payload)
        self.assertEqual(slot["runTargetRoute"], route)


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
            route = {
                "dto": "RunTargetRoute",
                "version": 1,
                "ticket": ticket,
                "tunnelPath": f"/api/run-targets/{ticket}/tunnel",
                "preferredPort": 4173,
                "expiresAt": 999,
            }
            ensure = AsyncMock(return_value=shell)
            register = AsyncMock(return_value=route)
            open_sidebar = AsyncMock(return_value={"ok": True})
            with (
                patch.object(
                    runner_profiles_backend,
                    "ensure_runner_profile_shell",
                    ensure,
                ),
                patch.object(
                    runner_profiles_backend,
                    "register_run_target_route",
                    register,
                ),
                patch.object(
                    runner_profiles_backend,
                    "_open_sidebar_url",
                    open_sidebar,
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
                port=4173,
            )
            projected = open_sidebar.await_args.kwargs["run_target_route"]
            self.assertEqual(projected["ticket"], ticket)
            self.assertEqual(projected["originalUrl"], match.profile.sidebar_url)

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
                    "resolve_runner_profile_run_request",
                    return_value=match,
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
            self.assertFalse(cast(dict[str, object], result["data"])["running"])


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
                    "resolve_run_profile_match",
                    return_value=match,
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
        ):
            await run_profile_fws_bridge._on_notification(unrelated)
            await run_profile_fws_bridge._on_notification(relevant)
            await run_profile_fws_bridge._on_notification(removed)

        self.assertEqual(refresh.await_count, 2)
        release.assert_awaited_once_with(
            owner_id="runner-profile:file_editor_cm6:project:python",
            shell_id="run-shell",
        )
        self.assertEqual(
            [call.kwargs["source"] for call in refresh.await_args_list],
            ["fws.shell.updated", "fws.shell.removed"],
        )


if __name__ == "__main__":
    _ = unittest.main()
