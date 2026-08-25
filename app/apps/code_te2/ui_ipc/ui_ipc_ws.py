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

import asyncio
from collections.abc import Awaitable
from collections.abc import Mapping
from typing import Protocol, cast, override
from urllib.parse import parse_qs

import socketio
from socketio.exceptions import ConnectionRefusedError

from ..client_presentation import (
    client_presentation_identity_from_environ,
    client_presentation_room,
    normalize_client_instance_id,
)
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
    UI_IPC_RPC_NOTIFICATION_RUN_TARGET_ROUTES_CHANGED,
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
from ..socketio_runtime import emit_code_te2_socketio
from ..file_tabs_projection import (
    set_file_tabs_projection_emitter,
)

JsonObject = dict[str, object]
_BROWSER_CLIENT_BY_SID: dict[str, str] = {}


def list_ui_ipc_browser_clients() -> tuple[str, ...]:
    return tuple(sorted(set(_BROWSER_CLIENT_BY_SID.values())))


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


def _native_client_identity(environ: object) -> tuple[str, str, str | None]:
    if not isinstance(environ, Mapping):
        return "", "", None
    raw_environ = cast(Mapping[object, object], environ)
    query_string = str(raw_environ.get("QUERY_STRING") or "")
    query = parse_qs(query_string, keep_blank_values=False)
    source = str((query.get("source") or [""])[0]).strip()
    if source not in {"android_native", "electron_native"}:
        return "", "", None
    client_id = str((query.get("client_id") or [""])[0]).strip()
    raw_presentation_id = str(
        (query.get("presentation_client_id") or [""])[0]
    ).strip()
    presentation_id = normalize_client_instance_id(raw_presentation_id)
    if raw_presentation_id and presentation_id is None:
        raise ValueError("invalid_native_presentation_client_id")
    return source, client_id[:128], presentation_id


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
    client_instance_id: str | None = None,
) -> None:
    envelope = _encode_ui_ipc_notification(method, params)
    target_room = (
        client_presentation_room(client_instance_id)
        if client_instance_id is not None
        else room
    )
    if to_sid:
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            to=to_sid,
        )
    else:
        await emit_code_te2_socketio(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            envelope,
            namespace="/ui_ipc",
            room=target_room,
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


async def _emit_browser_connect_adapter_state(
    ns: SocketIONamespace,
    sid: str,
) -> None:
    try:
        from ..workbench_adapter_shell_manager import get_adapter_state

        await ns.emit(
            UI_IPC_RPC_NOTIFICATION_EVENT,
            _encode_ui_ipc_notification(
                UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
                _json_object(get_adapter_state()),
            ),
            to=sid,
        )
    except Exception as exc:
        print(f"[ui_ipc] adapter connect projection failed sid={sid}: {exc}", flush=True)


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
        try:
            native_source, native_client_id, native_presentation_id = (
                _native_client_identity(environ)
            )
        except ValueError as exc:
            raise ConnectionRefusedError(str(exc)) from exc
        if room == "ui_ipc":
            try:
                require_msgpack_v1_auth(auth)
            except FrontendRpcCodecError as exc:
                raise ConnectionRefusedError(str(exc)) from exc
        await ns.enter_room(sid_text, room)
        browser_identity = None
        if room == "ui_ipc" and not native_source:
            try:
                browser_identity = client_presentation_identity_from_environ(environ)
            except ValueError as exc:
                raise ConnectionRefusedError(str(exc)) from exc
            assert browser_identity is not None
            _BROWSER_CLIENT_BY_SID[sid_text] = browser_identity["clientInstanceId"]
            await ns.enter_room(
                sid_text,
                client_presentation_room(browser_identity["clientInstanceId"]),
            )
            await ns.save_session(
                sid_text,
                {
                    "source": "browser",
                    "clientId": browser_identity["clientInstanceId"],
                    "windowId": browser_identity["windowId"],
                    "clientRole": browser_identity["clientRole"],
                },
            )
        if room == "ui_ipc" and native_source:
            await ns.enter_room(sid_text, "ui_ipc_native")
            if native_presentation_id is not None:
                await ns.enter_room(
                    sid_text,
                    client_presentation_room(native_presentation_id),
                )
            await ns.save_session(
                sid_text,
                {
                    "source": native_source,
                    "clientId": native_client_id,
                    "presentationClientId": native_presentation_id,
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
        if room == "ui_ipc" and not native_source:
            # The Socket.IO connect acknowledgement must not wait for disk-backed
            # host/sidebar/run-profile snapshots. Browser boot/reconnect owns one
            # explicit snapshot request after the transport becomes usable.
            _ = asyncio.create_task(
                _emit_browser_connect_adapter_state(ns, sid_text),
                name="code_te2_ui_ipc_connect_projection",
            )

    async def on_disconnect(self, sid: object, reason: object | None = None) -> None:
        sid_text = _sid(sid)
        _BROWSER_CLIENT_BY_SID.pop(sid_text, None)
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

            raw_session = await ns.get_session(sid_text)
            session = _json_object(raw_session)
            client_instance_id = str(session.get("clientId") or "").strip()
            params = dict(parsed_request["params"])
            if session.get("source") == "browser":
                params["clientInstanceId"] = client_instance_id
                params["windowId"] = session.get("windowId")
                params["clientRole"] = session.get("clientRole")
            result = await dispatch_ui_ipc_rpc_request(
                parsed_request["method"],
                params,
                source_name=client_instance_id or "ui_ipc_rpc",
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
