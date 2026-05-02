# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypedDict, cast

UI_IPC_RPC_NAMESPACE: Final = "/ui_ipc"
UI_IPC_RPC_REQUEST_EVENT: Final = "rpc"
UI_IPC_RPC_NOTIFICATION_EVENT: Final = "rpc.notify"

UI_IPC_RPC_METHOD_HOST_FILE_OPEN: Final = "ui.host.file.open"
UI_IPC_RPC_METHOD_HOST_FILE_SAVE: Final = "ui.host.file.save"
UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE: Final = "ui.host.editorPreference.update"
UI_IPC_RPC_METHOD_HOST_FILE_RUN: Final = "ui.host.file.run"
UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET: Final = "ui.host.bootSnapshot.get"

UiIpcRpcMethod = Literal[
    "ui.host.file.open",
    "ui.host.file.save",
    "ui.host.editorPreference.update",
    "ui.host.file.run",
    "ui.host.bootSnapshot.get",
]

UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE: Final = "ui.editor.save"
UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS: Final = "ui.editor.focus"
UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR: Final = "ui.editor.blur"
UI_IPC_RPC_NOTIFICATION_EDITOR_MENTION_REQUEST: Final = "ui.editor.mention.request"
UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE: Final = "ui.adapter.state"
UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED: Final = "ui.host.activeFile.changed"

UiIpcRpcNotification = Literal[
    "ui.editor.save",
    "ui.editor.focus",
    "ui.editor.blur",
    "ui.editor.mention.request",
    "ui.adapter.state",
    "ui.host.activeFile.changed",
]

ALLOWED_REQUEST_METHODS: Final[set[str]] = {
    UI_IPC_RPC_METHOD_HOST_FILE_OPEN,
    UI_IPC_RPC_METHOD_HOST_FILE_SAVE,
    UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE,
    UI_IPC_RPC_METHOD_HOST_FILE_RUN,
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
}

ALLOWED_NOTIFICATION_METHODS: Final[set[str]] = {
    UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR,
    UI_IPC_RPC_NOTIFICATION_EDITOR_MENTION_REQUEST,
    UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
}

JsonObject = dict[str, object]
JsonRpcId = str


class JsonRpcErrorObject(TypedDict, total=False):
    code: int
    message: str
    data: JsonObject


class JsonRpcSuccessEnvelope(TypedDict):
    jsonrpc: str
    id: JsonRpcId
    result: object


class JsonRpcErrorEnvelope(TypedDict):
    jsonrpc: str
    id: JsonRpcId | None
    error: JsonRpcErrorObject


class ParsedUiIpcRpcRequest(TypedDict):
    request_id: JsonRpcId
    method: UiIpcRpcMethod
    params: JsonObject


class ParsedUiIpcRpcNotification(TypedDict):
    method: UiIpcRpcNotification
    params: JsonObject


@dataclass(frozen=True)
class UiIpcRpcProtocolError(Exception):
    request_id: JsonRpcId | None
    code: int
    message: str
    data: JsonObject | None = None

    def to_json(self) -> JsonRpcErrorEnvelope:
        return build_jsonrpc_error(
            request_id=self.request_id,
            code=self.code,
            message=self.message,
            data=self.data,
        )


def _as_object(value: object) -> JsonObject | None:
    if isinstance(value, dict):
        normalized: JsonObject = {}
        for key, item in cast(dict[object, object], value).items():
            if isinstance(key, str):
                normalized[key] = item
        return normalized
    return None


def normalize_payload(value: object) -> JsonObject:
    return _as_object(value) or {}


def _coerce_request_id(value: object) -> JsonRpcId:
    if isinstance(value, str) and value:
        return value
    raise UiIpcRpcProtocolError(
        None,
        code=-32600,
        message="request id must be a non-empty string",
    )


def parse_ui_ipc_rpc_request(payload: object) -> ParsedUiIpcRpcRequest | None:
    envelope = _as_object(payload)
    if envelope is None:
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="Invalid request envelope",
        )

    if envelope.get("jsonrpc") != "2.0":
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="jsonrpc must be '2.0'",
        )

    method = envelope.get("method")
    if not isinstance(method, str) or not method.strip():
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="method is required",
        )

    params = normalize_payload(envelope.get("params"))
    request_id_obj = envelope.get("id")
    if request_id_obj is None:
        if method not in ALLOWED_NOTIFICATION_METHODS:
            raise UiIpcRpcProtocolError(
                None,
                code=-32601,
                message=f"Unknown UI IPC RPC notification: {method}",
                data={"method": method},
            )
        return None

    request_id = _coerce_request_id(request_id_obj)
    if method not in ALLOWED_REQUEST_METHODS:
        raise UiIpcRpcProtocolError(
            request_id,
            code=-32601,
            message=f"Unknown UI IPC RPC method: {method}",
            data={"method": method},
        )
    return {
        "request_id": request_id,
        "method": cast(UiIpcRpcMethod, method),
        "params": params,
    }


def parse_ui_ipc_rpc_notification(payload: object) -> ParsedUiIpcRpcNotification:
    envelope = _as_object(payload)
    if envelope is None:
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="Invalid notification envelope",
        )
    if envelope.get("jsonrpc") != "2.0":
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="jsonrpc must be '2.0'",
        )
    method = envelope.get("method")
    if not isinstance(method, str) or not method.strip():
        raise UiIpcRpcProtocolError(
            None,
            code=-32600,
            message="method is required",
        )
    if method not in ALLOWED_NOTIFICATION_METHODS:
        raise UiIpcRpcProtocolError(
            None,
            code=-32601,
            message=f"Unknown UI IPC RPC notification: {method}",
            data={"method": method},
        )
    return {
        "method": cast(UiIpcRpcNotification, method),
        "params": normalize_payload(envelope.get("params")),
    }


def build_jsonrpc_notification(method: str, params: JsonObject | None = None) -> JsonObject:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
    }


def build_jsonrpc_result(request_id: JsonRpcId, result: object) -> JsonRpcSuccessEnvelope:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": result,
    }


def build_jsonrpc_error(
    *,
    request_id: JsonRpcId | None,
    code: int,
    message: str,
    data: JsonObject | None = None,
) -> JsonRpcErrorEnvelope:
    error: JsonRpcErrorObject = {
        "code": code,
        "message": message,
    }
    if data:
        error["data"] = data
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": error,
    }
