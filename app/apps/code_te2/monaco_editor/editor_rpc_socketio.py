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
    ClientPresentationIdentity,
    client_presentation_identity_from_environ,
    client_presentation_room,
)
from ..open_state_backend import SidecarOpenStatePayload
from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_DRAFT_DIFF_GET,
    EDITOR_RPC_METHOD_GIT_BASELINES_GET,
    EDITOR_RPC_METHOD_JUMP_TO_LINE,
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_INVALID_PARAMS,
    EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
    EDITOR_RPC_NOTIFICATION_DRAFT_DIFF,
    EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
    EDITOR_RPC_NOTIFICATION_GIT_BASELINES,
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
    editor_runtime_build_connect_snapshot,
    editor_runtime_emit_open_state_changed,
    editor_runtime_emit_room_event,
    editor_runtime_get_cached_document,
    editor_runtime_git_head_text,
    editor_runtime_handle_breadcrumb_navigate,
    editor_runtime_handle_issues_dump_response,
    editor_runtime_handle_model_ready,
    editor_runtime_handle_scroll_state,
    editor_runtime_is_under_project,
    editor_runtime_meta,
    editor_runtime_normalize_abs_path,
    editor_runtime_notify_draft_state_changed,
    editor_runtime_read_disk_text,
    editor_runtime_read_file_payload,
    editor_runtime_record_file_activity,
    editor_runtime_record_sidecar_open_file,
    editor_runtime_record_save_sha,
    editor_runtime_resolve_save_snapshot_response,
)


class EditorRpcSocketIONamespace(socketio.AsyncNamespace):
    _client_identity_by_sid: dict[str, ClientPresentationIdentity] = {}

    async def _emit_to_sid(self, sid: str, event_name: str, payload: bytes) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        await emit_to_room(event_name, payload, room=sid)

    async def _emit_to_room(self, room: str, event_name: str, payload: bytes) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        await emit_to_room(event_name, payload, room=room)

    async def _publish_result_notification(self, sid: str, method: str, result: object) -> None:
        if not isinstance(result, dict):
            return
        payload = cast(dict[str, object], result)
        if method == EDITOR_RPC_METHOD_JUMP_TO_LINE:
            await emit_editor_rpc_notification(
                lambda event_name, notification_payload: self._emit_to_room(
                    client_presentation_room(self._client_id(sid)),
                    event_name,
                    notification_payload,
                ),
                EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE,
                payload,
            )
            return
        if method == EDITOR_RPC_METHOD_GIT_BASELINES_GET:
            await emit_editor_rpc_notification(
                lambda event_name, notification_payload: self._emit_to_room(
                    client_presentation_room(self._client_id(sid)),
                    event_name,
                    notification_payload,
                ),
                EDITOR_RPC_NOTIFICATION_GIT_BASELINES,
                payload,
            )
            return
        if method == EDITOR_RPC_METHOD_DRAFT_DIFF_GET:
            await emit_editor_rpc_notification(
                lambda event_name, notification_payload: self._emit_to_sid(sid, event_name, notification_payload),
                EDITOR_RPC_NOTIFICATION_DRAFT_DIFF,
                payload,
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
        self._client_identity_by_sid[sid] = identity
        enter_room = cast(Callable[..., Awaitable[object]], self.enter_room)
        await enter_room(sid, "code_te2")
        await enter_room(sid, client_presentation_room(identity["clientInstanceId"]))
        snapshot = editor_runtime_build_connect_snapshot(
            client_instance_id=identity["clientInstanceId"]
        )
        await emit_editor_rpc_notification(
            lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
            EDITOR_RPC_NOTIFICATION_STATE_SSOT,
            snapshot,
        )
        open_state_obj = snapshot.get("openState")
        try:
            from ..workbench_adapter_shell_manager import get_adapter_state

            await emit_editor_rpc_notification(
                lambda event_name, payload: self._emit_to_sid(sid, event_name, payload),
                EDITOR_RPC_NOTIFICATION_ADAPTER_STATE,
                get_adapter_state(),
            )
        except Exception:
            pass
        if isinstance(open_state_obj, dict):
            try:
                await editor_runtime_emit_open_state_changed(
                    cast(SidecarOpenStatePayload, cast(object, open_state_obj)),
                    source="rpc_connect",
                )
            except Exception:
                pass

    async def on_disconnect(self, sid: str, reason: object | None = None) -> None:
        identity = self._client_identity_by_sid.pop(sid, None)
        try:
            leave_room = cast(Callable[..., Awaitable[object]], self.leave_room)
            await leave_room(sid, "code_te2")
            if identity is not None:
                await leave_room(
                    sid,
                    client_presentation_room(identity["clientInstanceId"]),
                )
        except Exception:
            pass

    def _client_id(self, sid: str) -> str:
        identity = self._client_identity_by_sid.get(sid)
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
                await dispatch_editor_rpc_request(
                    notification["method"],
                    notification["params"],
                    source_client=source_client,
                    active_project=editor_runtime_active_project,
                    normalize_abs_path=editor_runtime_normalize_abs_path,
                    is_under_project=editor_runtime_is_under_project,
                    runtime_meta=editor_runtime_meta,
                    read_file_payload=editor_runtime_read_file_payload,
                    read_disk_text=editor_runtime_read_disk_text,
                    git_head_text=editor_runtime_git_head_text,
                    get_cached_document=editor_runtime_get_cached_document,
                    record_sidecar_open_file=editor_runtime_record_sidecar_open_file,
                    emit_open_state_changed=editor_runtime_emit_open_state_changed,
                    emit_to_room=lambda event_name, payload: editor_runtime_emit_room_event(
                        event_name,
                        payload,
                        client_instance_id=source_client,
                    ),
                    notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
                    record_save_sha=editor_runtime_record_save_sha,
                    record_file_activity=editor_runtime_record_file_activity,
                    handle_scroll_state=editor_runtime_handle_scroll_state,
                    handle_model_ready=editor_runtime_handle_model_ready,
                    resolve_save_snapshot_response=editor_runtime_resolve_save_snapshot_response,
                    handle_issues_dump_response=editor_runtime_handle_issues_dump_response,
                    handle_breadcrumb_navigate=editor_runtime_handle_breadcrumb_navigate,
                )
                return

            request_id = request["id"]
            result = await dispatch_editor_rpc_request(
                request["method"],
                request["params"],
                source_client=source_client,
                active_project=editor_runtime_active_project,
                normalize_abs_path=editor_runtime_normalize_abs_path,
                is_under_project=editor_runtime_is_under_project,
                runtime_meta=editor_runtime_meta,
                read_file_payload=editor_runtime_read_file_payload,
                read_disk_text=editor_runtime_read_disk_text,
                git_head_text=editor_runtime_git_head_text,
                get_cached_document=editor_runtime_get_cached_document,
                record_sidecar_open_file=editor_runtime_record_sidecar_open_file,
                emit_open_state_changed=editor_runtime_emit_open_state_changed,
                emit_to_room=lambda event_name, payload: editor_runtime_emit_room_event(
                    event_name,
                    payload,
                    client_instance_id=source_client,
                ),
                notify_draft_state_changed=editor_runtime_notify_draft_state_changed,
                record_save_sha=editor_runtime_record_save_sha,
                record_file_activity=editor_runtime_record_file_activity,
                handle_scroll_state=editor_runtime_handle_scroll_state,
                handle_model_ready=editor_runtime_handle_model_ready,
                resolve_save_snapshot_response=editor_runtime_resolve_save_snapshot_response,
                handle_issues_dump_response=editor_runtime_handle_issues_dump_response,
                handle_breadcrumb_navigate=editor_runtime_handle_breadcrumb_navigate,
            )
            await self._publish_result_notification(sid, request["method"], result)
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
