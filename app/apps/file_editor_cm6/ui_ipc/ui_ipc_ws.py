"""UI IPC Socket.IO namespace — thin relay for host/runtime UI communication.

The main page and native/sidebar UI clients consume the ``/ui_ipc`` namespace.
Editor-originated commands must enter through the editor-owned RPC namespace
and may be relayed here by backend hooks when the host page is the consumer.

Python only logs traffic for observability.

Console traffic is framework-owned by ``app.te2_console_runtime`` on
``/te2_console``; UI IPC does not relay ``console:*`` events.
Sidebar IPC only accepts typed JSON-RPC envelopes on the ``/sidebar_ipc``
namespace.
"""

import socketio

from . import sidebar_ws
from .rpc_contract import (
    UI_IPC_RPC_NAMESPACE,
    UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
    UI_IPC_RPC_NOTIFICATION_EVENT,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UiIpcRpcProtocolError,
    build_jsonrpc_error,
    build_jsonrpc_notification,
    build_jsonrpc_result,
    parse_ui_ipc_rpc_notification,
    parse_ui_ipc_rpc_request,
)
from .rpc_dispatch import dispatch_ui_ipc_rpc_request
from .sidebar_rpc_contract import SIDEBAR_IPC_RPC_NAMESPACE
from ..stores import get_history_store
from ..explorer.services.file_ops import get_project_root
from ..open_state_backend import read_sidecar_open_state


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


class UIIPCNamespace(socketio.AsyncNamespace):

    # python-socketio dispatches via 'on_' + event_name. Translate colons to
    # underscores for typed event names such as rpc.notify.
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
            except Exception:
                pass
            try:
                history = get_history_store()
                project = history.get_active_project() or str(get_project_root())
                if project:
                    open_state = read_sidecar_open_state(project, reason="reconnect")
                    current_path = open_state["openFile"]
                    rel = open_state["openFileRel"]
                    await self.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        build_jsonrpc_notification(
                            UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
                            dict(open_state),
                        ),
                        to=sid,
                    )
                    await self.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        build_jsonrpc_notification(
                            UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
                            {
                                "path": current_path,
                                "rel": rel,
                                "openState": dict(open_state),
                                "source": "ui_ipc_connect",
                            },
                        ),
                        to=sid,
                    )
            except Exception:
                pass
            try:
                from .sidebar_window_state import get_sidebar_window_state

                await self.emit(
                    UI_IPC_RPC_NOTIFICATION_EVENT,
                    build_jsonrpc_notification(
                        UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
                        get_sidebar_window_state(),
                    ),
                    to=sid,
                )
            except Exception:
                pass

    async def on_disconnect(self, sid, reason=None):
        room = "sidebar_ipc" if self.namespace == "/sidebar_ipc" else "ui_ipc"
        print(f"[{room}] disconnect sid={sid} reason={reason}", flush=True)
        await sidebar_ws.on_sidebar_disconnect(self, sid)

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

    async def on_rpc(self, sid, data):
        if self.namespace == SIDEBAR_IPC_RPC_NAMESPACE:
            return await sidebar_ws.on_sidebar_rpc(self, sid, data)
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
