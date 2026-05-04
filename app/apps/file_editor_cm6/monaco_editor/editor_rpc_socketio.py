# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import cast

import socketio

from .editor_rpc_contract import (
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_INVALID_PARAMS,
    EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
    EDITOR_RPC_NOTIFICATION_STATE_SSOT,
    EditorRpcDispatchError,
    EditorRpcProtocolError,
    coerce_jsonrpc_notification_envelope,
    coerce_jsonrpc_request_envelope,
)
from .editor_rpc_dispatch import dispatch_editor_rpc_request
from .editor_rpc_emit import emit_editor_rpc_error, emit_editor_rpc_notification, emit_editor_rpc_result
from .editor_ws import (
    editor_runtime_active_project,
    editor_runtime_broadcast_active_file_update,
    editor_runtime_build_connect_snapshot,
    editor_runtime_emit_host_active_file_changed,
    editor_runtime_emit_room_event,
    editor_runtime_is_under_project,
    editor_runtime_meta,
    editor_runtime_normalize_abs_path,
    editor_runtime_notify_draft_state_changed,
    editor_runtime_read_file_payload,
    editor_runtime_record_save_sha,
    editor_runtime_set_last_file,
    editor_runtime_update_session_state,
)


class EditorRpcSocketIONamespace(socketio.AsyncNamespace):
    async def _emit_to_sid(self, sid: str, event_name: str, payload: dict[str, object]) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        await emit_to_room(event_name, payload, room=sid)

    async def on_connect(self, sid: str, environ: dict[str, object], auth: object) -> None:
        enter_room = cast(Callable[..., Awaitable[object]], self.enter_room)
        await enter_room(sid, "file_editor_cm6")
        snapshot = editor_runtime_build_connect_snapshot()
        await emit_editor_rpc_notification(
            lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
            EDITOR_RPC_NOTIFICATION_STATE_SSOT,
            snapshot,
        )
        current_path = snapshot.get("currentPath")
        project = snapshot.get("project")
        try:
            from ..workbench_adapter_shell_manager import get_adapter_state

            await emit_editor_rpc_notification(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
                get_adapter_state(),
            )
        except Exception:
            pass
        if isinstance(project, str) and isinstance(current_path, str) and current_path:
            try:
                await editor_runtime_broadcast_active_file_update(project, current_path)
                await editor_runtime_emit_host_active_file_changed(project, current_path, source="rpc_connect")
            except Exception:
                pass

    async def on_disconnect(self, sid: str, reason: object | None = None) -> None:
        try:
            leave_room = cast(Callable[..., Awaitable[object]], self.leave_room)
            await leave_room(sid, "file_editor_cm6")
        except Exception:
            pass

    async def on_rpc(self, sid: str, data: object) -> None:
        request_id: object = None
        try:
            request = coerce_jsonrpc_request_envelope(data)
            if request is None:
                notification = coerce_jsonrpc_notification_envelope(data)
                await dispatch_editor_rpc_request(
                    notification["method"],
                    notification["params"],
                    active_project=editor_runtime_active_project,
                    normalize_abs_path=editor_runtime_normalize_abs_path,
                    is_under_project=editor_runtime_is_under_project,
                    runtime_meta=editor_runtime_meta,
                    read_file_payload=editor_runtime_read_file_payload,
                    update_session_state=editor_runtime_update_session_state,
                    set_last_file=editor_runtime_set_last_file,
                    emit_to_room=editor_runtime_emit_room_event,
                    broadcast_active_file_update=editor_runtime_broadcast_active_file_update,
                    emit_host_active_file_changed=editor_runtime_emit_host_active_file_changed,
                    notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
                    record_save_sha=editor_runtime_record_save_sha,
                )
                return

            request_id = request["id"]
            result = await dispatch_editor_rpc_request(
                request["method"],
                request["params"],
                active_project=editor_runtime_active_project,
                normalize_abs_path=editor_runtime_normalize_abs_path,
                is_under_project=editor_runtime_is_under_project,
                runtime_meta=editor_runtime_meta,
                read_file_payload=editor_runtime_read_file_payload,
                update_session_state=editor_runtime_update_session_state,
                set_last_file=editor_runtime_set_last_file,
                emit_to_room=editor_runtime_emit_room_event,
                broadcast_active_file_update=editor_runtime_broadcast_active_file_update,
                emit_host_active_file_changed=editor_runtime_emit_host_active_file_changed,
                notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
                record_save_sha=editor_runtime_record_save_sha,
            )
            await emit_editor_rpc_result(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                request["id"],
                result,
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
        except Exception as exc:
            await emit_editor_rpc_error(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                None,
                JSONRPC_INTERNAL_ERROR,
                str(exc),
                data={"kind": "editor_rpc_internal"},
            )
