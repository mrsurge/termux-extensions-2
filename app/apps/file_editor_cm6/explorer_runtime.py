"""Explorer backend runtime/composition layer.

This module is intentionally the runtime entrypoint and orchestration shell for
Explorer backend sessions. It may own transport adapters, runtime/session
assembly, and handler wiring, but new feature logic should not be implemented
here. Put feature behavior in `explorer/handlers/`, `explorer/services/`, or
`explorer/contracts/` and keep this module boring.
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import hashlib
import importlib
import json
import logging
import os
from typing import TYPE_CHECKING, Protocol, cast
from fastapi import WebSocket, WebSocketDisconnect
from pathlib import Path

# Import git_service to register job handlers in worker process.
importlib.import_module("app.libs.git_service")

from . import explorer_helper as _explorer_helper
from .git_helper import get_status as git_get_status
from .stores import get_preferences_store
from .project_sidecar import ProjectSidecar
# NOTE: search and review are imported lazily inside handler methods
# to break a circular import chain:
#   diagnostics_bridge → explorer_socketio → explorer_runtime → explorer/review
#   → editor_discard → editor_backend → editor_socketio → editor_ws
from .preferences_store import DEFAULT_UI_PREFS

# Logger setup
logger = logging.getLogger(__name__)

AGENT_ICON_DIR = Path.home() / ".local" / "share" / "termux-extensions-2" / "agent_icons"
PREFERENCES_STORE = get_preferences_store()

JsonObject = dict[str, object]
ExplorerMessageHandler = Callable[[JsonObject, str | None], Awaitable[None]]
ListDirFn = Callable[[str], JsonObject]
GetProjectRootFn = Callable[[], Path]
MarkGitCacheDirtyFn = Callable[[Path], None]
GetAllGitStatusesFn = Callable[[], JsonObject]

get_project_root = _explorer_helper.get_project_root
list_dir = cast(ListDirFn, _explorer_helper.list_dir)
mark_git_cache_dirty = cast(MarkGitCacheDirtyFn, _explorer_helper.mark_git_cache_dirty)
get_all_git_statuses = cast(GetAllGitStatusesFn, _explorer_helper.get_all_git_statuses)


def _load_json_value(raw: str) -> object:
    return cast(object, json.loads(raw))


if TYPE_CHECKING:
    class _SocketIOAsyncNamespace:
        def __init__(self, namespace: str = "/explorer") -> None: ...

        async def emit(
            self,
            event: str,
            data: object,
            *,
            room: str | None = None,
            namespace: str | None = None,
        ) -> None: ...
else:
    import socketio

    _SocketIOAsyncNamespace = socketio.AsyncNamespace


class SocketIOEmitter(Protocol):
    async def emit(
        self,
        event: str,
        data: object,
        *,
        room: str | None = None,
        namespace: str | None = None,
    ) -> None: ...


@dataclass(frozen=True)
class ExplorerInboundMessage:
    message_type: str | None
    payload: JsonObject
    msg_id: str | None


def _as_json_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    return cast(JsonObject, value)


def _parse_inbound_message(raw: object) -> ExplorerInboundMessage:
    message = _as_json_object(raw)
    if message is None:
        return ExplorerInboundMessage(message_type=None, payload={}, msg_id=None)

    message_type_obj = message.get("type")
    msg_id_obj = message.get("id")
    return ExplorerInboundMessage(
        message_type=message_type_obj if isinstance(message_type_obj, str) else None,
        payload=_as_json_object(message.get("payload")) or {},
        msg_id=msg_id_obj if isinstance(msg_id_obj, str) else None,
    )


def abs_to_rel(abs_path: str, project_root: str) -> str | None:
    """Convert an absolute path into a project-root-relative path (best-effort).

    Re-exported from explorer_manager for backward compatibility.
    """
    from .explorer_manager import abs_to_rel as _abs_to_rel
    return _abs_to_rel(abs_path, project_root)


class SocketIOSocketShim:
    """Lightweight shim to let ExplorerDispatcher use Socket.IO sessions.

    Provides accept() and send_text() to satisfy ConnectionManager.
    """

    def __init__(self, namespace: SocketIOEmitter, sid: str) -> None:
        self.namespace = namespace
        self.sid = sid

    async def accept(self) -> None:
        # Socket.IO is already connected; nothing to do
        return

    async def send_text(self, data: str) -> None:
        await self.namespace.emit('explorer:event', data, room=self.sid)

# --- Connection Manager ---
# Extracted to explorer_manager.py to break circular import chains.
# Re-exported here for backward compatibility.
from .explorer_manager import ExplorerConnection, manager
from .explorer.context import (
    ExplorerFileTreeHandlerContext,
    ExplorerGitHandlerContext,
    ExplorerProjectHandlerContext,
    ExplorerSearchReviewHandlerContext,
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
        message_type: str,
        payload: JsonObject,
        reply_to: str | None = None,
    ) -> None:
        msg: JsonObject = {"type": message_type, "payload": payload}
        if reply_to:
            msg["id"] = reply_to
        await manager.send_personal(self.websocket, msg)

    async def broadcast(self, message_type: str, payload: JsonObject) -> None:
        msg: JsonObject = {"type": message_type, "payload": payload}
        await manager.broadcast(str(self.project_root), msg)

    async def send_error(self, message: str, reply_to: str | None = None) -> None:
        payload: JsonObject = {"error": message}
        await self.emit_personal("error", payload, reply_to)

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
            await self.broadcast("git:status", data)
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
            await self.broadcast("explorer:updateGitStatus", {"statuses": statuses})
        except Exception:
            pass

    async def broadcast_review_state(self) -> None:
        """Broadcast updated review entries and decoration updates."""
        # 1. Review List
        from .explorer import review
        reviews = await review.list_reviews(self.project_root, lightweight=True)
        await self.broadcast("review:setEntries", {"entries": reviews})

        # 2. Decorations (Drafts)
        draft_decorations: JsonObject = {
            rel: {"hasDraft": True}
            for review_entry in reviews
            if review_entry.get("has_draft")
            for rel in [review_entry.get("rel")]
            if isinstance(rel, str)
        }
        await self.broadcast("explorer:updateDecorations", {"drafts": draft_decorations})

    def _build_search_review_context(self) -> ExplorerSearchReviewHandlerContext:
        from .explorer_helper import mark_draft_cache_dirty

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

    # --- Message Loop ---

    async def handle_message(self, raw_msg: str) -> None:
        try:
            data = _load_json_value(raw_msg)
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON")
            return

        await self.handle_message_json(data)

    async def handle_message_json(self, data: object) -> None:
        message = _parse_inbound_message(data)
        if not message.message_type:
            await self.send_error("Missing message type", message.msg_id)
            return

        handler = self._resolve_handler(message.message_type)
        if handler is None:
            logger.warning("Unknown message type: %s", message.message_type)
            await self.send_error(
                f"Unknown command: {message.message_type}",
                message.msg_id,
            )
            return

        try:
            await handler(message.payload, message.msg_id)
        except Exception as e:
            logger.exception("Error handling %s", message.message_type)
            await self.send_error(str(e), message.msg_id)

    # --- Handlers ---

    async def handle_explorer_list(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        rel_obj = payload.get("rel")
        rel = rel_obj if isinstance(rel_obj, str) and rel_obj else "."
        try:
            data = await asyncio.to_thread(list_dir, rel)
            # This is a personal response (lazy load), not a broadcast
            await self.emit_personal("explorer:setList", data, msg_id)
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_explorer_refresh(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        del payload, msg_id
        # Refresh everything
        mark_git_cache_dirty(self.project_root)
        await self.broadcast_git_status()
        await self.broadcast_review_state()
        # For tree, we typically just refresh the view from client, or broadcast root?
        # Let's broadcast root to be safe.
        data = await asyncio.to_thread(list_dir, '.')
        await self.broadcast("explorer:setList", data)

    async def handle_cm6_mirror(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        """Relay live CM6 buffer mirroring payloads to connected clients."""
        path = payload.get("path")
        content = payload.get("content")
        if not isinstance(path, str) or not path:
            return await self.send_error("Missing path", msg_id)
        if not isinstance(content, str):
            return await self.send_error("Missing content", msg_id)

        # Broadcast to all clients; receivers self-filter via source_client.
        await self.broadcast("cm6:mirror", payload)

        if msg_id:
            await self.emit_personal("cm6:mirror:ack", {"ok": True}, msg_id)

    async def handle_mention_agent(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        """Relay a file mention to the agent via /sidebar_ipc."""
        path = payload.get("path")
        if not isinstance(path, str) or not path.strip():
            return await self.send_error("Missing path for mention", msg_id)
        try:
            from .ui_ipc.ui_ipc_socketio import UI_IPC_SIO

            ui_ipc_sio = cast(SocketIOEmitter, UI_IPC_SIO)
            mention_payload: JsonObject = {"path": path.strip(), "source": "explorer"}
            for key in ("lineNo", "endLineNo", "col", "endCol", "content"):
                value = payload.get(key)
                if value is not None:
                    mention_payload[key] = value

            await ui_ipc_sio.emit(
                "sidebar:mention",
                mention_payload,
                namespace="/sidebar_ipc",
                room="sidebar_ipc",
            )
            logger.info(f"[mention:agent] relayed to sidebar_ipc path={path}")
        except Exception as exc:
            logger.warning(f"[mention:agent] relay failed: {exc}")
            return await self.send_error(f"Mention relay failed: {exc}", msg_id)

    async def handle_explorer_setOpenDirs(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        """Persist the list of open directories in explorer tree."""
        del msg_id
        dirs_obj = payload.get("dirs")
        dirs_items = cast(list[object], dirs_obj) if isinstance(dirs_obj, list) else []
        dirs = [entry for entry in dirs_items if isinstance(entry, str)]
        try:
            sidecar = ProjectSidecar.load_or_create(str(self.project_root))
            sidecar.set_open_directories(dirs)
            sidecar.save()
        except Exception as e:
            logger.warning(f"Failed to save open directories: {e}")

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
        """Update a single UI preference key via PreferenceStore (backend owns defaults)."""
        key = payload.get("key")
        value: object = payload.get("value")

        if not isinstance(key, str) or not key.strip():
            return await self.send_error("prefs:updateUi requires 'key' (string)", msg_id)
        key = key.strip()
        if key not in DEFAULT_UI_PREFS:
            return await self.send_error(f"Unknown UI preference key: {key}", msg_id)

        expected = cast(object, DEFAULT_UI_PREFS[key])
        if isinstance(expected, bool):
            if not isinstance(value, bool):
                # Accept a few common serializations to be resilient.
                if isinstance(value, (int, float)) and value in (0, 1):
                    value = bool(value)
                elif isinstance(value, str):
                    lowered = value.strip().lower()
                    if lowered in ("true", "1", "yes", "on"):
                        value = True
                    elif lowered in ("false", "0", "no", "off"):
                        value = False
                    else:
                        return await self.send_error(
                            "prefs:updateUi requires 'value' (boolean)",
                            msg_id,
                        )
                else:
                    return await self.send_error(
                        "prefs:updateUi requires 'value' (boolean)",
                        msg_id,
                    )
        elif isinstance(expected, str):
            if value is None:
                value = ""
            elif not isinstance(value, str):
                return await self.send_error(
                    "prefs:updateUi requires 'value' (string)",
                    msg_id,
                )
            value = value.strip()
            if key in ("agentToggleDisplay", "agentHeaderDisplay"):
                if value not in ("icon", "text", "both"):
                    return await self.send_error(
                        f"{key} must be one of: icon, text, both",
                        msg_id,
                    )
        elif isinstance(expected, list):
            if not isinstance(value, list):
                return await self.send_error(
                    "prefs:updateUi requires 'value' (array)",
                    msg_id,
                )
            if key == "agentShortcuts":
                cleaned: list[JsonObject] = []
                shortcut_values = cast(list[object], value)
                if len(shortcut_values) > 64:
                    return await self.send_error("agentShortcuts max length is 64", msg_id)
                for idx, raw in enumerate(shortcut_values):
                    if not isinstance(raw, dict):
                        return await self.send_error(f"agentShortcuts[{idx}] must be an object", msg_id)
                    raw_dict = cast(JsonObject, raw)
                    shortcut_kind = raw_dict.get("kind")
                    if not isinstance(shortcut_kind, str):
                        return await self.send_error(
                            f"agentShortcuts[{idx}].kind must be a string",
                            msg_id,
                        )
                    shortcut_kind = shortcut_kind.strip().lower()
                    if shortcut_kind not in ("url", "framework_app"):
                        return await self.send_error(
                            f"agentShortcuts[{idx}].kind must be 'url' or 'framework_app'",
                            msg_id,
                        )

                    app_id = raw_dict.get("app_id")
                    app_id_clean = ""
                    if shortcut_kind == "framework_app":
                        if not isinstance(app_id, str) or not app_id.strip():
                            return await self.send_error(
                                f"agentShortcuts[{idx}].app_id is required for kind=framework_app",
                                msg_id,
                            )
                        app_id_clean = app_id.strip()
                    label = raw_dict.get("label")
                    url = raw_dict.get("url")
                    if not isinstance(label, str) or not label.strip():
                        return await self.send_error(f"agentShortcuts[{idx}].label is required", msg_id)
                    if not isinstance(url, str) or not url.strip():
                        return await self.send_error(f"agentShortcuts[{idx}].url is required", msg_id)
                    sid = raw_dict.get("id")
                    if isinstance(sid, str) and sid.strip():
                        sid = sid.strip()
                    else:
                        sid = f"sc_{idx}"
                    load = raw_dict.get("load")
                    if load is None or (isinstance(load, str) and not load.strip()):
                        load = "lazy"
                    elif isinstance(load, str):
                        load = load.strip().lower()
                        if load not in ("lazy", "eager"):
                            return await self.send_error(
                                f"agentShortcuts[{idx}].load must be 'lazy' or 'eager'",
                                msg_id,
                            )
                    else:
                        return await self.send_error(
                            f"agentShortcuts[{idx}].load must be 'lazy' or 'eager'",
                            msg_id,
                        )
                    icon = raw_dict.get("icon")
                    icon_clean: JsonObject | None = None
                    if icon is not None:
                        icon_dict = _as_json_object(icon)
                        if icon_dict is None:
                            return await self.send_error(f"agentShortcuts[{idx}].icon must be an object", msg_id)
                        icon_kind = icon_dict.get("kind")
                        if icon_kind == "emoji":
                            emoji = icon_dict.get("emoji")
                            if not isinstance(emoji, str) or not emoji.strip():
                                return await self.send_error(f"agentShortcuts[{idx}].icon.emoji is required", msg_id)
                            icon_clean = {"kind": "emoji", "emoji": emoji.strip()}
                        elif icon_kind == "asset":
                            name = icon_dict.get("name")
                            if not isinstance(name, str) or not name.strip():
                                return await self.send_error(f"agentShortcuts[{idx}].icon.name is required", msg_id)
                            icon_clean = {"kind": "asset", "name": name.strip()}
                        else:
                            return await self.send_error(
                                f"agentShortcuts[{idx}].icon.kind must be 'emoji' or 'asset'",
                                msg_id,
                            )
                    header_flag = raw_dict.get("header")
                    header_clean = bool(header_flag) if header_flag is not None else False
                    last_used = raw_dict.get("last_used")
                    last_used_clean = 0
                    if isinstance(last_used, (int, float)):
                        if last_used >= 0:
                            last_used_clean = int(last_used)
                    cleaned.append(
                        {
                            "id": sid,
                            "kind": shortcut_kind,
                            "app_id": app_id_clean,
                            "label": label.strip(),
                            "url": url.strip(),
                            "icon": icon_clean,
                            "load": load,
                            "header": header_clean,
                            "last_used": last_used_clean,
                        }
                    )
                value = cleaned
        else:
            return await self.send_error(
                "prefs:updateUi unsupported preference type",
                msg_id,
            )

        try:
            updated = cast(JsonObject, PREFERENCES_STORE.update_preferences(ui={key: value}))
        except Exception as e:
            logger.warning(f"Failed to update UI preference {key}: {e}")
            return await self.send_error(str(e), msg_id)

        ui_prefs = _as_json_object(updated.get("ui")) or {}
        await self.broadcast("prefs:setUi", {"ui": ui_prefs})

    async def handle_prefs_vendorAgentIcon(
        self,
        payload: JsonObject,
        msg_id: str | None,
    ) -> None:
        """Copy an icon asset into the global agent icon cache directory and return its name."""
        abs_path_obj = payload.get("abs_path") or payload.get("path")
        abs_path = abs_path_obj if isinstance(abs_path_obj, str) else None
        if not isinstance(abs_path, str) or not abs_path.strip():
            return await self.send_error("prefs:vendorAgentIcon requires abs_path", msg_id)

        src = Path(abs_path).expanduser()
        try:
            src = src.resolve(strict=True)
        except Exception:
            return await self.send_error(f"Icon file not found: {abs_path}", msg_id)

        if not src.is_file():
            return await self.send_error("Icon path is not a file", msg_id)

        ext = src.suffix.lower()
        if ext not in (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"):
            return await self.send_error("Unsupported icon type (svg/png/jpg/gif/webp)", msg_id)

        try:
            data = src.read_bytes()
        except Exception as e:
            return await self.send_error(f"Failed to read icon: {e}", msg_id)

        digest = hashlib.sha256(data).hexdigest()[:16]
        stem = src.stem
        safe_stem = "".join(ch for ch in stem if ch.isalnum() or ch in ("-", "_"))[:40] or "icon"
        name = f"{safe_stem}_{digest}{ext}"

        try:
            AGENT_ICON_DIR.mkdir(parents=True, exist_ok=True)
            dst = (AGENT_ICON_DIR / name).resolve()
            # Ensure dst stays within the icon dir.
            if AGENT_ICON_DIR.resolve() not in dst.parents:
                return await self.send_error("Invalid destination path", msg_id)
            if not dst.exists():
                tmp = dst.with_suffix(dst.suffix + ".tmp")
                tmp.write_bytes(data)
                tmp.replace(dst)
        except Exception as e:
            return await self.send_error(f"Failed to vendor icon: {e}", msg_id)

        url = f"/api/app/file_editor_cm6/agent_icons/{name}"
        await self.emit_personal("prefs:vendorAgentIconResult", {"ok": True, "name": name, "url": url}, msg_id)

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
        """Emit editor:cache_state via the editor Socket.IO for cleared drafts."""
        try:
            from .monaco_editor.editor_socketio import EDITOR_SIO
            editor_sio = cast(SocketIOEmitter, EDITOR_SIO)
            for rel in rel_files:
                abs_path = str(self.project_root / rel)
                await editor_sio.emit(
                    "editor:cache_state",
                    {
                        "path": abs_path,
                        "state": "clean",
                        "unsaved": False,
                        "reason": "discard_external",
                    },
                    namespace="/editor",
                )
        except Exception:
            pass

    async def handle_pulse_alive(self, payload: JsonObject, msg_id: str | None) -> None:
        """Handle client heartbeat response (silently)."""
        del payload, msg_id

    # ── Extension registry handlers ───────────────────────────────────

    async def handle_ext_list(self, payload: JsonObject, msg_id: str | None) -> None:
        """Return installed extensions + language slots."""
        del payload
        from . import extension_registry as extension_registry

        get_extension_list = cast(
            Callable[[], list[JsonObject]],
            extension_registry.get_extension_list,
        )
        get_language_slots = cast(
            Callable[[], JsonObject],
            extension_registry.get_language_slots,
        )
        await self.emit_personal(
            "ext:list",
            {
                "extensions": get_extension_list(),
                "language_slots": get_language_slots(),
            },
            msg_id,
        )

    async def handle_ext_install(self, payload: JsonObject, msg_id: str | None) -> None:
        """Install a VSIX extension and return the result + config schema."""
        from . import extension_registry as extension_registry

        install_extension = cast(
            Callable[[str], JsonObject],
            extension_registry.install_extension,
        )
        get_extension_config_schema = cast(
            Callable[[str], JsonObject],
            extension_registry.get_extension_config_schema,
        )
        vsix_path_obj = payload.get("vsix_path")
        vsix_path = vsix_path_obj if isinstance(vsix_path_obj, str) else ""
        if not vsix_path:
            return await self.send_error("vsix_path is required", msg_id)
        try:
            result = await asyncio.to_thread(install_extension, vsix_path)
            ext = _as_json_object(result.get("extension")) or {}
            ext_id_obj = ext.get("id")
            ext_id = ext_id_obj if isinstance(ext_id_obj, str) else ""
            config_schema = get_extension_config_schema(ext_id) if ext_id else {}
            registry_summary = _as_json_object(result.get("registry_summary")) or {}
            await self.emit_personal(
                "ext:installed",
                {
                    "ok": True,
                    "extension": ext,
                    "config_schema": config_schema,
                    "registry_summary": registry_summary,
                },
                msg_id,
            )
            # Kill code-server + adapter so ext host picks up the new extension
            await self._restart_code_server_and_adapter("ext_install")
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_uninstall(self, payload: JsonObject, msg_id: str | None) -> None:
        """Uninstall a user-installed extension."""
        from . import extension_registry as extension_registry

        uninstall_extension = cast(
            Callable[[str], JsonObject],
            extension_registry.uninstall_extension,
        )
        ext_id_obj = payload.get("ext_id")
        ext_id = ext_id_obj if isinstance(ext_id_obj, str) else ""
        if not ext_id:
            return await self.send_error("ext_id is required", msg_id)
        try:
            result = await asyncio.to_thread(uninstall_extension, ext_id)
            registry_summary = _as_json_object(result.get("registry_summary")) or {}
            await self.emit_personal(
                "ext:uninstalled",
                {
                    "ok": True,
                    "uninstalled_id": ext_id,
                    "registry_summary": registry_summary,
                },
                msg_id,
            )
            # Kill code-server + adapter so ext host drops the removed extension
            await self._restart_code_server_and_adapter("ext_uninstall")
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_configure(self, payload: JsonObject, msg_id: str | None) -> None:
        """Save configuration values for an extension and rebuild gate."""
        from . import extension_registry as extension_registry

        set_extension_config = cast(
            Callable[[str, JsonObject], JsonObject],
            extension_registry.set_extension_config,
        )
        ext_id_obj = payload.get("ext_id")
        ext_id = ext_id_obj if isinstance(ext_id_obj, str) else ""
        values_obj = payload.get("values")
        values = _as_json_object(values_obj)
        if values_obj is not None and values is None:
            return await self.send_error("values must be a JSON object", msg_id)
        if values is None:
            values = {}
        if not ext_id:
            return await self.send_error("ext_id is required", msg_id)
        try:
            set_extension_config(ext_id, values)
            await self.emit_personal("ext:configured", {
                "ok": True,
                "ext_id": ext_id,
            }, msg_id)
            # Kill adapter directly — settings need a reload to take effect
            await self._restart_adapter_only("ext_configure")
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_custom_settings_get(self, payload: JsonObject, msg_id: str | None) -> None:
        """Return user-defined custom settings JSON."""
        del payload
        from . import extension_registry as extension_registry

        get_custom_settings = cast(
            Callable[[], JsonObject],
            extension_registry.get_custom_settings,
        )
        await self.emit_personal(
            "ext:custom_settings_get",
            {
                "ok": True,
                "settings": get_custom_settings(),
            },
            msg_id,
        )

    async def handle_ext_custom_settings_set(self, payload: JsonObject, msg_id: str | None) -> None:
        """Save user-defined custom settings JSON and rebuild gate."""
        from . import extension_registry as extension_registry

        set_custom_settings = cast(
            Callable[[JsonObject], None],
            extension_registry.set_custom_settings,
        )
        settings_obj = payload.get("settings")
        settings = _as_json_object(settings_obj)
        if settings_obj is not None and settings is None:
            return await self.send_error("settings must be a JSON object", msg_id)
        if settings is None:
            settings = {}
        try:
            await asyncio.to_thread(set_custom_settings, settings)
            await self.emit_personal("ext:custom_settings_set", {
                "ok": True,
                "count": len(settings),
            }, msg_id)
            # Kill adapter directly — custom settings need a reload
            await self._restart_adapter_only("custom_settings")
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_workspace_settings_get(self, payload: JsonObject, msg_id: str | None) -> None:
        """Return workspace-scoped .vscode/settings.json for the active project."""
        del payload
        proj = str(self.project_root) if self.project_root else ""
        if not proj:
            return await self.emit_personal("ext:workspace_settings_get", {
                "ok": True, "settings": {}, "path": "",
            }, msg_id)
        settings_path = os.path.join(proj, ".vscode", "settings.json")
        settings: JsonObject = {}
        try:
            if os.path.isfile(settings_path):
                with open(settings_path, "r", encoding="utf-8") as f:
                    raw = _load_json_value(f.read())
                settings = _as_json_object(raw) or {}
        except Exception as e:
            logger.warning(f"[workspace_settings] read error: {e}")
        await self.emit_personal("ext:workspace_settings_get", {
            "ok": True,
            "settings": settings,
            "path": settings_path,
        }, msg_id)

    async def handle_ext_workspace_settings_set(self, payload: JsonObject, msg_id: str | None) -> None:
        """Save workspace-scoped .vscode/settings.json and restart adapter."""
        proj = str(self.project_root) if self.project_root else ""
        if not proj:
            return await self.send_error("No active project", msg_id)
        settings_obj = payload.get("settings")
        settings = _as_json_object(settings_obj)
        if settings_obj is not None and settings is None:
            return await self.send_error("settings must be a JSON object", msg_id)
        if settings is None:
            settings = {}
        settings_dir = os.path.join(proj, ".vscode")
        settings_path = os.path.join(settings_dir, "settings.json")
        try:
            os.makedirs(settings_dir, exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                f.write(json.dumps(settings, indent=2) + "\n")
            await self.emit_personal("ext:workspace_settings_set", {
                "ok": True,
                "count": len(settings),
                "path": settings_path,
            }, msg_id)
            # Adapter reload needed for extensions to see new workspace config
            await self._restart_adapter_only("workspace_settings")
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_toggle(self, payload: JsonObject, msg_id: str | None) -> None:
        """Activate/deactivate an extension or language slot."""
        from . import extension_registry as extension_registry

        toggle_extension = cast(
            Callable[[str, bool], JsonObject],
            extension_registry.toggle_extension,
        )
        toggle_language_slot = cast(
            Callable[[str, bool], JsonObject],
            extension_registry.toggle_language_slot,
        )
        ext_id_obj = payload.get("ext_id")
        ext_id = ext_id_obj if isinstance(ext_id_obj, str) else None
        lang_id_obj = payload.get("lang_id")
        lang_id = lang_id_obj if isinstance(lang_id_obj, str) else None
        active_obj = payload.get("active")
        active = active_obj if isinstance(active_obj, bool) else True
        try:
            if ext_id:
                toggle_extension(ext_id, active)
                await self.emit_personal("ext:toggled", {
                    "ok": True, "ext_id": ext_id, "active": active,
                }, msg_id)
                # Kill adapter only — code-server already has the files
                await self._restart_adapter_only("ext_toggle")
            elif lang_id:
                toggle_language_slot(lang_id, active)
                await self.emit_personal("ext:toggled", {
                    "ok": True, "lang_id": lang_id, "active": active,
                }, msg_id)
            else:
                await self.send_error("ext_id or lang_id is required", msg_id)
        except Exception as e:
            await self.send_error(str(e), msg_id)

    async def handle_ext_configSchema(self, payload: JsonObject, msg_id: str | None) -> None:
        """Return the configuration schema for an extension."""
        from . import extension_registry as extension_registry

        get_extension_config_schema = cast(
            Callable[[str], JsonObject],
            extension_registry.get_extension_config_schema,
        )
        ext_id_obj = payload.get("ext_id")
        ext_id = ext_id_obj if isinstance(ext_id_obj, str) else ""
        if not ext_id:
            return await self.send_error("ext_id is required", msg_id)
        schema = get_extension_config_schema(ext_id)
        await self.emit_personal("ext:configSchema", {
            "ext_id": ext_id,
            "schema": schema,
        }, msg_id)

    async def handle_ext_restart_adapter(self, payload: JsonObject, msg_id: str | None) -> None:
        """Manual restart of the workbench adapter from the UI."""
        del payload
        await self._restart_adapter_only("manual")
        await self.emit_personal("ext:adapter_restarted", {"ok": True}, msg_id)

    # ── Private restart helpers ──────────────────────────────────────────

    async def _restart_adapter_only(self, reason: str) -> None:
        """Kill adapter shell and notify frontend to reload iframe."""
        try:
            from .workbench_adapter_shell_manager import terminate_adapter_shell
            killed = await terminate_adapter_shell()
            print(f"[ext_restart] adapter terminated (reason={reason}, was_running={killed})", flush=True)
        except Exception as exc:
            print(f"[ext_restart] adapter terminate error: {exc}", flush=True)
        try:
            from .diagnostics_bridge import stop_bridge
            stop_bridge()
        except Exception:
            pass
        await self.emit_personal("ext:adapter_restarting", {"reason": reason})

    async def _restart_code_server_and_adapter(self, reason: str) -> None:
        """Kill both code-server and adapter, notify frontend."""
        try:
            from .workbench_adapter_shell_manager import terminate_adapter_shell
            await terminate_adapter_shell()
        except Exception as exc:
            print(f"[ext_restart] adapter terminate error: {exc}", flush=True)
        try:
            from .diagnostics_bridge import stop_bridge
            stop_bridge()
        except Exception:
            pass
        try:
            from .code_server_shell_manager import terminate_code_server_shell
            killed = await terminate_code_server_shell()
            print(f"[ext_restart] code-server terminated (reason={reason}, was_running={killed})", flush=True)
        except Exception as exc:
            print(f"[ext_restart] code-server terminate error: {exc}", flush=True)
        await self.emit_personal("ext:adapter_restarting", {"reason": reason, "full_restart": True})


# --- WebSocket Endpoint ---

async def explorer_websocket(websocket: WebSocket) -> None:
    # Dispatcher init now handles accept/connect logic partially, but we need to accept first
    # to read cookies/headers if needed, or just let dispatcher do it.
    # The dispatcher needs an accepted socket.
    # The dispatcher.initialize() is async.
    
    # Wait, dispatcher.__init__ is sync.
    # We should accept here.
    dispatcher = ExplorerDispatcher(websocket)
    # Connect logic in initialize() calls accept(), so we should NOT accept twice or ensure order.
    # Actually manager.connect calls accept().
    # Let's clean this up: standard pattern is endpoint accepts, then registers.
    
    # Correction: manager.connect calls accept(). 
    # But dispatcher is created with websocket.
    
    await dispatcher.initialize()
    
    try:
        while True:
            data = await websocket.receive_text()
            await dispatcher.handle_message(data)
    except WebSocketDisconnect:
        await dispatcher.cleanup()
    except Exception as e:
        logger.error(f"Explorer WebSocket error: {e}")
        await dispatcher.cleanup()


# --- Socket.IO Namespace Adapter ---


class ExplorerSocketIONamespace(_SocketIOAsyncNamespace):
    def __init__(self, namespace: str = "/explorer") -> None:
        super().__init__(namespace)
        self.dispatchers: dict[str, ExplorerDispatcher] = {}

    async def on_connect(self, sid: str, environ: dict[str, object]) -> None:
        del environ
        # Create dispatcher with Socket.IO shim
        ws = SocketIOSocketShim(self, sid)
        dispatcher = ExplorerDispatcher(ws)
        await dispatcher.initialize()
        self.dispatchers[sid] = dispatcher
        logger.info(f"[ExplorerSIO] client connected sid={sid}")

    async def on_disconnect(self, sid: str, reason: object | None = None) -> None:
        disp = self.dispatchers.pop(sid, None)
        if disp is not None:
            await disp.cleanup()
        logger.info(f"[ExplorerSIO] client disconnected sid={sid} reason={reason}")

    async def on_explorer_send(self, sid: str, data: object) -> None:
        disp = self.dispatchers.get(sid)
        if disp is None:
            return
        logger.info(f"[ExplorerSIO] recv sid={sid} data={data}")
        if isinstance(data, str):
            try:
                data = _load_json_value(data)
            except json.JSONDecodeError:
                return
        message_data = _as_json_object(data)
        if message_data is None:
            return
        await disp.handle_message_json(message_data)
