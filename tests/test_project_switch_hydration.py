"""Exercise every project-open entry against one shared, isolated completion."""
# pyright: strict, reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.apps.code_te2 import explorer_runtime as runtime, project_switch_events
from app.apps.code_te2.explorer.handlers import session
from app.apps.code_te2.explorer.services import project_switch, render_state, runtime_notifications
from app.apps.code_te2.explorer.transport import rpc_socketio
from app.apps.code_te2.explorer.transport.connection_manager import manager
from app.apps.code_te2.host import project_backend, projects_backend
from app.apps.code_te2.worker_services import event_bus
from app.apps.code_te2.worker_services.event_bus import WorkerEvent, build_event
from tests.test_explorer_dto_delivery import RecordingConnection
from tests.test_projects_rpc import project_fixture


@contextmanager
def connected_explorers(old_root: Path) -> Iterator[tuple[runtime.ExplorerDispatcher, runtime.ExplorerDispatcher]]:
    # Session construction normally subscribes History to the live fact bus.
    with patch.object(event_bus, "subscribe"), patch.object(rpc_socketio, "_ACTIVE_EXPLORER_NAMESPACES", []):
        namespace = rpc_socketio.ExplorerRpcSocketIONamespace()
        first = runtime.ExplorerDispatcher(RecordingConnection("client-a"))
        second = runtime.ExplorerDispatcher(RecordingConnection("client-b"))
        first.project_root = second.project_root = old_root
        namespace.dispatchers.update(a=first, b=second)
        yield first, second


class ProjectSwitchHydrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_modal_picker_and_sidebar_share_one_hydration_after_completion(self) -> None:
        for entry in ("modal", "picker", "sidebar"):
            with self.subTest(entry=entry), project_fixture() as (history, old, new), connected_explorers(Path(old)) as (first, second):
                facts: list[WorkerEvent] = []
                review = AsyncMock()
                async def capture(event: WorkerEvent) -> None:
                    facts.append(event)

                async def reconnect(_method: str, _params: dict[str, object] | None, _timeout: float) -> object:
                    return {"result": {"ok": True, "readyForDocumentOpen": True}}

                extra_git, duplicate, git = AsyncMock(), AsyncMock(), Mock()
                with ExitStack() as patches:
                    def replace(target: object, name: str, value: object) -> None:
                        _ = patches.enter_context(patch.object(target, name, new=value))

                    replace(project_backend, "get_history_store", Mock(return_value=history))
                    replace(project_backend, "_build_state_payload", Mock(return_value={}))
                    replace(project_switch, "set_project_root", Mock(return_value=Path(new)))
                    replace(project_switch, "next_project_generation", Mock(return_value=7))
                    for module in (project_switch, rpc_socketio, session):
                        replace(module, "current_project_generation", Mock(return_value=7))
                    replace(project_switch, "reset_project_session", AsyncMock(return_value=False))
                    _ = patches.enter_context(patch("app.apps.code_te2.watchexec_shell_manager.stop_watchexec_shell", new=AsyncMock()))
                    for method in ("disconnect", "register_existing", "reassign_all"):
                        replace(manager, method, Mock())
                    replace(project_switch, "_get_adapter_rpc", Mock(return_value=reconnect))
                    for method in ("_mark_adapter_workspace_switching", "_mark_adapter_workspace_ready", "_reset_project_diagnostics", "_start_project_watchexec_if_needed"):
                        replace(project_switch, method, AsyncMock())
                    replace(project_switch, "_replay_sidecar_open_state", AsyncMock(return_value={}))
                    replace(project_switch, "_broadcast_project_git_state", extra_git)
                    replace(project_switch, "publish", capture)
                    replace(session, "publish", capture)
                    replace(session, "mark_git_cache_dirty", Mock())
                    replace(session, "load_pruned_open_directories", Mock(return_value=["src/nested", "src"]))
                    replace(runtime_notifications, "schedule_git_status_update", git)
                    replace(first, "broadcast_review_state", review)
                    replace(second, "handle_explorer_refresh", duplicate)
                    if entry == "modal":
                        reply = await projects_backend.handle_projects_open({"path": new}, source_name="client-a")
                        self.assertTrue(reply["ok"])
                    elif entry == "sidebar":
                        reply = await project_backend.handle_sidebar_project_open_request({"path": new}, source_name="sidebar-a")
                        self.assertTrue(reply["ok"])
                    else:
                        await first.handle_project_open({"path": new}, None)
                self.assertEqual(first.project_root, Path(new))
                self.assertEqual(second.project_root, Path(new))
                self.assertEqual([fact["type"] for fact in facts], [
                    "ProjectSwitchStarted", "ProjectSwitchFinished", "ExplorerRenderStateChanged",
                ])
                self.assertEqual(facts[-1]["payload"]["directories"], [".", "src", "src/nested"])
                self.assertEqual(facts[-1]["payload"]["open_directories_changed"], True)
                self.assertEqual(facts[-1]["project_generation"], 7)
                review.assert_awaited_once()
                duplicate.assert_not_awaited()
                extra_git.assert_not_awaited()
                git.assert_called_once()

    async def test_dispatcher_switch_cancels_old_bootstrap_and_invalidates_history(self) -> None:
        with connected_explorers(Path("/old")) as (first, _second):
            old_bootstrap = asyncio.create_task(asyncio.sleep(60))
            first._bootstrap_task = old_bootstrap
            with patch.object(first._history, "invalidate_project") as invalidated:
                first.set_project_root(Path("/new"))
                first.set_project_root(Path("/new"))
                invalidated.assert_called_once()
            with self.assertRaises(asyncio.CancelledError):
                await old_bootstrap
            self.assertEqual(first.project_root, Path("/new"))

    async def test_stale_or_disconnected_refresh_does_not_hydrate_other_project(self) -> None:
        with connected_explorers(Path("/new")) as (first, second):
            with patch.object(rpc_socketio, "current_project_generation", return_value=8), patch.object(first, "handle_explorer_refresh", new=AsyncMock()) as refresh:
                self.assertFalse(await rpc_socketio.refresh_active_explorer_project(Path("/new"), 7))
                refresh.assert_not_awaited()
            first.project_root = second.project_root = Path("/other")
            with patch.object(rpc_socketio, "current_project_generation", return_value=7):
                self.assertFalse(await rpc_socketio.refresh_active_explorer_project(Path("/new"), 7))

    async def test_refresh_discards_directory_load_if_project_changes_during_io(self) -> None:
        with connected_explorers(Path("/old")) as (first, _second):
            with (
                patch.object(session, "current_project_generation", side_effect=[7, None]),
                patch.object(session, "load_pruned_open_directories", return_value=["src"]),
                patch.object(session, "mark_git_cache_dirty"),
                patch.object(session, "publish", new=AsyncMock()) as publish,
                patch.object(runtime_notifications, "schedule_git_status_update") as git,
                patch.object(first, "broadcast_review_state", new=AsyncMock()) as review,
            ):
                await first.handle_explorer_refresh({}, None)
                publish.assert_not_awaited()
                git.assert_not_called()
                review.assert_not_awaited()

    async def test_queued_stale_completion_cannot_reset_new_explorer(self) -> None:
        event = build_event("ProjectSwitchFinished", project_root="/old", project_generation=7, source="test")
        with (
            patch.object(project_switch_events, "current_project_generation", return_value=8),
            patch.object(project_switch_events, "_emit_project_switch_notification", new=AsyncMock()) as host,
            patch.object(project_switch_events, "_emit_explorer_project_opened", new=AsyncMock()) as explorer,
        ):
            await project_switch_events._handle_project_switch_finished_event(event)
            host.assert_not_awaited()
            explorer.assert_not_awaited()

    async def test_directory_projection_reaches_both_clients_in_parent_first_order(self) -> None:
        sockets = [RecordingConnection("client-a"), RecordingConnection("client-b")]
        event = build_event("ExplorerRenderStateChanged", project_root="/new", project_generation=7, source="test", payload={
            "directories": [".", "src", "src/nested"],
            "open_directories": ["src", "src/nested"], "open_directories_changed": True,
        })
        async def listings(rels: list[str], *, project_root: Path, project_generation: int | None) -> list[dict[str, object]]:
            self.assertEqual((project_root, project_generation), (Path("/new"), 7))
            return [{"cwd": rel, "entries": []} for rel in rels]

        async def emit(project: str | None, method: str, payload: dict[str, object]) -> None:
            self.assertEqual(project, "/new")
            for socket in sockets:
                await socket.send_message({"method": method, "params": payload})

        with (
            patch.object(render_state, "current_project_generation", return_value=7),
            patch.object(render_state, "build_directory_listings", side_effect=listings),
            patch.object(render_state, "emit_project_explorer_rpc_notification", side_effect=emit),
        ):
            await render_state._handle_explorer_render_state_changed_event(event)
        self.assertEqual(sockets[0].messages, sockets[1].messages)
        self.assertEqual(len(sockets[0].messages), 4)
        self.assertEqual([message["method"] for message in sockets[0].messages], [
            "explorer.openDirs.updated", "explorer.list.updated", "explorer.list.updated", "explorer.list.updated",
        ])
