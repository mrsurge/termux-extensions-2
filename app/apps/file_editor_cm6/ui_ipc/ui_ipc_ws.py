# pyright: strict, reportMissingTypeStubs=false
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

from __future__ import annotations

from collections.abc import Awaitable
from collections.abc import Mapping
from typing import Protocol, cast, override
from urllib.parse import parse_qs

import socketio
from socketio.exceptions import ConnectionRefusedError

from ..frontend_rpc_codec import (
    FrontendRpcCodecError,
    decode_frontend_rpc_message,
    encode_frontend_rpc_message,
    require_msgpack_v1_auth,
)
from . import sidebar_ws
from .rpc_contract import (
    UI_IPC_RPC_NAMESPACE,
    UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
    UI_IPC_RPC_NOTIFICATION_EVENT,
    UI_IPC_RPC_NOTIFICATION_FILE_TABS_DECORATIONS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
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
from ..host.run_target_service import set_run_target_routes_emitter
from ..stores import get_history_store
from ..explorer.services.file_ops import get_project_root
from ..open_state_backend import read_sidecar_open_state
from ..file_tabs_projection import (
    build_file_tabs_projection,
    set_file_tabs_projection_emitter,
)

JsonObject = dict[str, object]


class SocketIOServer(Protocol):
    def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        skip_sid: str | None = None,
        namespace: str | None = None,
    ) -> Awaitable[None]: ...


class SocketIONamespace(Protocol):
    namespace: str

    def emit(
        self,
        event: str,
        data: object | None = None,
        *,
        to: str | None = None,
        room: str | None = None,
        skip_sid: str | None = None,
        namespace: str | None = None,
    ) -> Awaitable[None]: ...

    def enter_room(self, sid: str, room: str) -> Awaitable[None]: ...

    def save_session(self, sid: str, session: JsonObject) -> Awaitable[None]: ...

    def get_session(self, sid: str) -> Awaitable[object]: ...

    def trigger_event(self, event: str, *args: object) -> Awaitable[object | None]: ...


class SocketIOEventHandler(Protocol):
    def __call__(self, *args: object) -> Awaitable[object | None]: ...


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _sid(value: object) -> str:
    return str(value or "")


def _native_client_identity(environ: object) -> tuple[str, str]:
    if not isinstance(environ, Mapping):
        return "", ""
    raw_environ = cast(Mapping[object, object], environ)
    query_string = str(raw_environ.get("QUERY_STRING") or "")
    query = parse_qs(query_string, keep_blank_values=False)
    source = str((query.get("source") or [""])[0]).strip()
    if source not in {"android_native", "electron_native"}:
        return "", ""
    client_id = str((query.get("client_id") or [""])[0]).strip()
    return source, client_id[:128]


def _namespace(ns: object) -> SocketIONamespace:
    return cast(SocketIONamespace, ns)


def _encode_ui_ipc_envelope(envelope: object, *, method: str | None = None) -> bytes:
    return encode_frontend_rpc_message(envelope, lane="ui_ipc", method=method)


def _encode_ui_ipc_notification(method: str, params: JsonObject) -> bytes:
    return _encode_ui_ipc_envelope(build_jsonrpc_notification(method, params), method=method)


async def emit_ui_ipc_rpc_notification(
    method: str,
    params: JsonObject,
    *,
    skip_sid: str | None = None,
    to_sid: str | None = None,
    room: str = "ui_ipc",
) -> None:
    from .ui_ipc_socketio import UI_IPC_SIO

    envelope = _encode_ui_ipc_notification(method, params)
    sio = cast(SocketIOServer, UI_IPC_SIO)
    if to_sid:
        await sio.emit(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            to=to_sid,
        )
    else:
        await sio.emit(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            room=room,
            skip_sid=skip_sid,
        )


async def _emit_run_target_routes_to_native(projection: JsonObject) -> None:
    await emit_ui_ipc_rpc_notification(
        UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
        projection,
        room="ui_ipc_native",
    )


set_run_target_routes_emitter(_emit_run_target_routes_to_native)
set_file_tabs_projection_emitter(emit_ui_ipc_rpc_notification)


class UIIPCNamespace(socketio.AsyncNamespace):

    # python-socketio dispatches via 'on_' + event_name. Translate colons to
    # underscores for typed event names such as rpc.notify.
    @override
    async def trigger_event(self, event: str, *args: object) -> object | None:
        normalized = event.replace(':', '_') if event else event
        handler_name = 'on_' + (normalized or '')
        handler = cast(SocketIOEventHandler | None, getattr(self, handler_name, None))
        if handler:
            return await handler(*args)
        return await _namespace(super()).trigger_event(event, *args)

    async def on_connect(self, sid: object, environ: object, auth: object | None = None) -> None:
        sid_text = _sid(sid)
        ns = _namespace(self)
        room = "sidebar_ipc" if ns.namespace == "/sidebar_ipc" else "ui_ipc"
        native_source, native_client_id = _native_client_identity(environ)
        if room == "ui_ipc":
            try:
                require_msgpack_v1_auth(auth)
            except FrontendRpcCodecError as exc:
                raise ConnectionRefusedError(str(exc)) from exc
        await ns.enter_room(sid_text, room)
        if room == "ui_ipc" and native_source:
            await ns.enter_room(sid_text, "ui_ipc_native")
            await ns.save_session(
                sid_text,
                {
                    "source": native_source,
                    "clientId": native_client_id,
                },
            )
            try:
                from ..host.run_target_service import emit_run_target_routes_snapshot

                async def emit_native_snapshot(projection: JsonObject) -> None:
                    await ns.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        _encode_ui_ipc_notification(
                            UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
                            projection,
                        ),
                        to=sid_text,
                    )

                await emit_run_target_routes_snapshot(emit_native_snapshot)
            except Exception as exc:
                error_message = (
                    f"[ui_ipc] rejecting native sid={sid_text}: "
                    + f"run-target projection unavailable: {exc}"
                )
                print(error_message, flush=True)
                raise ConnectionRefusedError(
                    "Native run-target projection is unavailable"
                ) from exc
        print(f"[{room}] connect sid={sid_text}", flush=True)
        # Push current adapter state to the newly connected client.
        if room == "ui_ipc":
            try:
                from ..workbench_adapter_shell_manager import get_adapter_state
                state = _json_object(get_adapter_state())
                await ns.emit(
                    UI_IPC_RPC_NOTIFICATION_EVENT,
                    _encode_ui_ipc_notification(UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE, state),
                    to=sid_text,
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
                    await ns.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        _encode_ui_ipc_notification(
                            UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
                            dict(open_state),
                        ),
                        to=sid_text,
                    )
                    await ns.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        _encode_ui_ipc_notification(
                            UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
                            {
                                "path": current_path,
                                "rel": rel,
                                "openState": dict(open_state),
                                "source": "ui_ipc_connect",
                            },
                        ),
                        to=sid_text,
                    )
                    file_tabs = await build_file_tabs_projection(project)
                    await ns.emit(
                        UI_IPC_RPC_NOTIFICATION_EVENT,
                        _encode_ui_ipc_notification(
                            UI_IPC_RPC_NOTIFICATION_FILE_TABS_DECORATIONS_CHANGED,
                            file_tabs,
                        ),
                        to=sid_text,
                    )
            except Exception:
                pass
            try:
                from .sidebar_window_state import get_sidebar_window_state

                await ns.emit(
                    UI_IPC_RPC_NOTIFICATION_EVENT,
                    _encode_ui_ipc_notification(
                        UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
                        _json_object(get_sidebar_window_state()),
                    ),
                    to=sid_text,
                )
            except Exception:
                pass
            try:
                from ..run_profile_state import build_run_profile_state_projection

                run_profile_state = await build_run_profile_state_projection()
                await ns.emit(
                    UI_IPC_RPC_NOTIFICATION_EVENT,
                    _encode_ui_ipc_notification(
                        UI_IPC_RPC_NOTIFICATION_RUN_PROFILE_STATE_CHANGED,
                        run_profile_state,
                    ),
                    to=sid_text,
                )
            except Exception:
                pass

    async def on_disconnect(self, sid: object, reason: object | None = None) -> None:
        sid_text = _sid(sid)
        ns = _namespace(self)
        room = "sidebar_ipc" if ns.namespace == "/sidebar_ipc" else "ui_ipc"
        print(f"[{room}] disconnect sid={sid_text} reason={reason}", flush=True)
        await sidebar_ws.on_sidebar_disconnect(ns, sid_text)

    async def _emit_ui_ipc_rpc_notification(
        self,
        method: str,
        params: JsonObject,
        *,
        skip_sid: str | None = None,
    ) -> None:
        await _namespace(self).emit(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            _encode_ui_ipc_notification(method, params),
            room="ui_ipc",
            skip_sid=skip_sid,
        )

    async def on_rpc(self, sid: object, data: object) -> object | None:
        sid_text = _sid(sid)
        ns = _namespace(self)
        if ns.namespace == SIDEBAR_IPC_RPC_NAMESPACE:
            return await sidebar_ws.on_sidebar_rpc(ns, sid_text, data)
        if ns.namespace != UI_IPC_RPC_NAMESPACE:
            return build_jsonrpc_error(
                request_id=None,
                code=-32600,
                message="UI IPC RPC is only available on /ui_ipc",
            )

        try:
            decoded = decode_frontend_rpc_message(data, lane="ui_ipc")
        except FrontendRpcCodecError as exc:
            return _encode_ui_ipc_envelope(
                build_jsonrpc_error(
                    request_id=None,
                    code=-32700,
                    message=str(exc),
                )
            )

        try:
            parsed_request = parse_ui_ipc_rpc_request(decoded)
            if parsed_request is None:
                notification = parse_ui_ipc_rpc_notification(decoded)
                await self._emit_ui_ipc_rpc_notification(
                    notification["method"],
                    notification["params"],
                    skip_sid=sid_text,
                )
                return None

            result = await dispatch_ui_ipc_rpc_request(
                parsed_request["method"],
                parsed_request["params"],
                source_name="ui_ipc_rpc",
            )
            return _encode_ui_ipc_envelope(
                build_jsonrpc_result(parsed_request["request_id"], result),
                method=parsed_request["method"],
            )
        except UiIpcRpcProtocolError as exc:
            return _encode_ui_ipc_envelope(exc.to_json())
        except Exception as exc:
            return _encode_ui_ipc_envelope(
                build_jsonrpc_error(
                    request_id=None,
                    code=-32603,
                    message=str(exc),
                )
            )
