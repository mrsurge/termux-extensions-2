# pyright: strict, reportMissingTypeStubs=false
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import cast

import socketio

from .editor_rpc_contract import (
    JSONRPC_INTERNAL_ERROR,
    JSONRPC_INVALID_PARAMS,
    EditorRpcDispatchError,
    EditorRpcProtocolError,
    coerce_jsonrpc_notification_envelope,
    coerce_jsonrpc_request_envelope,
)
from .editor_rpc_dispatch import dispatch_editor_rpc_request
from .editor_rpc_emit import emit_editor_rpc_error, emit_editor_rpc_result
from .editor_ws import (
    editor_runtime_active_project,
    editor_runtime_coerce_generation,
    editor_runtime_has_open_baseline,
    editor_runtime_is_under_project,
    editor_runtime_mark_open_baseline,
    editor_runtime_workbench_get_lock,
    editor_workbench_logger,
)


class EditorRpcSocketIONamespace(socketio.AsyncNamespace):
    async def _emit_to_sid(self, sid: str, event_name: str, payload: dict[str, object]) -> None:
        emit_to_room = cast(Callable[..., Awaitable[object]], self.emit)
        await emit_to_room(event_name, payload, room=sid)

    async def on_connect(self, sid: str, environ: dict[str, object], auth: object) -> None:
        enter_room = cast(Callable[..., Awaitable[object]], self.enter_room)
        await enter_room(sid, "file_editor_cm6")

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
                    is_under_project=editor_runtime_is_under_project,
                    get_lock=editor_runtime_workbench_get_lock,
                    coerce_generation=editor_runtime_coerce_generation,
                    mark_open_baseline=editor_runtime_mark_open_baseline,
                    has_open_baseline=editor_runtime_has_open_baseline,
                    logger=editor_workbench_logger,
                )
                return

            request_id = request["id"]
            result = await dispatch_editor_rpc_request(
                request["method"],
                request["params"],
                active_project=editor_runtime_active_project,
                is_under_project=editor_runtime_is_under_project,
                get_lock=editor_runtime_workbench_get_lock,
                coerce_generation=editor_runtime_coerce_generation,
                mark_open_baseline=editor_runtime_mark_open_baseline,
                has_open_baseline=editor_runtime_has_open_baseline,
                logger=editor_workbench_logger,
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
