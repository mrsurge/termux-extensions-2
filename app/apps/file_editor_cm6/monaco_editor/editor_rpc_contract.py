# pyright: strict
from __future__ import annotations

from typing import Final, Literal, TypedDict, cast

JSONRPC_VERSION: Final = "2.0"
EDITOR_RPC_EVENT: Final = "rpc"

JSONRPC_PARSE_ERROR: Final = -32700
JSONRPC_INVALID_REQUEST: Final = -32600
JSONRPC_METHOD_NOT_FOUND: Final = -32601
JSONRPC_INVALID_PARAMS: Final = -32602
JSONRPC_INTERNAL_ERROR: Final = -32603
JSONRPC_APPLICATION_ERROR: Final = -32000

JsonRpcId = str | int

EDITOR_RPC_METHOD_OPEN: Final = "editor.open"
EDITOR_RPC_METHOD_JUMP_TO_LINE: Final = "editor.jumpToLine"
EDITOR_RPC_METHOD_GIT_BASELINES_GET: Final = "editor.gitBaselines.get"
EDITOR_RPC_METHOD_DRAFT_DIFF_GET: Final = "editor.draftDiff.get"
EDITOR_RPC_METHOD_MIRROR_PUBLISH: Final = "editor.mirror.publish"
EDITOR_RPC_METHOD_SAVE: Final = "editor.save"
EDITOR_RPC_METHOD_MENTION_REQUEST: Final = "editor.mention.request"
EDITOR_RPC_METHOD_HOST_SAVE: Final = "editor.host.save"
EDITOR_RPC_METHOD_FOCUS: Final = "editor.focus"
EDITOR_RPC_METHOD_BLUR: Final = "editor.blur"
EDITOR_RPC_METHOD_READY_PUBLISH: Final = "editor.ready.publish"
EDITOR_RPC_METHOD_CACHE_STATE_PUBLISH: Final = "editor.cacheState.publish"
EDITOR_RPC_METHOD_DRAFT_STATE_PUBLISH: Final = "editor.draftState.publish"
EDITOR_RPC_METHOD_NOTIFY_PUBLISH: Final = "editor.notify.publish"
EDITOR_RPC_METHOD_OPEN_COMPLETE_PUBLISH: Final = "editor.openComplete.publish"
EDITOR_RPC_METHOD_DIAGNOSTICS_COUNTS_PUBLISH: Final = "editor.diagnosticsCounts.publish"
EDITOR_RPC_METHOD_SCROLL_STATE_PUBLISH: Final = "editor.scrollState.publish"
EDITOR_RPC_METHOD_MODEL_READY: Final = "editor.modelReady"
EDITOR_RPC_METHOD_SAVE_SNAPSHOT_RESPONSE: Final = "editor.save.snapshot.response"
EDITOR_RPC_METHOD_ISSUES_DUMP_RESPONSE: Final = "editor.issues.dump.response"
EDITOR_RPC_METHOD_BREADCRUMB_NAVIGATE: Final = "editor.breadcrumb.navigate"

EditorRpcMethod = Literal[
    "editor.open",
    "editor.jumpToLine",
    "editor.gitBaselines.get",
    "editor.draftDiff.get",
    "editor.mirror.publish",
    "editor.save",
    "editor.mention.request",
    "editor.host.save",
    "editor.focus",
    "editor.blur",
    "editor.ready.publish",
    "editor.cacheState.publish",
    "editor.draftState.publish",
    "editor.notify.publish",
    "editor.openComplete.publish",
    "editor.diagnosticsCounts.publish",
    "editor.scrollState.publish",
    "editor.modelReady",
    "editor.save.snapshot.response",
    "editor.issues.dump.response",
    "editor.breadcrumb.navigate",
]

EDITOR_RPC_NOTIFICATION_STATE_SSOT: Final = "editor.state.ssot"
EDITOR_RPC_NOTIFICATION_FILE_OPENED: Final = "editor.file.opened"
EDITOR_RPC_NOTIFICATION_FILE_JUMP_TO_LINE: Final = "editor.file.jumpToLine"
EDITOR_RPC_NOTIFICATION_MIRROR_UPDATED: Final = "editor.mirror.updated"
EDITOR_RPC_NOTIFICATION_GIT_BASELINES: Final = "editor.gitBaselines.updated"
EDITOR_RPC_NOTIFICATION_DRAFT_DIFF: Final = "editor.draftDiff.updated"
EDITOR_RPC_NOTIFICATION_PREFS_CHANGED: Final = "editor.prefs.changed"
EDITOR_RPC_NOTIFICATION_CACHE_STATE: Final = "editor.cache.state"
EDITOR_RPC_NOTIFICATION_DRAFT_STATE: Final = "editor.draft.state"
EDITOR_RPC_NOTIFICATION_READY: Final = "editor.ready"
EDITOR_RPC_NOTIFICATION_NOTIFY: Final = "editor.notify"
EDITOR_RPC_NOTIFICATION_OPEN_COMPLETE: Final = "editor.open.complete"
EDITOR_RPC_NOTIFICATION_DIAGNOSTICS: Final = "editor.diagnostics.updated"
EDITOR_RPC_NOTIFICATION_DIAGNOSTICS_COUNTS: Final = "editor.diagnostics.counts"
EDITOR_RPC_NOTIFICATION_ADAPTER_STATE: Final = "editor.adapter.state"
EDITOR_RPC_NOTIFICATION_SEMANTIC_TOKENS_PROVIDER_REGISTERED: Final = "editor.semanticTokens.providerRegistered"
EDITOR_RPC_NOTIFICATION_ISSUES_DUMP_REQUEST: Final = "editor.issues.dump.request"
EDITOR_RPC_NOTIFICATION_ISSUES_DUMP_RESPONSE: Final = "editor.issues.dump.response"
EDITOR_RPC_NOTIFICATION_SAVE_SNAPSHOT_REQUEST: Final = "editor.save.snapshot.request"
EDITOR_RPC_NOTIFICATION_ISSUES_COMMAND: Final = "editor.issues.command"
EDITOR_RPC_NOTIFICATION_FIND_COMMAND: Final = "editor.find.command"

EditorRpcNotification = Literal[
    "editor.state.ssot",
    "editor.file.opened",
    "editor.file.jumpToLine",
    "editor.mirror.updated",
    "editor.gitBaselines.updated",
    "editor.draftDiff.updated",
    "editor.prefs.changed",
    "editor.cache.state",
    "editor.draft.state",
    "editor.ready",
    "editor.notify",
    "editor.open.complete",
    "editor.diagnostics.updated",
    "editor.diagnostics.counts",
    "editor.adapter.state",
    "editor.semanticTokens.providerRegistered",
    "editor.issues.dump.request",
    "editor.issues.dump.response",
    "editor.save.snapshot.request",
    "editor.issues.command",
    "editor.find.command",
]


class JsonRpcErrorObject(TypedDict, total=False):
    code: int
    message: str
    data: dict[str, object]


class JsonRpcRequestEnvelope(TypedDict):
    jsonrpc: Literal["2.0"]
    id: JsonRpcId
    method: EditorRpcMethod
    params: dict[str, object]


class JsonRpcNotificationEnvelope(TypedDict):
    jsonrpc: Literal["2.0"]
    method: str
    params: dict[str, object]


class JsonRpcSuccessEnvelope(TypedDict):
    jsonrpc: Literal["2.0"]
    id: JsonRpcId
    result: object


class JsonRpcErrorEnvelope(TypedDict):
    jsonrpc: Literal["2.0"]
    id: JsonRpcId | None
    error: JsonRpcErrorObject


class EditorRpcProtocolError(Exception):
    def __init__(self, code: int, message: str, *, data: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data or {}


class EditorRpcDispatchError(Exception):
    def __init__(self, code: int, message: str, *, data: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data or {}


def coerce_jsonrpc_request_envelope(payload: object) -> JsonRpcRequestEnvelope | None:
    if not isinstance(payload, dict):
        return None
    raw_payload = cast(dict[object, object], payload)
    jsonrpc_obj = raw_payload.get("jsonrpc")
    method_obj = raw_payload.get("method")
    params_obj = raw_payload.get("params", {})
    request_id = raw_payload.get("id")
    if jsonrpc_obj != JSONRPC_VERSION:
        raise EditorRpcProtocolError(JSONRPC_INVALID_REQUEST, "invalid_jsonrpc_version")
    if not isinstance(method_obj, str) or not method_obj:
        raise EditorRpcProtocolError(JSONRPC_INVALID_REQUEST, "missing_method")
    if params_obj is None:
        params_obj = {}
    if not isinstance(params_obj, dict):
        raise EditorRpcProtocolError(JSONRPC_INVALID_PARAMS, "params_must_be_object")
    if not isinstance(request_id, (str, int)):
        return None
    typed_params = cast(dict[object, object], params_obj)
    params: dict[str, object] = {}
    for raw_key, raw_value in typed_params.items():
        if isinstance(raw_key, str):
            params[raw_key] = raw_value
    return {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "method": cast(EditorRpcMethod, method_obj),
        "params": params,
    }


def coerce_jsonrpc_notification_envelope(payload: object) -> JsonRpcNotificationEnvelope:
    if not isinstance(payload, dict):
        raise EditorRpcProtocolError(JSONRPC_INVALID_REQUEST, "payload_must_be_object")
    raw_payload = cast(dict[object, object], payload)
    jsonrpc_obj = raw_payload.get("jsonrpc")
    method_obj = raw_payload.get("method")
    params_obj = raw_payload.get("params", {})
    if jsonrpc_obj != JSONRPC_VERSION:
        raise EditorRpcProtocolError(JSONRPC_INVALID_REQUEST, "invalid_jsonrpc_version")
    if not isinstance(method_obj, str) or not method_obj:
        raise EditorRpcProtocolError(JSONRPC_INVALID_REQUEST, "missing_method")
    if params_obj is None:
        params_obj = {}
    if not isinstance(params_obj, dict):
        raise EditorRpcProtocolError(JSONRPC_INVALID_PARAMS, "params_must_be_object")
    typed_params = cast(dict[object, object], params_obj)
    params: dict[str, object] = {}
    for raw_key, raw_value in typed_params.items():
        if isinstance(raw_key, str):
            params[raw_key] = raw_value
    return {
        "jsonrpc": JSONRPC_VERSION,
        "method": method_obj,
        "params": params,
    }
