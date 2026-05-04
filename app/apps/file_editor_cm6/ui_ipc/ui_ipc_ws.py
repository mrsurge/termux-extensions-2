"""UI IPC Socket.IO namespace — thin relay for host/runtime UI communication.

The main page and native/sidebar UI clients consume the ``/ui_ipc`` namespace.
Editor-originated commands must enter through the editor-owned RPC namespace
and may be relayed here by backend hooks when the host page is the consumer.

Python only logs traffic for observability.

Console events (``console:*``) are delegated to ``console_ws`` handlers.
Sidebar events (``sidebar:*``) are delegated to ``sidebar_ws`` handlers.
"""

import socketio
import time
from urllib.parse import parse_qs

from . import console_ws
from . import sidebar_ws
from .rpc_contract import (
    UI_IPC_RPC_NAMESPACE,
    UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR,
    UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE,
    UI_IPC_RPC_NOTIFICATION_EVENT,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
    UiIpcRpcProtocolError,
    build_jsonrpc_error,
    build_jsonrpc_notification,
    build_jsonrpc_result,
    parse_ui_ipc_rpc_notification,
    parse_ui_ipc_rpc_request,
)
from .rpc_dispatch import dispatch_ui_ipc_rpc_request
from ..stores import get_history_store
from ..explorer.services.file_ops import get_project_root
from ..explorer.transport.connection_manager import abs_to_rel

_LEGACY_UI_EVENT_SIDS: set[str] = set()


def _legacy_ui_event_payload_for_notification(
    method: str,
    params: dict[str, object],
) -> dict[str, object] | None:
    if method == UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE:
        return {"type": "save"}
    if method == UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS:
        return {"type": "focus"}
    if method == UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR:
        return {"type": "blur"}
    if method == UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE:
        return {"type": "adapter_state", **params}
    if method == UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED:
        return {"type": "active_file_changed", **params}
    return None


async def emit_ui_ipc_rpc_notification(
    method: str,
    params: dict[str, object],
    *,
    skip_sid: str | None = None,
    to_sid: str | None = None,
) -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    envelope = build_jsonrpc_notification(method, params)
    if to_sid:
      await UI_IPC_SIO.emit(
          UI_IPC_RPC_NOTIFICATION_EVENT,
          envelope,
          namespace="/ui_ipc",
          to=to_sid,
      )
    else:
      await UI_IPC_SIO.emit(
          UI_IPC_RPC_NOTIFICATION_EVENT,
          envelope,
          namespace="/ui_ipc",
          room="ui_ipc",
          skip_sid=skip_sid,
      )

    legacy_payload = _legacy_ui_event_payload_for_notification(method, params)
    if legacy_payload is None:
        return
    for target_sid in list(_LEGACY_UI_EVENT_SIDS):
        if skip_sid and target_sid == skip_sid:
            continue
        if to_sid and target_sid != to_sid:
            continue
        try:
            await UI_IPC_SIO.emit(
                "ui_event",
                legacy_payload,
                namespace="/ui_ipc",
                to=target_sid,
            )
        except Exception:
            pass


class UIIPCNamespace(socketio.AsyncNamespace):

    # python-socketio dispatches via 'on_' + event_name, but colons in
    # event names (e.g. 'console:log') produce 'on_console:log' which
    # can't be a Python method name.  Translate colons to underscores.
    async def trigger_event(self, event, *args):
        normalized = event.replace(':', '_') if event else event
        handler_name = 'on_' + (normalized or '')
        handler = getattr(self, handler_name, None)
        if handler:
            return await handler(*args)
        return await super().trigger_event(event, *args)

    async def on_connect(self, sid, environ):
        room = "sidebar_ipc" if self.namespace == "/sidebar_ipc" else "ui_ipc"
        await self.enter_room(sid, room)
        print(f"[{room}] connect sid={sid}", flush=True)
        query_string = ""
        try:
            query_string = str((environ or {}).get("QUERY_STRING") or "")
        except Exception:
            query_string = ""
        source = parse_qs(query_string).get("source", [""])[0].strip()
        if room == "ui_ipc" and source == "gecko_native":
            _LEGACY_UI_EVENT_SIDS.add(sid)
        # Push current adapter state to the newly connected client.
        if room == "ui_ipc":
            try:
                from ..workbench_adapter_shell_manager import get_adapter_state
                state = get_adapter_state()
                await self.emit(
                    UI_IPC_RPC_NOTIFICATION_EVENT,
                    build_jsonrpc_notification(UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE, state),
                    to=sid,
                )
                if sid in _LEGACY_UI_EVENT_SIDS:
                    await self.emit("ui_event", {"type": "adapter_state", **state}, to=sid)
            except Exception:
                pass
            try:
                history = get_history_store()
                session_state = history.get_session_state() or {}
                current_path = str(session_state.get("currentPath") or "").strip()
                project = history.get_active_project() or str(get_project_root())
                if current_path and project:
                    rel = abs_to_rel(current_path, project)
                    await self.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        build_jsonrpc_notification(
                            UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
                            {
                                "path": current_path,
                                "rel": rel,
                                "source": "ui_ipc_connect",
                            },
                        ),
                        to=sid,
                    )
                    if sid in _LEGACY_UI_EVENT_SIDS:
                        await self.emit(
                            "ui_event",
                            {
                                "type": "active_file_changed",
                                "path": current_path,
                                "rel": rel,
                                "source": "ui_ipc_connect",
                            },
                            to=sid,
                        )
            except Exception:
                pass

    async def on_disconnect(self, sid, reason=None):
        room = "sidebar_ipc" if self.namespace == "/sidebar_ipc" else "ui_ipc"
        print(f"[{room}] disconnect sid={sid} reason={reason}", flush=True)
        _LEGACY_UI_EVENT_SIDS.discard(sid)
        if self.namespace == "/ui_ipc":
            await console_ws.on_console_disconnect(self, sid)
        await sidebar_ws.on_sidebar_disconnect(self, sid)

    async def _emit_legacy_ui_event_compat(
        self,
        payload: dict[str, object],
        *,
        skip_sid: str | None = None,
    ) -> None:
        for target_sid in list(_LEGACY_UI_EVENT_SIDS):
            if skip_sid and target_sid == skip_sid:
                continue
            try:
                await self.emit("ui_event", payload, to=target_sid)
            except Exception:
                pass

    async def _emit_ui_ipc_rpc_notification(
        self,
        method: str,
        params: dict[str, object],
        *,
        skip_sid: str | None = None,
    ) -> None:
        await self.emit(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            build_jsonrpc_notification(method, params),
            room="ui_ipc",
            skip_sid=skip_sid,
        )
        legacy_payload = _legacy_ui_event_payload_for_notification(method, params)
        if legacy_payload is not None:
            await self._emit_legacy_ui_event_compat(legacy_payload, skip_sid=skip_sid)

    async def on_rpc(self, sid, data):
        if self.namespace != UI_IPC_RPC_NAMESPACE:
            return build_jsonrpc_error(
                request_id=None,
                code=-32600,
                message="UI IPC RPC is only available on /ui_ipc",
            )

        try:
            parsed_request = parse_ui_ipc_rpc_request(data)
            if parsed_request is None:
                notification = parse_ui_ipc_rpc_notification(data)
                await self._emit_ui_ipc_rpc_notification(
                    notification["method"],
                    notification["params"],
                    skip_sid=sid,
                )
                return None

            result = await dispatch_ui_ipc_rpc_request(
                parsed_request["method"],
                parsed_request["params"],
                source_name="ui_ipc_rpc",
            )
            return build_jsonrpc_result(parsed_request["request_id"], result)
        except UiIpcRpcProtocolError as exc:
            return exc.to_json()
        except Exception as exc:
            return build_jsonrpc_error(
                request_id=None,
                code=-32603,
                message=str(exc),
            )

    async def on_ui_event(self, sid, data):
        """Generic UI event relay.

        Clients send ``{type: "focus"|"save"|"menuClose"|..., ...}``.
        The server logs and rebroadcasts to all other clients in the room.
        """
        if self.namespace != "/ui_ipc":
            return None
        event_type = data.get("type", "unknown") if isinstance(data, dict) else "unknown"
        print(f"[ui_ipc] {event_type} from={sid} ts={int(time.time()*1000)}", flush=True)
        # Temporary Android compatibility only.
        await self._emit_legacy_ui_event_compat(data if isinstance(data, dict) else {"type": "unknown"}, skip_sid=sid)

    # ─── Console event delegation ──────────────────────────────

    async def on_console_register(self, sid, data):
        await console_ws.on_console_register(self, sid, data)

    async def on_console_unregister(self, sid, data):
        await console_ws.on_console_unregister(self, sid, data)

    async def on_console_log(self, sid, data):
        await console_ws.on_console_log(self, sid, data)

    async def on_console_eval(self, sid, data):
        await console_ws.on_console_eval(self, sid, data)

    async def on_console_evalResult(self, sid, data):
        await console_ws.on_console_eval_result(self, sid, data)

    async def on_console_replay(self, sid, data):
        await console_ws.on_console_replay(self, sid, data)

    async def on_console_clear(self, sid, data):
        await console_ws.on_console_clear(self, sid, data)

    # ─── Sidebar event delegation ──────────────────────────────

    async def on_sidebar_register(self, sid, data):
        await sidebar_ws.on_sidebar_register(self, sid, data)

    async def on_sidebar_event(self, sid, data):
        await sidebar_ws.on_sidebar_event(self, sid, data)

    async def on_sidebar_agent_edit(self, sid, data):
        await sidebar_ws.on_sidebar_agent_edit(self, sid, data)

    async def on_sidebar_agent_open(self, sid, data):
        await sidebar_ws.on_sidebar_agent_open(self, sid, data)

    async def on_sidebar_cwd_get(self, sid, data):
        return await sidebar_ws.on_sidebar_cwd_get(self, sid, data)

    async def on_sidebar_cwd_set(self, sid, data):
        return await sidebar_ws.on_sidebar_cwd_set(self, sid, data)

    async def on_sidebar_mention(self, sid, data):
        await sidebar_ws.on_sidebar_mention(self, sid, data)
