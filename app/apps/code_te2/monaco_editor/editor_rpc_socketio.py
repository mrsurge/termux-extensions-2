# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import cast

import socketio
from socketio.exceptions import ConnectionRefusedError

from ..frontend_rpc_codec import (
    FrontendRpcCodecError,
    decode_frontend_rpc_message,
    require_msgpack_v1_auth,
)
from ..client_presentation import (
    client_presentation_identity_from_environ,
    client_presentation_room,
)
from .editor_session_service import (
    EditorNotification,
    bootstrap_editor_session,
    publish_editor_result,
)
from .editor_rpc_contract import (
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_INVALID_PARAMS,
    EditorRpcDispatchError,
    EditorRpcProtocolError,
    coerce_jsonrpc_notification_envelope,
    coerce_jsonrpc_request_envelope,
)
from .editor_runtime_dispatch import dispatch_editor_runtime_request
from .editor_client_registry import (
    editor_client_identity,
    register_editor_client,
    unregister_editor_client,
)
from .editor_rpc_emit import emit_editor_rpc_error, emit_editor_rpc_notification, emit_editor_rpc_result
from .editor_ws import editor_runtime_build_connect_snapshot, editor_runtime_emit_open_state_changed


class EditorRpcSocketIONamespace(socketio.AsyncNamespace):
    async def _emit_to_sid(self, sid: str, event_name: str, payload: bytes) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        _ = await emit_to_room(event_name, payload, room=sid)

    async def _emit_to_room(self, room: str, event_name: str, payload: bytes) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        _ = await emit_to_room(event_name, payload, room=room)

    async def _deliver_notification(self, sid: str, notification: EditorNotification) -> None:
        # Resolve logical recipients only at the transport edge. The service
        # never constructs rooms or reaches into Socket.IO connection state.
        room = (
            client_presentation_room(self._client_id(sid))
            if notification.recipient == "client" else sid
        )
        await emit_editor_rpc_notification(
            lambda event, payload: self._emit_to_room(room, event, payload),
            notification.method,
            notification.params,
        )

    async def on_connect(
        self,
        sid: str,
        environ: dict[str, object],
        auth: object | None = None,
    ) -> None:
        try:
            require_msgpack_v1_auth(auth)
        except FrontendRpcCodecError as exc:
            raise ConnectionRefusedError(str(exc)) from exc
        try:
            identity = client_presentation_identity_from_environ(environ)
        except ValueError as exc:
            raise ConnectionRefusedError(str(exc)) from exc
        assert identity is not None
        register_editor_client(sid, identity)
        enter_room = cast(Callable[..., Awaitable[object]], self.enter_room)
        _ = await enter_room(sid, "code_te2")
        _ = await enter_room(sid, client_presentation_room(identity["clientInstanceId"]))
        def read_adapter_state() -> dict[str, object]:
            from ..workbench_adapter_shell_manager import get_adapter_state

            return get_adapter_state()

        await bootstrap_editor_session(
            client_instance_id=identity["clientInstanceId"],
            client_role=identity["clientRole"],
            read_snapshot=editor_runtime_build_connect_snapshot,
            read_adapter_state=read_adapter_state,
            publish_open_state=editor_runtime_emit_open_state_changed,
            deliver=lambda notification: self._deliver_notification(sid, notification),
        )

    async def on_disconnect(self, sid: str, reason: object | None = None) -> None:
        del reason
        identity = unregister_editor_client(sid)
        try:
            leave_room = cast(Callable[..., Awaitable[object]], self.leave_room)
            _ = await leave_room(sid, "code_te2")
            if identity is not None:
                _ = await leave_room(
                    sid,
                    client_presentation_room(identity["clientInstanceId"]),
                )
        except Exception:
            pass

    def _client_id(self, sid: str) -> str:
        identity = editor_client_identity(sid)
        if identity is None:
            raise EditorRpcProtocolError(JSONRPC_INVALID_PARAMS, "client_identity_missing")
        return identity["clientInstanceId"]

    async def on_rpc(self, sid: str, data: object) -> None:
        request_id: object = None
        try:
            decoded = decode_frontend_rpc_message(data, lane="editor")
        except FrontendRpcCodecError as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                -32700,
                str(exc),
            )
            return
        source_client = self._client_id(sid)

        try:
            request = coerce_jsonrpc_request_envelope(decoded)
            if request is None:
                notification = coerce_jsonrpc_notification_envelope(decoded)
                _ = await dispatch_editor_runtime_request(
                    notification["method"], notification["params"], source_client=source_client,
                )
                return

            request_id = request["id"]
            result = await dispatch_editor_runtime_request(
                request["method"], request["params"], source_client=source_client,
            )
            await publish_editor_result(
                method=request["method"],
                request_id=request["id"],
                result=result,
                deliver=lambda notification: self._deliver_notification(sid, notification),
                reply=lambda request_id, result: emit_editor_rpc_result(
                    lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                    request_id,
                    result,
                ),
            )
        except EditorRpcProtocolError as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                exc.code,
                exc.message,
                data=exc.data,
            )
        except EditorRpcDispatchError as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                request_id if isinstance(request_id, (str, int)) else None,
                exc.code,
                exc.message,
                data=exc.data,
            )
        except ValueError as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                JSONRPC_INVALID_PARAMS,
                str(exc),
            )
        except PermissionError as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                JSONRPC_INVALID_PARAMS,
                str(exc),
            )
        except Exception as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                JSONRPC_INTERNAL_ERROR,
                str(exc),
                data={"kind": "editor_rpc_internal"},
            )
