# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypedDict, cast

from ..socketio_jsonrpc import (
    JsonRpcEnvelopeError,
    coerce_jsonrpc_envelope,
    normalize_jsonrpc_params,
)

SIDEBAR_IPC_RPC_NAMESPACE: Final = "/sidebar_ipc"
SIDEBAR_IPC_RPC_REQUEST_EVENT: Final = "rpc"
SIDEBAR_IPC_RPC_NOTIFICATION_EVENT: Final = "rpc.notify"

SIDEBAR_IPC_RPC_METHOD_REGISTER: Final = "sidebar.register"
SIDEBAR_IPC_RPC_METHOD_CWD_GET: Final = "sidebar.cwd.get"
SIDEBAR_IPC_RPC_METHOD_CWD_SYNC: Final = "sidebar.cwd.sync"
SIDEBAR_IPC_RPC_METHOD_FILE_OPEN: Final = "sidebar.file.open"
SIDEBAR_IPC_RPC_METHOD_FILE_EDIT: Final = "sidebar.file.edit"
SIDEBAR_IPC_RPC_METHOD_MENTION: Final = "sidebar.mention"
SIDEBAR_IPC_RPC_METHOD_PROJECT_LOOKUP: Final = "sidebar.project.lookup"
SIDEBAR_IPC_RPC_METHOD_PROJECT_OPEN: Final = "sidebar.project.open"
SIDEBAR_IPC_RPC_METHOD_PROJECT_CREATE: Final = "sidebar.project.create"
SIDEBAR_IPC_RPC_METHOD_LAUNCHER_CATALOG_GET: Final = "sidebar.launcher.catalog.get"
SIDEBAR_IPC_RPC_METHOD_WINDOWS_LIST: Final = "sidebar.windows.list"
SIDEBAR_IPC_RPC_METHOD_WINDOW_CREATE: Final = "sidebar.window.create"
SIDEBAR_IPC_RPC_METHOD_WINDOW_OPEN_URL: Final = "sidebar.window.openUrl"
SIDEBAR_IPC_RPC_METHOD_WINDOW_STATE_UPDATE: Final = "sidebar.window.state.update"
SIDEBAR_IPC_RPC_METHOD_WINDOW_ACTIVATE: Final = "sidebar.window.activate"
SIDEBAR_IPC_RPC_METHOD_WINDOW_PRESENTATION_UPDATE: Final = "sidebar.window.presentation.update"
SIDEBAR_IPC_RPC_METHOD_WINDOW_CLOSE: Final = "sidebar.window.close"
SIDEBAR_IPC_RPC_METHOD_WINDOW_READINESS_UPDATE: Final = "sidebar.window.readiness.update"
SIDEBAR_IPC_RPC_METHOD_DRAFTS_LIST: Final = "sidebar.drafts.list"
SIDEBAR_IPC_RPC_METHOD_DRAFT_STATE_GET: Final = "sidebar.draftState.get"
SIDEBAR_IPC_RPC_METHOD_DRAFT_CLEAR: Final = "sidebar.draft.clear"
SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET: Final = "sidebar.agentEdits.documentState.get"
SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_PUBLISH: Final = "sidebar.agentEdits.publish"
SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_CLEAR: Final = "sidebar.agentEdits.clear"
SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_LIST: Final = "sidebar.agentEdits.list"
SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DECIDE: Final = "sidebar.agentEdits.decide"
SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET: Final = "sidebar.activeShortcut.set"
SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH: Final = "sidebar.activeShortcut.refresh"
SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN: Final = "sidebar.drawer.open"
SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE: Final = "sidebar.drawer.close"
SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE: Final = "sidebar.drawer.toggle"

SidebarIpcRpcMethod = Literal[
    "sidebar.register",
    "sidebar.cwd.get",
    "sidebar.cwd.sync",
    "sidebar.file.open",
    "sidebar.file.edit",
    "sidebar.mention",
    "sidebar.project.lookup",
    "sidebar.project.open",
    "sidebar.project.create",
    "sidebar.launcher.catalog.get",
    "sidebar.windows.list",
    "sidebar.window.create",
    "sidebar.window.openUrl",
    "sidebar.window.state.update",
    "sidebar.window.activate",
    "sidebar.window.presentation.update",
    "sidebar.window.close",
    "sidebar.window.readiness.update",
    "sidebar.drafts.list",
    "sidebar.draftState.get",
    "sidebar.draft.clear",
    "sidebar.agentEdits.documentState.get",
    "sidebar.agentEdits.publish",
    "sidebar.agentEdits.clear",
    "sidebar.agentEdits.list",
    "sidebar.agentEdits.decide",
    "sidebar.activeShortcut.set",
    "sidebar.activeShortcut.refresh",
    "sidebar.drawer.open",
    "sidebar.drawer.close",
    "sidebar.drawer.toggle",
]

SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE: Final = "sidebar.presence"
SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET: Final = "sidebar.cwd.set"
SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE: Final = "sidebar.clientState"
SIDEBAR_IPC_RPC_NOTIFICATION_MENTION: Final = "sidebar.mention"
SIDEBAR_IPC_RPC_NOTIFICATION_FILE_OPEN: Final = "sidebar.file.open"
SIDEBAR_IPC_RPC_NOTIFICATION_PROJECT_OPENED: Final = "sidebar.project.opened"
SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED: Final = "sidebar.windows.changed"
SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED: Final = "sidebar.window.activated"
SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_FOCUSED: Final = "sidebar.window.focused"
SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED: Final = "sidebar.window.readiness.changed"
SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH: Final = "sidebar.activeShortcut.refresh"
SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE: Final = "sidebar.drawer.state"
SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN: Final = "sidebar.drawer.open"
SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE: Final = "sidebar.drawer.close"
SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE: Final = "sidebar.drawer.toggle"

SidebarIpcRpcNotification = Literal[
    "sidebar.presence",
    "sidebar.cwd.set",
    "sidebar.clientState",
    "sidebar.mention",
    "sidebar.file.open",
    "sidebar.project.opened",
    "sidebar.windows.changed",
    "sidebar.window.activated",
    "sidebar.window.focused",
    "sidebar.window.readiness.changed",
    "sidebar.activeShortcut.refresh",
    "sidebar.drawer.state",
    "sidebar.drawer.open",
    "sidebar.drawer.close",
    "sidebar.drawer.toggle",
]

ALLOWED_REQUEST_METHODS: Final[set[str]] = {
    SIDEBAR_IPC_RPC_METHOD_REGISTER,
    SIDEBAR_IPC_RPC_METHOD_CWD_GET,
    SIDEBAR_IPC_RPC_METHOD_CWD_SYNC,
    SIDEBAR_IPC_RPC_METHOD_FILE_OPEN,
    SIDEBAR_IPC_RPC_METHOD_FILE_EDIT,
    SIDEBAR_IPC_RPC_METHOD_MENTION,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_LOOKUP,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_OPEN,
    SIDEBAR_IPC_RPC_METHOD_PROJECT_CREATE,
    SIDEBAR_IPC_RPC_METHOD_LAUNCHER_CATALOG_GET,
    SIDEBAR_IPC_RPC_METHOD_WINDOWS_LIST,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_CREATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_OPEN_URL,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_STATE_UPDATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_ACTIVATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_PRESENTATION_UPDATE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_CLOSE,
    SIDEBAR_IPC_RPC_METHOD_WINDOW_READINESS_UPDATE,
    SIDEBAR_IPC_RPC_METHOD_DRAFTS_LIST,
    SIDEBAR_IPC_RPC_METHOD_DRAFT_STATE_GET,
    SIDEBAR_IPC_RPC_METHOD_DRAFT_CLEAR,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DOCUMENT_STATE_GET,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_PUBLISH,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_CLEAR,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_LIST,
    SIDEBAR_IPC_RPC_METHOD_AGENT_EDITS_DECIDE,
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_SET,
    SIDEBAR_IPC_RPC_METHOD_ACTIVE_SHORTCUT_REFRESH,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_OPEN,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_CLOSE,
    SIDEBAR_IPC_RPC_METHOD_DRAWER_TOGGLE,
}

ALLOWED_NOTIFICATION_METHODS: Final[set[str]] = {
    SIDEBAR_IPC_RPC_NOTIFICATION_PRESENCE,
    SIDEBAR_IPC_RPC_NOTIFICATION_CWD_SET,
    SIDEBAR_IPC_RPC_NOTIFICATION_CLIENT_STATE,
    SIDEBAR_IPC_RPC_NOTIFICATION_MENTION,
    SIDEBAR_IPC_RPC_NOTIFICATION_FILE_OPEN,
    SIDEBAR_IPC_RPC_NOTIFICATION_PROJECT_OPENED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOWS_CHANGED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_ACTIVATED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_FOCUSED,
    SIDEBAR_IPC_RPC_NOTIFICATION_WINDOW_READINESS_CHANGED,
    SIDEBAR_IPC_RPC_NOTIFICATION_ACTIVE_SHORTCUT_REFRESH,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_STATE,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_OPEN,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_CLOSE,
    SIDEBAR_IPC_RPC_NOTIFICATION_DRAWER_TOGGLE,
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


class ParsedSidebarIpcRpcRequest(TypedDict):
    request_id: JsonRpcId
    method: SidebarIpcRpcMethod
    params: JsonObject


class ParsedSidebarIpcRpcNotification(TypedDict):
    method: SidebarIpcRpcNotification
    params: JsonObject


@dataclass(frozen=True)
class SidebarIpcRpcProtocolError(Exception):
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
    raise SidebarIpcRpcProtocolError(
        None,
        code=-32600,
        message="request id must be a non-empty string",
    )


def parse_sidebar_ipc_rpc_request(payload: object) -> ParsedSidebarIpcRpcRequest | None:
    try:
        envelope = coerce_jsonrpc_envelope(payload)
    except JsonRpcEnvelopeError as exc:
        raise SidebarIpcRpcProtocolError(None, code=exc.code, message=exc.message) from exc
    params_obj: object = envelope.params
    if params_obj is not None and not isinstance(params_obj, dict):
        raise SidebarIpcRpcProtocolError(None, code=-32602, message="params must be an object")
    params = normalize_jsonrpc_params(cast(object, params_obj))
    if not envelope.has_id:
        if envelope.method not in ALLOWED_NOTIFICATION_METHODS:
            raise SidebarIpcRpcProtocolError(
                None,
                code=-32601,
                message=f"Unknown sidebar IPC RPC notification: {envelope.method}",
                data={"method": envelope.method},
            )
        return None
    request_id = _coerce_request_id(envelope.request_id)
    if envelope.method not in ALLOWED_REQUEST_METHODS:
        raise SidebarIpcRpcProtocolError(
            request_id,
            code=-32601,
            message=f"Unknown sidebar IPC RPC method: {envelope.method}",
            data={"method": envelope.method},
        )
    return {
        "request_id": request_id,
        "method": cast(SidebarIpcRpcMethod, envelope.method),
        "params": params,
    }


def parse_sidebar_ipc_rpc_notification(payload: object) -> ParsedSidebarIpcRpcNotification:
    try:
        envelope = coerce_jsonrpc_envelope(payload)
    except JsonRpcEnvelopeError as exc:
        raise SidebarIpcRpcProtocolError(None, code=exc.code, message=exc.message) from exc
    params_obj: object = envelope.params
    if params_obj is not None and not isinstance(params_obj, dict):
        raise SidebarIpcRpcProtocolError(None, code=-32602, message="params must be an object")
    if envelope.method not in ALLOWED_NOTIFICATION_METHODS:
        raise SidebarIpcRpcProtocolError(
            None,
            code=-32601,
            message=f"Unknown sidebar IPC RPC notification: {envelope.method}",
            data={"method": envelope.method},
        )
    return {
        "method": cast(SidebarIpcRpcNotification, envelope.method),
        "params": normalize_jsonrpc_params(cast(object, params_obj)),
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
