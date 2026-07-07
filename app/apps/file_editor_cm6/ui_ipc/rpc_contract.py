# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypedDict, cast

from ..socketio_jsonrpc import (
    JsonRpcEnvelopeError,
    coerce_jsonrpc_envelope,
    normalize_jsonrpc_params,
)

UI_IPC_RPC_NAMESPACE: Final = "/ui_ipc"
UI_IPC_RPC_REQUEST_EVENT: Final = "rpc"
UI_IPC_RPC_NOTIFICATION_EVENT: Final = "rpc.notify"

UI_IPC_RPC_METHOD_HOST_FILE_OPEN: Final = "ui.host.file.open"
UI_IPC_RPC_METHOD_HOST_FILE_SAVE: Final = "ui.host.file.save"
UI_IPC_RPC_METHOD_HOST_DRAFT_DISCARD: Final = "ui.host.draft.discard"
UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE: Final = "ui.host.editorPreference.update"
UI_IPC_RPC_METHOD_HOST_FILE_RUN: Final = "ui.host.file.run"
UI_IPC_RPC_METHOD_HOST_PAGE_PREVIEW_TEMPLATE_INSTALL: Final = "ui.host.pagePreview.template.install"
UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_GET: Final = "ui.host.runProfiles.get"
UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_SAVE: Final = "ui.host.runProfiles.save"
UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET: Final = "ui.host.bootSnapshot.get"
UI_IPC_RPC_METHOD_HOST_EDITOR_JUMP_TO_LINE: Final = "ui.host.editor.jumpToLine"
UI_IPC_RPC_METHOD_HOST_EDITOR_GIT_BASELINES_GET: Final = "ui.host.editor.gitBaselines.get"
UI_IPC_RPC_METHOD_HOST_EDITOR_FIND: Final = "ui.host.editor.find"
UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_COMMAND: Final = "ui.host.editor.issues.command"
UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_DUMP: Final = "ui.host.editor.issues.dump"
UI_IPC_RPC_METHOD_HOST_EDITOR_COMMAND: Final = "ui.host.editor.command"
UI_IPC_RPC_METHOD_HOST_DIAGNOSTICS_MENTION: Final = "ui.host.diagnostics.mention"
UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CHECKOUT: Final = "ui.host.git.branch.checkout"
UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CREATE: Final = "ui.host.git.branch.create"
UI_IPC_RPC_METHOD_HOST_GIT_BRANCHES_LIST: Final = "ui.host.git.branches.list"
UI_IPC_RPC_METHOD_HOST_GIT_REMOTE_ADD: Final = "ui.host.git.remote.add"
UI_IPC_RPC_METHOD_HOST_STATE_FILE_ACTIVITY_RECORD: Final = "ui.host.state.fileActivity.record"
UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE: Final = "ui.host.state.fileScroll.update"
UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CREATE: Final = "ui.sidebar.window.create"
UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ACTIVATE: Final = "ui.sidebar.window.activate"
UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CLOSE: Final = "ui.sidebar.window.close"
UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ORDER_UPDATE: Final = "ui.sidebar.window.order.update"
UI_IPC_RPC_METHOD_SIDEBAR_ACTIVE_SHORTCUT_SET: Final = "ui.sidebar.activeShortcut.set"

UiIpcRpcMethod = Literal[
    "ui.host.file.open",
    "ui.host.file.save",
    "ui.host.draft.discard",
    "ui.host.editorPreference.update",
    "ui.host.file.run",
    "ui.host.pagePreview.template.install",
    "ui.host.runProfiles.get",
    "ui.host.runProfiles.save",
    "ui.host.bootSnapshot.get",
    "ui.host.editor.jumpToLine",
    "ui.host.editor.gitBaselines.get",
    "ui.host.editor.find",
    "ui.host.editor.issues.command",
    "ui.host.editor.issues.dump",
    "ui.host.editor.command",
    "ui.host.diagnostics.mention",
    "ui.host.git.branch.checkout",
    "ui.host.git.branch.create",
    "ui.host.git.branches.list",
    "ui.host.git.remote.add",
    "ui.host.state.fileActivity.record",
    "ui.host.state.fileScroll.update",
    "ui.sidebar.window.create",
    "ui.sidebar.window.activate",
    "ui.sidebar.window.close",
    "ui.sidebar.window.order.update",
    "ui.sidebar.activeShortcut.set",
]

UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE: Final = "ui.editor.save"
UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS: Final = "ui.editor.focus"
UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR: Final = "ui.editor.blur"
UI_IPC_RPC_NOTIFICATION_IME_FOCUS: Final = "ui.ime.focus"
UI_IPC_RPC_NOTIFICATION_IME_BLUR: Final = "ui.ime.blur"
UI_IPC_RPC_NOTIFICATION_EDITOR_READY: Final = "ui.editor.ready"
UI_IPC_RPC_NOTIFICATION_EDITOR_OPEN_COMPLETE: Final = "ui.editor.open.complete"
UI_IPC_RPC_NOTIFICATION_EDITOR_CACHE_STATE: Final = "ui.editor.cache.state"
UI_IPC_RPC_NOTIFICATION_EDITOR_DRAFT_STATE: Final = "ui.editor.draft.state"
UI_IPC_RPC_NOTIFICATION_EDITOR_SCROLL_STATE: Final = "ui.editor.scroll.state"
UI_IPC_RPC_NOTIFICATION_EDITOR_NOTIFY: Final = "ui.editor.notify"
UI_IPC_RPC_NOTIFICATION_EDITOR_DIAGNOSTICS_COUNTS: Final = "ui.editor.diagnostics.counts"
UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE: Final = "ui.adapter.state"
UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED: Final = "ui.host.activeFile.changed"
UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED: Final = "ui.openState.changed"
UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING: Final = "ui.project.switching"
UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED: Final = "ui.project.switched"
UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED: Final = "ui.preferences.changed"
UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN: Final = "ui.terminal.open"
UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED: Final = "ui.sidebar.windows.changed"
UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED: Final = "ui.sidebar.window.activated"
UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED: Final = "ui.sidebar.window.readiness.changed"

UiIpcRpcNotification = Literal[
    "ui.editor.save",
    "ui.editor.focus",
    "ui.editor.blur",
    "ui.ime.focus",
    "ui.ime.blur",
    "ui.editor.ready",
    "ui.editor.open.complete",
    "ui.editor.cache.state",
    "ui.editor.draft.state",
    "ui.editor.scroll.state",
    "ui.editor.notify",
    "ui.editor.diagnostics.counts",
    "ui.adapter.state",
    "ui.host.activeFile.changed",
    "ui.openState.changed",
    "ui.project.switching",
    "ui.project.switched",
    "ui.preferences.changed",
    "ui.terminal.open",
    "ui.sidebar.windows.changed",
    "ui.sidebar.window.activated",
    "ui.sidebar.window.readiness.changed",
]

ALLOWED_REQUEST_METHODS: Final[set[str]] = {
    UI_IPC_RPC_METHOD_HOST_FILE_OPEN,
    UI_IPC_RPC_METHOD_HOST_FILE_SAVE,
    UI_IPC_RPC_METHOD_HOST_DRAFT_DISCARD,
    UI_IPC_RPC_METHOD_HOST_EDITOR_PREFERENCE_UPDATE,
    UI_IPC_RPC_METHOD_HOST_FILE_RUN,
    UI_IPC_RPC_METHOD_HOST_PAGE_PREVIEW_TEMPLATE_INSTALL,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_GET,
    UI_IPC_RPC_METHOD_HOST_RUN_PROFILES_SAVE,
    UI_IPC_RPC_METHOD_HOST_BOOT_SNAPSHOT_GET,
    UI_IPC_RPC_METHOD_HOST_EDITOR_JUMP_TO_LINE,
    UI_IPC_RPC_METHOD_HOST_EDITOR_GIT_BASELINES_GET,
    UI_IPC_RPC_METHOD_HOST_EDITOR_FIND,
    UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_COMMAND,
    UI_IPC_RPC_METHOD_HOST_EDITOR_ISSUES_DUMP,
    UI_IPC_RPC_METHOD_HOST_EDITOR_COMMAND,
    UI_IPC_RPC_METHOD_HOST_DIAGNOSTICS_MENTION,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CHECKOUT,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCH_CREATE,
    UI_IPC_RPC_METHOD_HOST_GIT_BRANCHES_LIST,
    UI_IPC_RPC_METHOD_HOST_GIT_REMOTE_ADD,
    UI_IPC_RPC_METHOD_HOST_STATE_FILE_ACTIVITY_RECORD,
    UI_IPC_RPC_METHOD_HOST_STATE_FILE_SCROLL_UPDATE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CREATE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ACTIVATE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_CLOSE,
    UI_IPC_RPC_METHOD_SIDEBAR_WINDOW_ORDER_UPDATE,
    UI_IPC_RPC_METHOD_SIDEBAR_ACTIVE_SHORTCUT_SET,
}

ALLOWED_NOTIFICATION_METHODS: Final[set[str]] = {
    UI_IPC_RPC_NOTIFICATION_EDITOR_SAVE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_FOCUS,
    UI_IPC_RPC_NOTIFICATION_EDITOR_BLUR,
    UI_IPC_RPC_NOTIFICATION_IME_FOCUS,
    UI_IPC_RPC_NOTIFICATION_IME_BLUR,
    UI_IPC_RPC_NOTIFICATION_EDITOR_READY,
    UI_IPC_RPC_NOTIFICATION_EDITOR_OPEN_COMPLETE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_CACHE_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_DRAFT_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_SCROLL_STATE,
    UI_IPC_RPC_NOTIFICATION_EDITOR_NOTIFY,
    UI_IPC_RPC_NOTIFICATION_EDITOR_DIAGNOSTICS_COUNTS,
    UI_IPC_RPC_NOTIFICATION_ADAPTER_STATE,
    UI_IPC_RPC_NOTIFICATION_HOST_ACTIVE_FILE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_OPEN_STATE_CHANGED,
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHING,
    UI_IPC_RPC_NOTIFICATION_PROJECT_SWITCHED,
    UI_IPC_RPC_NOTIFICATION_PREFERENCES_CHANGED,
    UI_IPC_RPC_NOTIFICATION_TERMINAL_OPEN,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOWS_CHANGED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_ACTIVATED,
    UI_IPC_RPC_NOTIFICATION_SIDEBAR_WINDOW_READINESS_CHANGED,
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
    try:
        envelope = coerce_jsonrpc_envelope(payload)
    except JsonRpcEnvelopeError as exc:
        raise UiIpcRpcProtocolError(
            None,
            code=exc.code,
            message=exc.message,
        ) from exc
    params_obj: object = envelope.params
    if params_obj is not None and not isinstance(params_obj, dict):
        raise UiIpcRpcProtocolError(
            None,
            code=-32602,
            message="params must be an object",
        )
    params = normalize_jsonrpc_params(cast(object, params_obj))
    if not envelope.has_id:
        if envelope.method not in ALLOWED_NOTIFICATION_METHODS:
            raise UiIpcRpcProtocolError(
                None,
                code=-32601,
                message=f"Unknown UI IPC RPC notification: {envelope.method}",
                data={"method": envelope.method},
            )
        return None

    request_id = _coerce_request_id(envelope.request_id)
    if envelope.method not in ALLOWED_REQUEST_METHODS:
        raise UiIpcRpcProtocolError(
            request_id,
            code=-32601,
            message=f"Unknown UI IPC RPC method: {envelope.method}",
            data={"method": envelope.method},
        )
    return {
        "request_id": request_id,
        "method": cast(UiIpcRpcMethod, envelope.method),
        "params": params,
    }


def parse_ui_ipc_rpc_notification(payload: object) -> ParsedUiIpcRpcNotification:
    try:
        envelope = coerce_jsonrpc_envelope(payload)
    except JsonRpcEnvelopeError as exc:
        raise UiIpcRpcProtocolError(
            None,
            code=exc.code,
            message=exc.message,
        ) from exc
    params_obj: object = envelope.params
    if params_obj is not None and not isinstance(params_obj, dict):
        raise UiIpcRpcProtocolError(
            None,
            code=-32602,
            message="params must be an object",
        )
    if envelope.method not in ALLOWED_NOTIFICATION_METHODS:
        raise UiIpcRpcProtocolError(
            None,
            code=-32601,
            message=f"Unknown UI IPC RPC notification: {envelope.method}",
            data={"method": envelope.method},
        )
    return {
        "method": cast(UiIpcRpcNotification, envelope.method),
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
