# pyright: strict
# Explorer JSON-RPC contract surface.
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

from ...socketio_jsonrpc import (
    JsonRpcEnvelopeError,
    coerce_jsonrpc_envelope,
    normalize_jsonrpc_params,
)

EXPLORER_RPC_NAMESPACE = "/rpc/explorer"
EXPLORER_RPC_REQUEST_EVENT = "rpc"
EXPLORER_RPC_NOTIFICATION_EVENT = "rpc.notify"

JsonObject = dict[str, object]

DISPATCHER_MESSAGE_TYPE_BY_RPC_METHOD: dict[str, str] = {
    "explorer.cm6.mirror": "cm6:mirror",
    "explorer.dir.create": "explorer:createDir",
    "explorer.entries.copy": "explorer:batchCopy",
    "explorer.entries.delete": "explorer:batchDelete",
    "explorer.entries.move": "explorer:batchMove",
    "explorer.editor.open": "explorer:editor_open",
    "explorer.entry.copy": "explorer:copy",
    "explorer.entry.copyFrom": "explorer:copyFrom",
    "explorer.entry.delete": "explorer:delete",
    "explorer.entry.move": "explorer:move",
    "explorer.entry.moveFrom": "explorer:moveFrom",
    "explorer.entry.rename": "explorer:rename",
    "explorer.extensions.adapter.restart": "ext:restart_adapter",
    "explorer.extensions.configSchema.get": "ext:configSchema",
    "explorer.extensions.configure": "ext:configure",
    "explorer.extensions.customSettings.get": "ext:custom_settings_get",
    "explorer.extensions.customSettings.set": "ext:custom_settings_set",
    "explorer.extensions.install": "ext:install",
    "explorer.extensions.list": "ext:list",
    "explorer.extensions.toggle": "ext:toggle",
    "explorer.extensions.uninstall": "ext:uninstall",
    "explorer.extensions.workspaceSettings.get": "ext:workspace_settings_get",
    "explorer.extensions.workspaceSettings.set": "ext:workspace_settings_set",
    "explorer.file.create": "explorer:createFile",
    "explorer.git.branches.list": "git:listBranches",
    "explorer.git.clone": "git:clone",
    "explorer.git.commit": "git:commit",
    "explorer.git.commits.list": "git:listCommits",
    "explorer.git.diffBase.set": "git:setDiffBase",
    "explorer.git.init": "git:init",
    "explorer.git.pull": "git:pull",
    "explorer.git.push": "git:push",
    "explorer.git.reset": "git:reset",
    "explorer.git.restore": "git:restore",
    "explorer.git.stage": "git:stage",
    "explorer.git.stageAll": "git:stageAll",
    "explorer.git.status.get": "git:status",
    "explorer.git.unstage": "git:unstage",
    "explorer.git.unstageAll": "git:unstageAll",
    "explorer.list": "explorer:list",
    "explorer.mention.agent": "mention:agent",
    "explorer.openDirs.set": "explorer:setOpenDirs",
    "explorer.prefs.agentIcon.vendor": "prefs:vendorAgentIcon",
    "explorer.prefs.ui.update": "prefs:updateUi",
    "explorer.project.create": "project:create",
    "explorer.project.list": "project:list",
    "explorer.project.open": "project:open",
    "explorer.pulse.alive": "pulse:alive",
    "explorer.refresh": "explorer:refresh",
    "explorer.review.discard": "review:discard",
    "explorer.review.list": "review:list",
    "explorer.review.save": "review:save",
    "explorer.search.run": "search:run",
    "explorer.watcher.config.get": "watcher:getConfig",
    "explorer.watcher.limit.raise": "watcher:raiseLimit",
    "explorer.watcher.mode.set": "watcher:setMode",
}

class JsonRpcErrorObject(TypedDict, total=False):
    code: int
    message: str
    data: JsonObject


class JsonRpcNotificationEnvelope(TypedDict):
    jsonrpc: str
    method: str
    params: JsonObject


class JsonRpcSuccessEnvelope(TypedDict):
    jsonrpc: str
    id: str
    result: JsonObject


class JsonRpcErrorEnvelope(TypedDict):
    jsonrpc: str
    id: str | None
    error: JsonRpcErrorObject


class ParsedExplorerRpcRequest(TypedDict):
    request_id: str | None
    method: str
    params: JsonObject


@dataclass(frozen=True)
class ExplorerRpcProtocolError(Exception):
    request_id: str | None
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


def build_jsonrpc_notification(method: str, params: JsonObject | None = None) -> JsonRpcNotificationEnvelope:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
    }


def build_jsonrpc_result(request_id: str, result: JsonObject) -> JsonRpcSuccessEnvelope:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": result,
    }


def parse_explorer_rpc_request(payload: object) -> ParsedExplorerRpcRequest:
    try:
        envelope = coerce_jsonrpc_envelope(payload)
    except JsonRpcEnvelopeError as exc:
        raise ExplorerRpcProtocolError(
            _coerce_request_id(exc.request_id),
            code=exc.code,
            message=exc.message,
        ) from exc

    request_id = _coerce_request_id(envelope.request_id) if envelope.has_id else None
    params_obj: object = envelope.params
    if params_obj is not None and not isinstance(params_obj, dict):
        raise ExplorerRpcProtocolError(
            request_id,
            code=-32602,
            message="params must be an object",
        )
    params = normalize_jsonrpc_params(cast(object, params_obj))

    if envelope.method not in DISPATCHER_MESSAGE_TYPE_BY_RPC_METHOD:
        raise ExplorerRpcProtocolError(
            request_id,
            code=-32601,
            message=f"Unknown Explorer RPC method: {envelope.method}",
            data={"method": envelope.method},
        )

    return {
        "request_id": request_id,
        "method": envelope.method,
        "params": params,
    }


def _coerce_request_id(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and value:
        return value
    raise ExplorerRpcProtocolError(
        None,
        code=-32600,
        message="request id must be a string when provided",
    )


def dispatcher_message_type_from_rpc_method(method: str) -> str:
    return DISPATCHER_MESSAGE_TYPE_BY_RPC_METHOD[method]


def build_default_jsonrpc_success(request_id: str) -> JsonRpcSuccessEnvelope:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {"ok": True},
    }


def build_jsonrpc_error(
    *,
    request_id: str | None,
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
