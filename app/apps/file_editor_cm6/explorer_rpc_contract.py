# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

EXPLORER_RPC_NAMESPACE = "/rpc/explorer"
EXPLORER_RPC_REQUEST_EVENT = "rpc"
EXPLORER_RPC_NOTIFICATION_EVENT = "rpc.notify"

JsonObject = dict[str, object]

LEGACY_REQUEST_TYPE_BY_RPC_METHOD: dict[str, str] = {
    "explorer.cm6.mirror": "cm6:mirror",
    "explorer.dir.create": "explorer:createDir",
    "explorer.entries.copy": "explorer:batchCopy",
    "explorer.entries.delete": "explorer:batchDelete",
    "explorer.entries.move": "explorer:batchMove",
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

RPC_NOTIFICATION_METHOD_BY_LEGACY_TYPE: dict[str, str] = {
    "agent:open": "explorer.agent.open",
    "autosave:content": "explorer.autosave.content",
    "cm6:mirror:ack": "explorer.cm6.mirror.ack",
    "diagnostics:detail": "explorer.diagnostics.detail",
    "draft:content": "explorer.draft.content",
    "editor:prefs_changed": "explorer.editor.prefs.changed",
    "error": "explorer.error",
    "explorer:activeFile": "explorer.activeFile.updated",
    "explorer:created": "explorer.entry.created",
    "explorer:navigate": "explorer.navigate",
    "explorer:setList": "explorer.list.updated",
    "explorer:setOpenDirs": "explorer.openDirs.updated",
    "explorer:setTree": "explorer.tree.updated",
    "explorer:updateDecorations": "explorer.decorations.updated",
    "explorer:updateGitStatus": "explorer.git.decorations.updated",
    "ext:adapter_restarted": "explorer.extensions.adapter.restarted",
    "ext:adapter_restarting": "explorer.extensions.adapter.restarting",
    "ext:configSchema": "explorer.extensions.configSchema.updated",
    "ext:settings_changed": "explorer.extensions.settings.changed",
    "git:cloneStarted": "explorer.git.clone.started",
    "git:diffBaseSet": "explorer.git.diffBase.updated",
    "git:pullStarted": "explorer.git.pull.started",
    "git:pushStarted": "explorer.git.push.started",
    "git:restored": "explorer.git.restored",
    "git:status": "explorer.git.status.updated",
    "job:progress": "explorer.job.progress",
    "prefs:setUi": "explorer.prefs.ui.updated",
    "prefs:vendorAgentIconResult": "explorer.prefs.agentIcon.vendored",
    "project:opened": "explorer.project.opened",
    "project:setActive": "explorer.project.active.updated",
    "pulse": "explorer.pulse",
    "review:setEntries": "explorer.review.entries.updated",
    "search:setResults": "explorer.search.results.updated",
    "watcher:config": "explorer.watcher.config.updated",
    "watcher:error": "explorer.watcher.error",
    "watcher:files": "explorer.watcher.files",
    "watcher:modeChanged": "explorer.watcher.mode.changed",
    "watcher:modeStatus": "explorer.watcher.mode.status",
    "watcher:raiseResult": "explorer.watcher.limit.raiseResult",
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


def parse_explorer_rpc_request(payload: object) -> ParsedExplorerRpcRequest:
    envelope = _as_object(payload)
    if envelope is None:
        raise ExplorerRpcProtocolError(
            None,
            code=-32600,
            message="Invalid request envelope",
        )

    if envelope.get("jsonrpc") != "2.0":
        raise ExplorerRpcProtocolError(
            _coerce_request_id(envelope.get("id")),
            code=-32600,
            message="jsonrpc must be '2.0'",
        )

    method = envelope.get("method")
    if not isinstance(method, str) or not method.strip():
        raise ExplorerRpcProtocolError(
            _coerce_request_id(envelope.get("id")),
            code=-32600,
            message="method is required",
        )

    request_id = _coerce_request_id(envelope.get("id"))
    params = normalize_payload(envelope.get("params"))

    if method not in LEGACY_REQUEST_TYPE_BY_RPC_METHOD:
        raise ExplorerRpcProtocolError(
            request_id,
            code=-32601,
            message=f"Unknown Explorer RPC method: {method}",
            data={"method": method},
        )

    return {
        "request_id": request_id,
        "method": method,
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


def legacy_message_from_rpc_request(parsed: ParsedExplorerRpcRequest) -> JsonObject:
    method = parsed["method"]
    request_id = parsed["request_id"]
    message: JsonObject = {
        "type": LEGACY_REQUEST_TYPE_BY_RPC_METHOD[method],
        "payload": parsed["params"],
    }
    if request_id is not None:
        message["id"] = request_id
    return message


def rpc_notification_from_legacy_message(message: object) -> JsonRpcNotificationEnvelope | None:
    legacy_message = _as_object(message)
    if legacy_message is None:
        return None
    legacy_type = legacy_message.get("type")
    if not isinstance(legacy_type, str) or not legacy_type.strip():
        return None

    method = RPC_NOTIFICATION_METHOD_BY_LEGACY_TYPE.get(legacy_type)
    if method is None:
        return None
    payload = normalize_payload(legacy_message.get("payload"))
    return build_jsonrpc_notification(method, payload)


def build_jsonrpc_success(request_id: str, legacy_message: object) -> JsonRpcSuccessEnvelope:
    legacy = _as_object(legacy_message) or {}
    payload = normalize_payload(legacy.get("payload"))
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": payload,
    }


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


def build_jsonrpc_error_from_legacy_reply(request_id: str, legacy_message: object) -> JsonRpcErrorEnvelope:
    legacy = _as_object(legacy_message) or {}
    payload = normalize_payload(legacy.get("payload"))
    message = payload.get("error")
    error_message = message if isinstance(message, str) and message else "Explorer RPC request failed"
    return build_jsonrpc_error(
        request_id=request_id,
        code=-32000,
        message=error_message,
        data={"legacy_type": cast(object, legacy.get("type"))} if legacy.get("type") is not None else None,
    )
