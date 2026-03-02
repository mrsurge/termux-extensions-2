from __future__ import annotations

import asyncio
import json
import os
import stat
import time
from pathlib import Path
from typing import Any

_APP_ID = "file_editor_cm6"
_PROTOCOL_VERSION = 1
_MAX_FRAME_BYTES = 1_048_576
_SUPPORTED_CAPABILITIES = {
    "sidebar.open",
    "sidebar.close",
    "sidebar.ui_hints.set",
    "cwd.get",
    "cwd.set",
    "mention.resolve",
    "mention.insert",
    "agent.open",
    "conversation.active.get",
    "conversation.active.set",
}

_uds_server: asyncio.AbstractServer | None = None
_uds_socket_path: Path | None = None


class _JsonRpcMethodError(Exception):
    def __init__(self, code: int, message: str, data: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def _now_ms() -> int:
    return int(time.time() * 1000)


def _log(event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "ts_ms": _now_ms(),
        **fields,
    }
    print(
        f"[SidebarUDS] {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}",
        flush=True,
    )


def _resolve_socket_path() -> Path:
    configured = (os.getenv("TE_BACKCHANNEL_SOCKET") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    return (Path.home() / ".local" / "share" / "termux-extensions-2" / "runtime" / "te2_sidebar_backchannel.sock").resolve(
        strict=False
    )


def _prepare_socket_dir(socket_path: Path) -> None:
    socket_dir = socket_path.parent
    socket_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(socket_dir, 0o700)
    except PermissionError:
        _log("socket_dir:chmod:skipped", path=str(socket_dir))


def _unlink_stale_socket(socket_path: Path) -> None:
    if not socket_path.exists():
        return
    st = socket_path.lstat()
    if not stat.S_ISSOCK(st.st_mode):
        raise RuntimeError(f"uds path exists but is not a socket: {socket_path}")
    if st.st_uid != os.getuid():
        raise RuntimeError(
            f"refusing to unlink socket owned by uid={st.st_uid}: {socket_path}"
        )
    socket_path.unlink()


def _jsonrpc_result(req_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(
    req_id: Any, code: int, message: str, data: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }
    if data is not None:
        payload["error"]["data"] = data
    return payload


def _error_from_exception(req_id: Any, exc: _JsonRpcMethodError) -> dict[str, Any]:
    data = exc.data if isinstance(exc.data, dict) else None
    return _jsonrpc_error(req_id, exc.code, exc.message, data=data)


def _validate_request(message: Any) -> tuple[bool, Any, str, dict[str, Any]]:
    if not isinstance(message, dict):
        raise _JsonRpcMethodError(-32600, "invalid request: expected object")
    if message.get("jsonrpc") != "2.0":
        raise _JsonRpcMethodError(-32600, "invalid request: jsonrpc must be '2.0'")
    method = message.get("method")
    if not isinstance(method, str) or not method.strip():
        raise _JsonRpcMethodError(-32600, "invalid request: method must be non-empty string")
    has_id = "id" in message
    req_id = message.get("id")
    params = message.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise _JsonRpcMethodError(-32602, "invalid params: expected object")
    return has_id, req_id, method.strip(), params


def _handle_health_ping(params: dict[str, Any]) -> dict[str, Any]:
    ts = params.get("ts")
    if ts is not None and not isinstance(ts, (int, float)):
        raise _JsonRpcMethodError(-32602, "invalid params: ts must be number")
    return {"ts": ts, "now": _now_ms()}


def _handle_session_hello(params: dict[str, Any]) -> dict[str, Any]:
    app_id = params.get("app_id")
    run_id = params.get("run_id")
    protocol_version = params.get("protocol_version")
    pid = params.get("pid")
    origin_role = params.get("origin_role")
    capabilities = params.get("capabilities")

    if not isinstance(app_id, str) or not app_id.strip():
        raise _JsonRpcMethodError(-32602, "invalid params: app_id must be non-empty string")
    if not isinstance(run_id, str) or not run_id.strip():
        raise _JsonRpcMethodError(-32602, "invalid params: run_id must be non-empty string")
    if not isinstance(protocol_version, int):
        raise _JsonRpcMethodError(-32602, "invalid params: protocol_version must be integer")
    if not isinstance(pid, int) or pid <= 0:
        raise _JsonRpcMethodError(-32602, "invalid params: pid must be positive integer")
    if origin_role not in {"host", "agent"}:
        raise _JsonRpcMethodError(-32602, "invalid params: origin_role must be 'host' or 'agent'")
    if not isinstance(capabilities, list) or any(
        not isinstance(item, str) for item in capabilities
    ):
        raise _JsonRpcMethodError(-32602, "invalid params: capabilities must be string[]")
    if protocol_version != _PROTOCOL_VERSION:
        raise _JsonRpcMethodError(
            -32011,
            "bad_version",
            data={"expected": _PROTOCOL_VERSION, "received": protocol_version},
        )

    expected_app_id = (os.getenv("TE_BACKCHANNEL_APP_ID") or "").strip()
    expected_run_id = (os.getenv("TE_BACKCHANNEL_RUN_ID") or "").strip()
    if expected_app_id and app_id != expected_app_id:
        raise _JsonRpcMethodError(
            -32010,
            "bad_identity",
            data={"field": "app_id", "expected": expected_app_id, "received": app_id},
        )
    if expected_run_id and run_id != expected_run_id:
        raise _JsonRpcMethodError(
            -32010,
            "bad_identity",
            data={"field": "run_id", "expected": expected_run_id, "received": run_id},
        )

    accepted = [cap for cap in capabilities if cap in _SUPPORTED_CAPABILITIES]
    return {
        "ok": True,
        "protocol_version": _PROTOCOL_VERSION,
        "accepted_capabilities": accepted,
    }


def _dispatch_request(method: str, params: dict[str, Any]) -> dict[str, Any]:
    if method == "health.ping":
        return _handle_health_ping(params)
    if method == "session.hello":
        return _handle_session_hello(params)
    raise _JsonRpcMethodError(-32601, f"method not found: {method}")


async def _write_message(writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    writer.write(encoded + b"\n")
    await writer.drain()


async def _handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    _log("client:connected", peer=str(peer))
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            if len(line) > _MAX_FRAME_BYTES:
                await _write_message(
                    writer,
                    _jsonrpc_error(None, -32600, "invalid request: frame too large"),
                )
                break
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError:
                await _write_message(
                    writer,
                    _jsonrpc_error(None, -32700, "parse error"),
                )
                continue

            start_ms = _now_ms()
            req_id = None
            method = None
            error_code = None
            response: dict[str, Any] | None = None
            try:
                has_id, req_id, method, params = _validate_request(message)
                result = _dispatch_request(method, params)
                if has_id:
                    response = _jsonrpc_result(req_id, result)
            except _JsonRpcMethodError as exc:
                error_code = exc.code
                try:
                    req_id = message.get("id") if isinstance(message, dict) else None
                except Exception:
                    req_id = None
                response = _error_from_exception(req_id, exc)

            latency = _now_ms() - start_ms
            _log(
                "request",
                req_id=req_id,
                method=method,
                latency_ms=latency,
                error_code=error_code,
            )
            if response is not None:
                await _write_message(writer, response)
    except Exception as exc:
        _log("client:error", error=str(exc))
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        _log("client:disconnected", peer=str(peer))


async def _startup(app) -> None:
    global _uds_server, _uds_socket_path
    if _uds_server is not None:
        return

    socket_path = _resolve_socket_path()
    _prepare_socket_dir(socket_path)
    _unlink_stale_socket(socket_path)

    _uds_server = await asyncio.start_unix_server(
        _handle_client, path=str(socket_path)
    )
    os.chmod(socket_path, 0o600)
    _uds_socket_path = socket_path

    app.state.sidebar_backchannel_uds = {
        "enabled": True,
        "transport": "unix",
        "socket": str(socket_path),
        "protocol_version": _PROTOCOL_VERSION,
        "app_id": _APP_ID,
    }
    _log("server:started", socket=str(socket_path), protocol_version=_PROTOCOL_VERSION)


async def _shutdown(app) -> None:
    global _uds_server, _uds_socket_path
    if _uds_server is not None:
        _uds_server.close()
        await _uds_server.wait_closed()
        _uds_server = None
    if _uds_socket_path is not None:
        try:
            _unlink_stale_socket(_uds_socket_path)
        except Exception as exc:
            _log("server:socket_cleanup_error", socket=str(_uds_socket_path), error=str(exc))
        _uds_socket_path = None
    app.state.sidebar_backchannel_uds = {
        "enabled": False,
        "transport": "unix",
    }
    _log("server:stopped")


def register(app) -> None:
    if getattr(app.state, "_sidebar_backchannel_uds_registered", False):
        return
    app.state._sidebar_backchannel_uds_registered = True

    async def on_startup() -> None:
        await _startup(app)

    async def on_shutdown() -> None:
        await _shutdown(app)

    app.add_event_handler("startup", on_startup)
    app.add_event_handler("shutdown", on_shutdown)
