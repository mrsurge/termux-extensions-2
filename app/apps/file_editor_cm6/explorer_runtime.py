"""Explorer backend runtime/composition layer.

This module is intentionally the runtime entrypoint and orchestration shell for
Explorer backend sessions. It may own transport adapters, runtime/session
assembly, and handler wiring, but new feature logic should not be implemented
here. Put feature behavior in `explorer/handlers/`, `explorer/services/`, or
`explorer/contracts/` and keep this module boring.
"""

import asyncio
from collections.abc import Awaitable, Callable
import importlib
import logging
from typing import Protocol, cast, runtime_checkable
from pathlib import Path

# Import git_service to register job handlers in worker process.
importlib.import_module("app.libs.git_service")

from .explorer.services import file_ops as _file_ops
from .git_helper import get_status as git_get_status
# NOTE: search and review are imported lazily inside handler methods
# to break a circular import chain:
#   diagnostics_bridge → explorer transport socketio app → explorer_runtime → explorer/review
#   → editor_discard → editor_backend → editor_socketio → editor_ws

# Logger setup
logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
ExplorerMessageHandler = Callable[[JsonObject, str | None], Awaitable[None]]
MarkGitCacheDirtyFn = Callable[[Path], None]
GetAllGitStatusesFn = Callable[[], JsonObject]

get_project_root = _file_ops.get_project_root
mark_git_cache_dirty = cast(MarkGitCacheDirtyFn, _file_ops.mark_git_cache_dirty)
get_all_git_statuses = cast(GetAllGitStatusesFn, _file_ops.get_all_git_statuses)


@runtime_checkable
class ExplorerRpcReplySocket(Protocol):
    def complete_rpc_request(self, request_id: str, result: JsonObject) -> bool: ...

    def fail_rpc_request(
        self,
        request_id: str,
        message: str,
        data: JsonObject | None = None,
    ) -> bool: ...


def abs_to_rel(abs_path: str, project_root: str) -> str | None:
    """Convert an absolute path into a project-root-relative path (best-effort).

    Re-exported from the explorer transport connection manager for backward compatibility.
    """
    from .explorer.transport.connection_manager import abs_to_rel as _abs_to_rel
    return _abs_to_rel(abs_path, project_root)

# --- Connection Manager ---
# Extracted to explorer transport connection_manager.py to break circular import chains.
# Re-exported here for backward compatibility.
from .explorer.transport.connection_manager import ExplorerConnection, manager
from .explorer.context import (
    ExplorerExtensionHandlerContext,
    ExplorerFileTreeHandlerContext,
    ExplorerGitHandlerContext,
    ExplorerIntegrationHandlerContext,
    ExplorerPrefsHandlerContext,
    ExplorerProjectHandlerContext,
    ExplorerSearchReviewHandlerContext,
    ExplorerSessionHandlerContext,
    ExplorerWatcherHandlerContext,
    MarkProjectDirty,
)
from .explorer.services.job_tracking import (
    ExplorerJobTrackingRuntime,
    start_job_tracking,
    stop_job_tracking,
)
from .explorer.services.session_bootstrap import bootstrap_explorer_session
from .explorer.services.runtime_notifications import set_explorer_event_loop
from .explorer.transport.rpc_contract import build_jsonrpc_notification

# --- Dispatcher ---

class ExplorerDispatcher:
    def __init__(self, websocket: ExplorerConnection) -> None:
        self.websocket = websocket
        self.project_root = get_project_root()
        self._job_tracking: ExplorerJobTrackingRuntime | None = None
        self._tracked_job_ids: set[str] = set()

    async def initialize(self) -> None:
        # Feed the current worker loop to watcher/draft notification services.
        set_explorer_event_loop(asyncio.get_event_loop())

        bootstrap = await bootstrap_explorer_session(
            websocket=self.websocket,
            project_root=self.project_root,
            emit_personal=self.emit_personal,
            broadcast_git_status=self.broadcast_git_status,
            broadcast_review_state=self.broadcast_review_state,
        )
        self.project_root = bootstrap.project_root

        self._job_tracking = await start_job_tracking(
            get_project_root=lambda: self.project_root,
            tracked_job_ids=self._tracked_job_ids,
            emit_personal=self.emit_personal,
            refresh_explorer_state=self._refresh_runtime_state,
        )

    async def cleanup(self) -> None:
        await stop_job_tracking(self._job_tracking)
        self._job_tracking = None
        manager.disconnect(self.websocket)

    # --- Helpers ---

    async def _refresh_runtime_state(self) -> None:
        await self.handle_explorer_refresh({}, None)

    async def emit_personal(
        self,
        method: str,
        payload: JsonObject,
        reply_to: str | None = None,
    ) -> None:
        if reply_to and isinstance(self.websocket, ExplorerRpcReplySocket):
            if method == "explorer.error":
                error_obj = payload.get("error")
                error_message = (
                    error_obj
                    if isinstance(error_obj, str) and error_obj
                    else "Explorer RPC request failed"
                )
                if self.websocket.fail_rpc_request(reply_to, error_message, payload):
                    return
            elif self.websocket.complete_rpc_request(reply_to, payload):
                return
        await manager.send_personal(
            self.websocket,
            build_jsonrpc_notification(method, payload),
        )

    async def broadcast(self, method: str, payload: JsonObject) -> None:
        await manager.broadcast(
            str(self.project_root),
            build_jsonrpc_notification(method, payload),
        )

    async def send_error(self, message: str, reply_to: str | None = None) -> None:
        payload: JsonObject = {"error": message}
        await self.emit_personal("explorer.error", payload, reply_to)

    async def broadcast_git_status(self) -> None:
        try:
            status = await asyncio.to_thread(git_get_status, self.project_root)
            logger.info(f"[GIT_STATUS_DEBUG] broadcast_git_status: staged={status.staged}, unstaged={status.unstaged}, untracked={status.untracked}")
            data: JsonObject = {
                "branch": status.branch,
                "detached": status.detached,
                "ahead": status.ahead,
                "behind": status.behind,
                "staged": status.staged,
                "unstaged": status.unstaged,
                "untracked": status.untracked,
            }
            await self.broadcast("explorer.git.status.updated", data)
        except Exception:
            pass

        # Push fresh git baselines to editor so diff editor's original model
        # updates after commits/checkouts (needed in draft mode).
        try:
            from .monaco_editor.editor_ws import broadcast_git_baselines_for_active_file
            await broadcast_git_baselines_for_active_file()
        except Exception as e:
            logger.warning(f"[broadcast_git_status] git baselines push failed: {e}")

    async def broadcast_git_decorations(self) -> None:
        """Broadcast git status decorations for all files and directories.
        
        This allows the frontend to update gitStatus classes on existing DOM nodes
        without replacing the tree structure (preserves expanded state).
        """
        try:
            statuses = await asyncio.to_thread(get_all_git_statuses)
            await self.broadcast("explorer.git.decorations.updated", {"statuses": statuses})
        except Exception:
            pass

    async def broadcast_review_state(self) -> None:
        """Broadcast updated review entries and decoration updates."""
        # 1. Review List
        from .explorer import review
        reviews = await review.list_reviews(self.project_root, lightweight=True)
        await self.broadcast("explorer.review.entries.updated", {"entries": reviews})

        # 2. Decorations (Drafts)
        draft_decorations: JsonObject = {
            rel: {"hasDraft": True}
            for review_entry in reviews
            if review_entry.get("has_draft")
            for rel in [review_entry.get("rel")]
            if isinstance(rel, str)
        }
        await self.broadcast("explorer.decorations.updated", {"drafts": draft_decorations})

    def _build_search_review_context(self) -> ExplorerSearchReviewHandlerContext:
        from .explorer.services.file_ops import mark_draft_cache_dirty

        typed_mark_draft_cache_dirty = cast(MarkProjectDirty, mark_draft_cache_dirty)
        return ExplorerSearchReviewHandlerContext(
            project_root=self.project_root,
            emit_personal=self.emit_personal,
            broadcast_git_status=self.broadcast_git_status,
            broadcast_review_state=self.broadcast_review_state,
            notify_editor_draft_cleared=self._notify_editor_draft_cleared,
            mark_draft_cache_dirty=typed_mark_draft_cache_dirty,
            mark_git_cache_dirty=cast(MarkProjectDirty, mark_git_cache_dirty),
        )

    def _build_watcher_context(self) -> ExplorerWatcherHandlerContext:
        return ExplorerWatcherHandlerContext(
            project_root=self.project_root,
            emit_personal=self.emit_personal,
            broadcast=self.broadcast,
        )

    def _build_session_context(self) -> ExplorerSessionHandlerContext:
        return ExplorerSessionHandlerContext(
            project_root=self.project_root,
            emit_personal=self.emit_personal,
            broadcast=self.broadcast,
            broadcast_git_status=self.broadcast_git_status,
            broadcast_review_state=self.broadcast_review_state,
        )

    def _build_integration_context(self) -> ExplorerIntegrationHandlerContext:
        return ExplorerIntegrationHandlerContext(
            emit_personal=self.emit_personal,
            broadcast=self.broadcast,
        )

    def _build_prefs_context(self) -> ExplorerPrefsHandlerContext:
        return ExplorerPrefsHandlerContext(
            emit_personal=self.emit_personal,
            broadcast=self.broadcast,
        )

    def _build_extension_context(self) -> ExplorerExtensionHandlerContext:
        return ExplorerExtensionHandlerContext(
            project_root=self.project_root,
            emit_personal=self.emit_personal,
        )

    def _build_file_tree_context(self) -> ExplorerFileTreeHandlerContext:
        return ExplorerFileTreeHandlerContext(
            project_root=self.project_root,
            broadcast=self.broadcast,
            broadcast_git_status=self.broadcast_git_status,
            broadcast_git_decorations=self.broadcast_git_decorations,
        )

    def _build_git_context(self) -> ExplorerGitHandlerContext:
        return ExplorerGitHandlerContext(
            project_root=self.project_root,
            tracked_job_ids=self._tracked_job_ids,
            emit_personal=self.emit_personal,
            broadcast=self.broadcast,
            broadcast_git_status=self.broadcast_git_status,
            broadcast_git_decorations=self.broadcast_git_decorations,
        )

    def _build_project_context(self) -> ExplorerProjectHandlerContext:
        return ExplorerProjectHandlerContext(
            websocket=self.websocket,
            tracked_job_ids=self._tracked_job_ids,
            emit_personal=self.emit_personal,
        )

    def _resolve_handler(self, message_type: str) -> ExplorerMessageHandler | None:
        handler_name = f"handle_{message_type.replace(':', '_')}"
        handler = getattr(self, handler_name, None)
        if handler is None:
            return None
        return cast(ExplorerMessageHandler, handler)

    async def dispatch_message(
        self,
        message_type: str,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        """Dispatch a parsed Explorer command without rebuilding a wire envelope."""
        handler = self._resolve_handler(message_type)
        if handler is None:
            logger.warning("Unknown message type: %s", message_type)
            await self.send_error(
                f"Unknown command: {message_type}",
                msg_id,
            )
            return

        try:
            await handler(payload, msg_id)
        except Exception as e:
            logger.exception("Error handling %s", message_type)
            await self.send_error(str(e), msg_id)

    # --- Handlers ---

    async def handle_explorer_list(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.session import (
            ExplorerSessionContractError,
            parse_list_params,
        )
        from .explorer.handlers.session import handle_explorer_list

        try:
            params = parse_list_params(payload)
        except ExplorerSessionContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_explorer_list(self._build_session_context(), params, msg_id)

    async def handle_explorer_refresh(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.session import (
            ExplorerSessionContractError,
            parse_refresh_params,
        )
        from .explorer.handlers.session import handle_explorer_refresh

        try:
            params = parse_refresh_params(payload)
        except ExplorerSessionContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_explorer_refresh(self._build_session_context(), params, msg_id)

    async def handle_cm6_mirror(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.integration import (
            ExplorerIntegrationContractError,
            parse_cm6_mirror_params,
        )
        from .explorer.handlers.integration import handle_cm6_mirror

        try:
            params = parse_cm6_mirror_params(payload)
        except ExplorerIntegrationContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_cm6_mirror(self._build_integration_context(), params, msg_id)

    async def handle_mention_agent(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.integration import (
            ExplorerIntegrationContractError,
            parse_mention_agent_params,
        )
        from .explorer.handlers.integration import handle_mention_agent

        try:
            params = parse_mention_agent_params(payload)
        except ExplorerIntegrationContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_mention_agent(self._build_integration_context(), params, msg_id)

    async def handle_explorer_setOpenDirs(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.session import (
            ExplorerSessionContractError,
            parse_open_dirs_params,
        )
        from .explorer.handlers.session import handle_set_open_dirs

        try:
            params = parse_open_dirs_params(payload)
        except ExplorerSessionContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_set_open_dirs(self._build_session_context(), params, msg_id)

    async def handle_watcher_raiseLimit(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.watcher import (
            ExplorerWatcherContractError,
            parse_watcher_raise_limit_params,
        )
        from .explorer.handlers.watcher import (
            handle_watcher_raise_limit as handle_watcher_raise_limit_request,
        )

        try:
            params = parse_watcher_raise_limit_params(payload)
        except ExplorerWatcherContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_watcher_raise_limit_request(
            self._build_watcher_context(),
            params,
            msg_id,
        )

    async def handle_watcher_setMode(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.watcher import (
            ExplorerWatcherContractError,
            parse_watcher_set_mode_params,
        )
        from .explorer.handlers.watcher import (
            handle_watcher_set_mode as handle_watcher_set_mode_request,
        )

        try:
            params = parse_watcher_set_mode_params(payload)
        except ExplorerWatcherContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_watcher_set_mode_request(
            self._build_watcher_context(),
            params,
            msg_id,
        )

    async def handle_watcher_getConfig(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.watcher import (
            ExplorerWatcherContractError,
            parse_watcher_get_config_params,
        )
        from .explorer.handlers.watcher import (
            handle_watcher_get_config as handle_watcher_get_config_request,
        )

        try:
            params = parse_watcher_get_config_params(payload)
        except ExplorerWatcherContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_watcher_get_config_request(
            self._build_watcher_context(),
            params,
            msg_id,
        )

    async def handle_prefs_updateUi(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.prefs import (
            ExplorerPrefsContractError,
            parse_update_ui_params,
        )
        from .explorer.handlers.prefs import handle_prefs_update_ui

        try:
            params = parse_update_ui_params(payload)
        except ExplorerPrefsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_prefs_update_ui(self._build_prefs_context(), params, msg_id)

    async def handle_prefs_vendorAgentIcon(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        from .explorer.contracts.prefs import (
            ExplorerPrefsContractError,
            parse_vendor_agent_icon_params,
        )
        from .explorer.handlers.prefs import handle_prefs_vendor_agent_icon

        try:
            params = parse_vendor_agent_icon_params(payload)
        except ExplorerPrefsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_prefs_vendor_agent_icon(self._build_prefs_context(), params, msg_id)

    # --- File Operations (Broadcasts updates) ---

    async def handle_explorer_createFile(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_create_file_params,
        )
        from .explorer.handlers.file_tree import handle_create_file

        try:
            params = parse_create_file_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_create_file(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_createDir(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_create_dir_params,
        )
        from .explorer.handlers.file_tree import handle_create_dir

        try:
            params = parse_create_dir_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_create_dir(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_rename(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_rename_entry_params,
        )
        from .explorer.handlers.file_tree import handle_rename_entry

        try:
            params = parse_rename_entry_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_rename_entry(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_delete(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_delete_entry_params,
        )
        from .explorer.handlers.file_tree import handle_delete_entry

        try:
            params = parse_delete_entry_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_delete_entry(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_batchDelete(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import parse_batch_delete_params
        from .explorer.handlers.file_tree import handle_batch_delete

        params = parse_batch_delete_params(payload)
        await handle_batch_delete(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_batchCopy(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_batch_copy_params,
        )
        from .explorer.handlers.file_tree import handle_batch_copy

        try:
            params = parse_batch_copy_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_batch_copy(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_batchMove(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_batch_move_params,
        )
        from .explorer.handlers.file_tree import handle_batch_move

        try:
            params = parse_batch_move_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_batch_move(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_editor_open(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_editor_open_params,
        )
        from .explorer.handlers.file_tree import handle_editor_open

        try:
            params = parse_editor_open_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_editor_open(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_move(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_entry_move_params,
        )
        from .explorer.handlers.file_tree import handle_move_entry

        try:
            params = parse_entry_move_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_move_entry(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_copy(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_entry_copy_params,
        )
        from .explorer.handlers.file_tree import handle_copy_entry

        try:
            params = parse_entry_copy_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_copy_entry(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_copyFrom(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_entry_copy_from_params,
        )
        from .explorer.handlers.file_tree import handle_copy_from

        try:
            params = parse_entry_copy_from_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_copy_from(self._build_file_tree_context(), params, msg_id)

    async def handle_explorer_moveFrom(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.file_tree import (
            ExplorerFileTreeContractError,
            parse_entry_move_from_params,
        )
        from .explorer.handlers.file_tree import handle_move_from

        try:
            params = parse_entry_move_from_params(payload)
        except ExplorerFileTreeContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_move_from(self._build_file_tree_context(), params, msg_id)

    # --- Git Operations (Broadcasts Status) ---

    async def handle_git_status(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_status_params
        from .explorer.handlers.git import handle_git_status

        params = parse_git_status_params(payload)
        await handle_git_status(self._build_git_context(), params, msg_id)

    async def handle_git_stage(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_stage_params
        from .explorer.handlers.git import handle_git_stage

        params = parse_git_stage_params(payload)
        await handle_git_stage(self._build_git_context(), params, msg_id)

    async def handle_git_unstage(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_unstage_params
        from .explorer.handlers.git import handle_git_unstage

        params = parse_git_unstage_params(payload)
        await handle_git_unstage(self._build_git_context(), params, msg_id)

    async def handle_git_stageAll(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_stage_all_params
        from .explorer.handlers.git import handle_git_stage_all

        params = parse_git_stage_all_params(payload)
        await handle_git_stage_all(self._build_git_context(), params, msg_id)

    async def handle_git_unstageAll(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_unstage_all_params
        from .explorer.handlers.git import handle_git_unstage_all

        params = parse_git_unstage_all_params(payload)
        await handle_git_unstage_all(self._build_git_context(), params, msg_id)

    async def handle_git_restore(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import (
            ExplorerGitContractError,
            parse_git_restore_params,
        )
        from .explorer.handlers.git import handle_git_restore

        try:
            params = parse_git_restore_params(payload)
        except ExplorerGitContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_git_restore(self._build_git_context(), params, msg_id)

    async def handle_git_commit(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import (
            ExplorerGitContractError,
            parse_git_commit_params,
        )
        from .explorer.handlers.git import handle_git_commit

        try:
            params = parse_git_commit_params(payload)
        except ExplorerGitContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_git_commit(self._build_git_context(), params, msg_id)

    async def handle_git_push(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_push_params
        from .explorer.handlers.git import handle_git_push

        params = parse_git_push_params(payload)
        await handle_git_push(self._build_git_context(), params, msg_id)

    async def handle_git_pull(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_pull_params
        from .explorer.handlers.git import handle_git_pull

        params = parse_git_pull_params(payload)
        await handle_git_pull(self._build_git_context(), params, msg_id)

    async def handle_git_reset(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_reset_params
        from .explorer.handlers.git import handle_git_reset

        params = parse_git_reset_params(payload)
        await handle_git_reset(self._build_git_context(), params, msg_id)

    async def handle_git_init(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_init_params
        from .explorer.handlers.git import handle_git_init

        params = parse_git_init_params(payload)
        await handle_git_init(self._build_git_context(), params, msg_id)

    async def handle_git_setDiffBase(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_set_diff_base_params
        from .explorer.handlers.git import handle_git_set_diff_base

        params = parse_git_set_diff_base_params(payload)
        await handle_git_set_diff_base(self._build_git_context(), params, msg_id)

    async def handle_git_listBranches(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_list_branches_params
        from .explorer.handlers.git import handle_git_list_branches

        params = parse_git_list_branches_params(payload)
        await handle_git_list_branches(self._build_git_context(), params, msg_id)

    async def handle_git_listCommits(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.git import parse_git_list_commits_params
        from .explorer.handlers.git import handle_git_list_commits

        params = parse_git_list_commits_params(payload)
        await handle_git_list_commits(self._build_git_context(), params, msg_id)

    # --- Project Operations ---

    async def handle_project_open(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.project import (
            ExplorerProjectContractError,
            parse_project_open_params,
        )
        from .explorer.handlers.project import handle_project_open

        try:
            params = parse_project_open_params(payload)
        except ExplorerProjectContractError as exc:
            return await self.send_error(exc.message, msg_id)

        switch_result = await handle_project_open(self._build_project_context(), params, msg_id)
        self.project_root = switch_result.project_root
        await self.handle_explorer_refresh({}, msg_id)

    async def handle_project_create(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.project import (
            ExplorerProjectContractError,
            parse_project_create_params,
        )
        from .explorer.handlers.project import handle_project_create

        try:
            params = parse_project_create_params(payload)
        except ExplorerProjectContractError as exc:
            return await self.send_error(exc.message, msg_id)

        switch_result = await handle_project_create(self._build_project_context(), params, msg_id)
        self.project_root = switch_result.project_root
        await self.handle_explorer_refresh({}, msg_id)

    async def handle_project_list(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.project import parse_project_list_params
        from .explorer.handlers.project import handle_project_list

        params = parse_project_list_params(payload)
        await handle_project_list(self._build_project_context(), params, msg_id)

    async def handle_git_clone(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.project import (
            ExplorerProjectContractError,
            parse_git_clone_params,
        )
        from .explorer.handlers.project import handle_git_clone

        try:
            params = parse_git_clone_params(payload)
        except ExplorerProjectContractError as exc:
            return await self.send_error(exc.message, msg_id)

        switch_result = await handle_git_clone(self._build_project_context(), params, msg_id)
        self.project_root = switch_result.project_root

    # --- Search & Review (State Events) ---

    async def handle_search_run(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.search_review import (
            ExplorerSearchReviewContractError,
            parse_search_run_params,
        )
        from .explorer.handlers.search import (
            handle_search_run as handle_search_run_request,
        )

        try:
            params = parse_search_run_params(payload)
        except ExplorerSearchReviewContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_search_run_request(
            self._build_search_review_context(),
            params,
            msg_id,
        )

    async def handle_review_list(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.search_review import (
            ExplorerSearchReviewContractError,
            parse_review_list_params,
        )
        from .explorer.handlers.review import (
            handle_review_list as handle_review_list_request,
        )

        try:
            params = parse_review_list_params(payload)
        except ExplorerSearchReviewContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_review_list_request(
            self._build_search_review_context(),
            params,
            msg_id,
        )

    async def handle_review_save(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.search_review import (
            ExplorerSearchReviewContractError,
            parse_review_save_params,
        )
        from .explorer.handlers.review import (
            handle_review_save as handle_review_save_request,
        )

        try:
            params = parse_review_save_params(payload)
        except ExplorerSearchReviewContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_review_save_request(
            self._build_search_review_context(),
            params,
            msg_id,
        )

    async def handle_review_discard(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.search_review import (
            ExplorerSearchReviewContractError,
            parse_review_discard_params,
        )
        from .explorer.handlers.review import (
            handle_review_discard as handle_review_discard_request,
        )

        try:
            params = parse_review_discard_params(payload)
        except ExplorerSearchReviewContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_review_discard_request(
            self._build_search_review_context(),
            params,
            msg_id,
        )

    async def _notify_editor_draft_cleared(self, rel_files: list[str]) -> None:
        """Notify the editor RPC lane that draft state was cleared."""
        try:
            from .monaco_editor.editor_ws import editor_runtime_emit_room_event

            for rel in rel_files:
                abs_path = str(self.project_root / rel)
                await editor_runtime_emit_room_event(
                    "editor:cache_state",
                    {
                        "path": abs_path,
                        "state": "clean",
                        "unsaved": False,
                        "reason": "discard_external",
                    },
                )
        except Exception:
            pass

    async def handle_pulse_alive(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.integration import (
            ExplorerIntegrationContractError,
            parse_pulse_alive_params,
        )
        from .explorer.handlers.integration import handle_pulse_alive

        try:
            params = parse_pulse_alive_params(payload)
        except ExplorerIntegrationContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_pulse_alive(self._build_integration_context(), params, msg_id)

    # ── Extension registry handlers ───────────────────────────────────

    async def handle_ext_list(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_list_params,
        )
        from .explorer.handlers.extensions import handle_ext_list

        try:
            params = parse_list_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_list(self._build_extension_context(), params, msg_id)

    async def handle_ext_install(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_install_params,
        )
        from .explorer.handlers.extensions import handle_ext_install

        try:
            params = parse_install_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_install(self._build_extension_context(), params, msg_id)

    async def handle_ext_uninstall(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_uninstall_params,
        )
        from .explorer.handlers.extensions import handle_ext_uninstall

        try:
            params = parse_uninstall_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_uninstall(self._build_extension_context(), params, msg_id)

    async def handle_ext_configure(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_configure_params,
        )
        from .explorer.handlers.extensions import handle_ext_configure

        try:
            params = parse_configure_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_configure(self._build_extension_context(), params, msg_id)

    async def handle_ext_custom_settings_get(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_custom_settings_get_params,
        )
        from .explorer.handlers.extensions import handle_ext_custom_settings_get

        try:
            params = parse_custom_settings_get_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_custom_settings_get(self._build_extension_context(), params, msg_id)

    async def handle_ext_custom_settings_set(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_custom_settings_set_params,
        )
        from .explorer.handlers.extensions import handle_ext_custom_settings_set

        try:
            params = parse_custom_settings_set_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_custom_settings_set(self._build_extension_context(), params, msg_id)

    async def handle_ext_workspace_settings_get(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_workspace_settings_get_params,
        )
        from .explorer.handlers.extensions import handle_ext_workspace_settings_get

        try:
            params = parse_workspace_settings_get_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_workspace_settings_get(self._build_extension_context(), params, msg_id)

    async def handle_ext_workspace_settings_set(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_workspace_settings_set_params,
        )
        from .explorer.handlers.extensions import handle_ext_workspace_settings_set

        try:
            params = parse_workspace_settings_set_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_workspace_settings_set(self._build_extension_context(), params, msg_id)

    async def handle_ext_toggle(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_toggle_params,
        )
        from .explorer.handlers.extensions import handle_ext_toggle

        try:
            params = parse_toggle_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_toggle(self._build_extension_context(), params, msg_id)

    async def handle_ext_configSchema(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_config_schema_params,
        )
        from .explorer.handlers.extensions import handle_ext_config_schema

        try:
            params = parse_config_schema_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_config_schema(self._build_extension_context(), params, msg_id)

    async def handle_ext_restart_adapter(self, payload: JsonObject, msg_id: str | None) -> None:
        from .explorer.contracts.extensions import (
            ExplorerExtensionsContractError,
            parse_restart_adapter_params,
        )
        from .explorer.handlers.extensions import handle_ext_restart_adapter

        try:
            params = parse_restart_adapter_params(payload)
        except ExplorerExtensionsContractError as exc:
            return await self.send_error(exc.message, msg_id)

        await handle_ext_restart_adapter(self._build_extension_context(), params, msg_id)
