from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set
from urllib.parse import urljoin, urlparse

from aiohttp import ClientSession, WSMsgType, web

from .decoder import (
    decode_ext_host_rpc,
    decode_wire_stream,
    encode_ext_request_json_args,
    encode_wire_frame,
    try_decode_handshake,
    try_decode_mgmt_regular,
)


_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _emit(obj: Dict[str, Any]) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    print(line, flush=True)
    if _TRACE_FH is not None:
        try:
            # Enforce bounded trace size by truncating and reusing the same file.
            if _TRACE_PATH and isinstance(_TRACE_MAX_BYTES, int) and _TRACE_MAX_BYTES > 0:
                try:
                    cur = os.path.getsize(_TRACE_PATH)
                except Exception:
                    cur = 0
                if cur + len(line) + 1 > _TRACE_MAX_BYTES:
                    try:
                        _TRACE_FH.seek(0)
                        _TRACE_FH.truncate(0)
                    except Exception:
                        pass
            _TRACE_FH.write(line + "\n")
            _TRACE_FH.flush()
        except Exception:
            pass
    _BUS.publish(obj)


def _write_payload_blob(payload: bytes) -> Optional[Dict[str, Any]]:
    """
    Store a payload in a sidecar binary file and return a reference object.

    This avoids embedding huge base64 blobs into the JSONL trace.
    """
    global _PAYLOAD_FH
    if _PAYLOAD_FH is None or _PAYLOAD_PATH is None:
        return None
    try:
        if _PAYLOAD_PATH and isinstance(_PAYLOAD_MAX_BYTES, int) and _PAYLOAD_MAX_BYTES > 0:
            try:
                cur = os.path.getsize(_PAYLOAD_PATH)
            except Exception:
                cur = 0
            if cur + len(payload) > _PAYLOAD_MAX_BYTES:
                try:
                    _PAYLOAD_FH.seek(0)
                    _PAYLOAD_FH.truncate(0)
                except Exception:
                    pass
        try:
            offset = _PAYLOAD_FH.tell()
        except Exception:
            offset = 0
        _PAYLOAD_FH.write(payload)
        _PAYLOAD_FH.flush()
        digest = hashlib.sha256(payload).hexdigest()
        return {"path": _PAYLOAD_PATH, "offset": int(offset), "len": len(payload), "sha256": digest}
    except Exception:
        return None


def _read_payload_ref(ref: Dict[str, Any]) -> Optional[bytes]:
    path = ref.get("path")
    off = ref.get("offset")
    ln = ref.get("len")
    if not isinstance(path, str) or not isinstance(off, int) or not isinstance(ln, int) or ln < 0 or off < 0:
        return None
    try:
        with open(path, "rb") as f:
            f.seek(off)
            data = f.read(ln)
    except Exception:
        return None
    if len(data) != ln:
        return None
    sha = ref.get("sha256")
    if isinstance(sha, str) and hashlib.sha256(data).hexdigest() != sha:
        return None
    return data


class _Bus:
    def __init__(self) -> None:
        self._clients: Set[web.WebSocketResponse] = set()
        self._lock = asyncio.Lock()

    async def add(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.add(ws)

    async def remove(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.discard(ws)

    def publish(self, payload: Dict[str, Any]) -> None:
        if not self._clients:
            return
        msg = json.dumps({"jsonrpc": "2.0", "method": "te2.event", "params": payload}, ensure_ascii=False)

        async def _fanout() -> None:
            async with self._lock:
                dead = []
                for ws in self._clients:
                    try:
                        await ws.send_str(msg)
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    self._clients.discard(ws)

        asyncio.create_task(_fanout())


_BUS = _Bus()
_TRACE_FH: Optional[Any] = None
_TRACE_PATH: Optional[str] = None
_TRACE_MAX_BYTES: int = 20 * 1024 * 1024
_PAYLOAD_FH: Optional[Any] = None
_PAYLOAD_PATH: Optional[str] = None
_PAYLOAD_MAX_BYTES: int = 100 * 1024 * 1024
_WIRE_LOG: bool = True
_WIRE_PREVIEW_BYTES: int = 0
_WIRE_PAYLOAD_B64: bool = False
_WIRE_PAYLOAD_B64_MAX: int = 8192


async def _discover_server_root_path(session: ClientSession, upstream: str) -> str:
    """
    Best-effort: fetch upstream HTML and locate "/stable-<40hex>" prefix path.
    Falls back to "/" if not found.
    """
    url = upstream.rstrip("/") + "/"
    try:
        # Our proxy ClientSession is created with auto_decompress=False to remain transparent
        # as an HTTP reverse proxy. For discovery we need readable HTML, so we ask the server
        # for identity encoding.
        async with session.get(
            url,
            headers={"accept": "text/html", "accept-encoding": "identity"},
            allow_redirects=True,
            max_redirects=10,
        ) as resp:
            text = await resp.text(errors="ignore")
    except Exception:
        return "/"

    # code-server HTML commonly references stable assets like:
    #   stable-<40hex>/static/out/...
    # or sometimes with a leading slash.
    m = re.search(r"(?:/)?(stable-[0-9a-f]{40})", text)
    if not m:
        return "/"
    return "/" + m.group(1)


def _commit_from_server_root_path(server_root_path: str) -> Optional[str]:
    m = re.match(r"^/stable-([0-9a-f]{40})$", server_root_path)
    if not m:
        return None
    return m.group(1)


def _encode_handshake_message(obj: Dict[str, Any]) -> bytes:
    """
    Encode a handshake control message as observed on code-server:
      0x02 + 11x 0x00 + <u8 len> + <json>
    """
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > 255:
        raise ValueError(f"Handshake payload too large for u8 length: {len(payload)} bytes")
    return bytes([0x02]) + (b"\x00" * 11) + bytes([len(payload)]) + payload


async def _headless_handshake(
    state: _WsDecodeState,
    ws,
    *,
    connection_token: str,
    commit: Optional[str],
    desired_connection_type: int,
    args: Any,
) -> None:
    """
    Perform the control-message handshake used by VS Code web remote connections.
    The signing step is mimicked based on observed code-server behavior: we echo the `sign.data`
    value back as `connectionType.signedData`.
    """
    auth = {
        "type": "auth",
        "auth": connection_token or "00000000000000000000",
        "data": str(uuid.uuid4()),
    }
    auth_b = _encode_handshake_message(auth)
    _decode_ws_bytes(state, direction="c2u", data=auth_b)
    await ws.send_bytes(auth_b)

    async def _recv_handshake_type(expect_type: str) -> Dict[str, Any]:
        while True:
            msg = await ws.receive()
            if msg.type == WSMsgType.BINARY:
                data = bytes(msg.data)
                # Always decode/log what we see (wire frames or handshake JSON).
                _decode_ws_bytes(state, direction="u2c", data=data)
                hs = try_decode_handshake(data)
                if isinstance(hs, dict) and hs.get("type") == expect_type:
                    return hs
                continue
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                raise RuntimeError(f"Socket closed while waiting for {expect_type}")
            # Ignore TEXT/PING/PONG etc.

    # Read sign (handshake control JSON). Some servers may interleave wire-level frames
    # (e.g. ack/keepalive) before control messages; we skip until we see `type: sign`.
    sign = await _recv_handshake_type("sign")
    if not isinstance(sign.get("data"), str):
        raise RuntimeError(f"Unexpected sign message: {sign!r}")

    conn = {
        "type": "connectionType",
        "commit": commit,
        "signedData": sign["data"],
        "desiredConnectionType": desired_connection_type,
    }
    if args is not None:
        conn["args"] = args
    conn_b = _encode_handshake_message(conn)
    _decode_ws_bytes(state, direction="c2u", data=conn_b)
    await ws.send_bytes(conn_b)

    # Wait for ok. Some servers (notably ExtensionHost) may start sending wire-framed
    # protocol data immediately after ConnectionTypeRequest instead of a handshake `ok`.
    # In that case, treat the first wire frame as implicit ok.
    while True:
        msg = await ws.receive()
        if msg.type == WSMsgType.BINARY:
            data = bytes(msg.data)
            _decode_ws_bytes(state, direction="u2c", data=data)

            hs = try_decode_handshake(data)
            if isinstance(hs, dict) and hs.get("type") == "ok":
                break

            # Wire-framed payloads always have a 13-byte header and do not match the handshake framing.
            if len(data) >= 13 and data[:1] != b"\x02":
                break

            continue
        if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
            raise RuntimeError("Socket closed while waiting for ok/wire data")
        # Ignore TEXT/PING/PONG etc.


async def _headless_reader(state: _WsDecodeState) -> None:
    """
    Receive loop for a headless upstream ws; decodes traffic like the MITM path
    and keeps ack tracking current.
    """
    ws = state.upstream_ws
    if ws is None:
        return
    async for msg in ws:
        if msg.type == WSMsgType.BINARY:
            _decode_ws_bytes(state, direction="u2c", data=bytes(msg.data))
        elif msg.type == WSMsgType.TEXT:
            _emit({"type": "headless/text", "ts_ms": _now_ms(), "ws_id": state.ws_id, "data": msg.data})
        elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
            break
    _emit({"type": "headless/close", "ts_ms": _now_ms(), "ws_id": state.ws_id, "stream": state.stream_kind})


async def _headless_flow_pump(
    state: _WsDecodeState,
    *,
    keepalive_interval_s: float = 2.0,
    ack_interval_s: float = 0.25,
) -> None:
    """
    Keep the headless connection alive and responsive to VS Code's wire protocol.

    - KeepAlive (type=9): sent periodically for liveness and to carry ACK in the header.
    - Ack (type=3): sent when our ACK advances (best-effort), to help servers that expect
      explicit ACK frames in addition to KeepAlive.
    """
    ws = state.upstream_ws
    if ws is None:
        return

    last_keepalive_ms = 0
    while True:
        try:
            now_ms = _now_ms()

            # Send Ack frames when our ACK advances.
            ack_to_send = int(state.headless_ack_to_send or 0)
            if ack_to_send > int(state.headless_last_ack_sent or 0):
                frame = encode_wire_frame(3, 0, ack_to_send, b"")
                async with state.upstream_send_lock:
                    _decode_ws_bytes(state, direction="c2u", data=frame)
                    await ws.send_bytes(frame)
                state.headless_last_ack_sent = ack_to_send

            # Send KeepAlive periodically (always include latest ACK).
            if last_keepalive_ms == 0 or (now_ms - last_keepalive_ms) >= int(keepalive_interval_s * 1000):
                frame = encode_wire_frame(9, 0, ack_to_send, b"")
                async with state.upstream_send_lock:
                    _decode_ws_bytes(state, direction="c2u", data=frame)
                    await ws.send_bytes(frame)
                last_keepalive_ms = now_ms

            await asyncio.sleep(ack_interval_s)
        except Exception:
            break

@dataclass
class _ActiveState:
    ext_ws_id: Optional[str] = None

    # last seen hints (best-effort)
    hover_provider_handle: Optional[int] = None
    hover_rpc_id: Optional[int] = None


_ACTIVE = _ActiveState()


def _looks_like_hover_provider_registration(method: str) -> bool:
    # v0: log-only heuristic; handle mapping is future work.
    if "Hover" in method or "hover" in method:
        if "register" in method.lower() or "provider" in method.lower():
            return True
    if method in {"$registerHoverProvider", "$registerLanguageFeatureProvider"}:
        return True
    return False


@dataclass
class _WsDecodeState:
    ws_id: str
    stream_kind: str = "unknown"  # unknown|mgmt|ext
    handshake: Optional[Dict[str, Any]] = None
    buffers: Dict[str, bytearray] = field(default_factory=lambda: {"c2u": bytearray(), "u2c": bytearray()})
    ext_pending: Dict[int, Dict[str, Any]] = field(default_factory=dict)  # keyed by ext.req
    last_rpc_id_by_method: Dict[str, int] = field(default_factory=dict)
    last_hover_provider_handle: Optional[int] = None
    hover_provider_handles: list[int] = field(default_factory=list)
    last_ext_seen_ms: int = 0
    upstream_ws: Optional[Any] = None  # set for ext streams only
    inject_waiters: Dict[int, asyncio.Future] = field(default_factory=dict)  # req -> future
    upstream_send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Headless client tracking (we own the client side).
    headless: bool = False
    # last upstream Regular msg_id we have seen (used in outgoing wire header ACK)
    headless_ack_to_send: int = 0
    headless_next_msg_id: int = 1  # next client->server msg_id for Regular frames
    # last ACK value observed from upstream (i.e. how far upstream has ACKed our Regular messages)
    headless_remote_ack: int = 0
    # server requested us to pause sending (ProtocolMessageType.Pause=7 / Resume=8)
    headless_paused: bool = False
    # helper: blocks sending while paused
    headless_can_send: asyncio.Event = field(default_factory=asyncio.Event)
    # helper: wake senders when upstream ACK advances or we resume
    headless_signal: asyncio.Event = field(default_factory=asyncio.Event)
    # last ack value we sent via explicit Ack frame (type=3)
    headless_last_ack_sent: int = 0

    def __post_init__(self) -> None:
        # Allow sending by default.
        try:
            self.headless_can_send.set()
        except Exception:
            pass


def _safe_uri_to_str(uri_obj: Any) -> Optional[str]:
    if not isinstance(uri_obj, dict):
        return None
    scheme = uri_obj.get("scheme")
    authority = uri_obj.get("authority")
    path = uri_obj.get("path")
    if isinstance(scheme, str) and isinstance(path, str):
        if authority:
            return f"{scheme}://{authority}{path}"
        return f"{scheme}:{path}"
    return None


def _prune_pending(pending: Dict[int, Dict[str, Any]], *, max_items: int = 2000, max_age_ms: int = 120_000) -> None:
    if not pending:
        return
    now = _now_ms()
    stale = [k for k, v in pending.items() if isinstance(v.get("t_ms"), int) and now - int(v["t_ms"]) > max_age_ms]
    for k in stale:
        pending.pop(k, None)
    if len(pending) <= max_items:
        return
    # Drop oldest.
    keys_by_age = sorted(pending.items(), key=lambda kv: int(kv[1].get("t_ms", 0)))
    for k, _v in keys_by_age[: max(0, len(pending) - max_items)]:
        pending.pop(k, None)


def _learn_hover_provider_handle(state: _WsDecodeState, provider_handle: int) -> None:
    state.last_hover_provider_handle = provider_handle
    if provider_handle not in state.hover_provider_handles:
        state.hover_provider_handles.append(provider_handle)
    if _ACTIVE.ext_ws_id == state.ws_id or _ACTIVE.ext_ws_id is None:
        _ACTIVE.hover_provider_handle = provider_handle


def _handle_ext_message(state: _WsDecodeState, *, direction: str, ext: Dict[str, Any]) -> None:
    msg_type = ext.get("type")
    req = ext.get("req")
    if not isinstance(req, int):
        return

    # Request (has method)
    method = ext.get("method")
    if isinstance(method, str):
        _prune_pending(state.ext_pending)
        if isinstance(ext.get("rpcId"), int):
            state.last_rpc_id_by_method[method] = int(ext["rpcId"])
        state.ext_pending[req] = {
            "t_ms": _now_ms(),
            "dir": direction,
            "rpcId": ext.get("rpcId"),
            "method": method,
            "args": ext.get("args"),
        }

        if method == "$changeMany":
            args = ext.get("args")
            owner = args[0] if isinstance(args, list) and len(args) >= 1 else None
            entries = args[1] if isinstance(args, list) and len(args) >= 2 else None
            _emit(
                {
                    "type": "diagnostics/changeMany",
                    "ts_ms": _now_ms(),
                    "ws_id": state.ws_id,
                    "stream": state.stream_kind,
                    "dir": direction,
                    "req": req,
                    "owner": owner,
                    "entries": entries,
                }
            )
            return

        if method == "$provideHover":
            args = ext.get("args")
            provider_handle = args[0] if isinstance(args, list) and len(args) >= 1 else None
            if isinstance(provider_handle, int):
                _learn_hover_provider_handle(state, provider_handle)
            uri = _safe_uri_to_str(args[1]) if isinstance(args, list) and len(args) >= 2 else None
            pos = args[2] if isinstance(args, list) and len(args) >= 3 else None
            _emit(
                {
                    "type": "hover/request",
                    "ts_ms": _now_ms(),
                    "ws_id": state.ws_id,
                    "stream": state.stream_kind,
                    "dir": direction,
                    "req": req,
                    "provider_handle": provider_handle,
                    "uri": uri,
                    "pos": pos,
                }
            )
            return

        if _looks_like_hover_provider_registration(method):
            args = ext.get("args")
            provider_handle = args[0] if isinstance(args, list) and len(args) >= 1 else None
            if method == "$registerHoverProvider" and isinstance(provider_handle, int):
                _learn_hover_provider_handle(state, provider_handle)
            _emit(
                {
                    "type": "hover/provider_registration",
                    "ts_ms": _now_ms(),
                    "ws_id": state.ws_id,
                    "stream": state.stream_kind,
                    "dir": direction,
                    "req": req,
                    "method": method,
                    "args": args,
                }
            )
            return

        return

    waiter = state.inject_waiters.get(req)
    if waiter is not None:
        _emit(
            {
                "type": "inject/seen",
                "ts_ms": _now_ms(),
                "ws_id": state.ws_id,
                "stream": state.stream_kind,
                "dir": direction,
                "req": req,
                "ext_type": msg_type,
                "has_method": isinstance(ext.get("method"), str),
            }
        )
        # If we see an acknowledgement for an injected request, emit it, but keep waiting for the reply.
        if msg_type == 5:
            _emit(
                {
                    "type": "inject/acknowledged",
                    "ts_ms": _now_ms(),
                    "ws_id": state.ws_id,
                    "stream": state.stream_kind,
                    "dir": direction,
                    "req": req,
                }
            )
            return

        if msg_type in (7, 8, 9, 10, 11, 12):
            state.inject_waiters.pop(req, None)
            if not waiter.done():
                waiter.set_result(ext)

    # Reply / non-method frames (observed workbench traffic)
    if msg_type in (7, 9, 10, 11, 12):
        pending = state.ext_pending.pop(req, None)
        if not pending or pending.get("method") != "$provideHover":
            return

        args = pending.get("args") if isinstance(pending.get("args"), list) else []
        provider_handle = args[0] if len(args) >= 1 else None
        uri = _safe_uri_to_str(args[1]) if len(args) >= 2 else None
        pos = args[2] if len(args) >= 3 else None

        _emit(
            {
                "type": "hover/reply",
                "ts_ms": _now_ms(),
                "ws_id": state.ws_id,
                "stream": state.stream_kind,
                "dir": direction,
                "req": req,
                "method": pending.get("method"),
                "request": {
                    "provider_handle": provider_handle,
                    "uri": uri,
                    "pos": pos,
                },
                "reply_type": msg_type,
                "result": ext.get("result"),
                "error": ext.get("error"),
            }
        )


def _decode_ws_bytes(state: _WsDecodeState, *, direction: str, data: bytes) -> None:
    # handshake family (not wire-framed)
    hs = try_decode_handshake(data)
    if hs is not None:
        state.handshake = hs
        # Authoritative stream classifier: connectionType request includes desiredConnectionType.
        if isinstance(hs, dict) and hs.get("type") == "connectionType":
            desired = hs.get("desiredConnectionType")
            if desired == 1:
                state.stream_kind = "mgmt"
            elif desired == 2:
                state.stream_kind = "ext"
        # Connection type may appear here; keep as hint only.
        if state.stream_kind == "unknown":
            ctype = hs.get("connectionType") if isinstance(hs, dict) else None
            if isinstance(ctype, str) and "Management" in ctype:
                state.stream_kind = "mgmt"
            elif isinstance(ctype, str) and "ExtensionHost" in ctype:
                state.stream_kind = "ext"
        _emit(
            {
                "type": "handshake",
                "ts_ms": _now_ms(),
                "ws_id": state.ws_id,
                "stream": state.stream_kind,
                "dir": direction,
                "data": hs,
            }
        )
        return

    buf = state.buffers[direction]
    buf.extend(data)
    frames = decode_wire_stream(buf)
    for fr in frames:
        if state.headless and direction == "u2c":
            # Track upstream flow control + ACK evolution.
            if isinstance(fr.ack, int):
                prev = int(state.headless_remote_ack or 0)
                cur = max(prev, int(fr.ack))
                if cur != prev:
                    state.headless_remote_ack = cur
                    try:
                        state.headless_signal.set()
                    except Exception:
                        pass

            if fr.msg_type == 7:
                # Pause: upstream asks us to stop sending (flow control).
                if not state.headless_paused:
                    state.headless_paused = True
                    try:
                        state.headless_can_send.clear()
                        state.headless_signal.set()
                    except Exception:
                        pass
                    _emit({"type": "headless/pause", "ts_ms": _now_ms(), "ws_id": state.ws_id, "stream": state.stream_kind})

            if fr.msg_type == 8:
                # Resume: upstream allows us to continue sending.
                if state.headless_paused:
                    state.headless_paused = False
                    try:
                        state.headless_can_send.set()
                        state.headless_signal.set()
                    except Exception:
                        pass
                    _emit({"type": "headless/resume", "ts_ms": _now_ms(), "ws_id": state.ws_id, "stream": state.stream_kind})

            if fr.msg_type == 1 and isinstance(fr.msg_id, int) and fr.msg_id > 0:
                # Only Regular messages are counted/ACKed.
                state.headless_ack_to_send = max(int(state.headless_ack_to_send or 0), int(fr.msg_id))
                try:
                    state.headless_signal.set()
                except Exception:
                    pass

        if _WIRE_LOG:
            preview_hex = ""
            if isinstance(_WIRE_PREVIEW_BYTES, int) and _WIRE_PREVIEW_BYTES > 0 and fr.payload:
                preview_hex = fr.payload[: _WIRE_PREVIEW_BYTES].hex()

            payload_b64 = ""
            payload_ref: Optional[Dict[str, Any]] = None
            if _WIRE_PAYLOAD_B64 and fr.payload and isinstance(_WIRE_PAYLOAD_B64_MAX, int) and _WIRE_PAYLOAD_B64_MAX > 0:
                if len(fr.payload) <= _WIRE_PAYLOAD_B64_MAX:
                    payload_b64 = base64.b64encode(fr.payload).decode("ascii")
                else:
                    payload_ref = _write_payload_blob(fr.payload)
            _emit(
                {
                    "type": "wire/frame",
                    "ts_ms": _now_ms(),
                    "ws_id": state.ws_id,
                    "stream": state.stream_kind,
                    "dir": direction,
                    "wire": {
                        "msg_type": fr.msg_type,
                        "msg_id": fr.msg_id,
                        "ack": fr.ack,
                        "payload_len": len(fr.payload),
                        "payload_preview_hex": preview_hex,
                        "payload_b64": payload_b64,
                        "payload_ref": payload_ref,
                    },
                }
            )

        # Only Regular frames contain upper-layer payload.
        if fr.msg_type != 1:
            continue

        if state.stream_kind in ("unknown", "mgmt"):
            mgmt = try_decode_mgmt_regular(fr.payload)
            if mgmt is not None:
                if state.stream_kind == "unknown":
                    state.stream_kind = "mgmt"
                _emit(
                    {
                        "type": "mgmt/regular",
                        "ts_ms": _now_ms(),
                        "ws_id": state.ws_id,
                        "stream": state.stream_kind,
                        "dir": direction,
                        "wire": {"msg_id": fr.msg_id, "ack": fr.ack, "payload_len": len(fr.payload)},
                        "data": mgmt,
                    }
                )
                continue

        ext = decode_ext_host_rpc(fr.payload)
        if ext.get("kind") == "ext" and isinstance(ext.get("type"), int):
            if state.stream_kind == "unknown":
                state.stream_kind = "ext"
            state.last_ext_seen_ms = _now_ms()
            if state.stream_kind == "ext":
                _ACTIVE.ext_ws_id = state.ws_id
                hover_rpc_id = state.last_rpc_id_by_method.get("$provideHover")
                if isinstance(hover_rpc_id, int):
                    _ACTIVE.hover_rpc_id = hover_rpc_id
            _handle_ext_message(state, direction=direction, ext=ext)
            if _WIRE_LOG:
                _emit(
                    {
                        "type": "ext/regular",
                        "ts_ms": _now_ms(),
                        "ws_id": state.ws_id,
                        "stream": state.stream_kind,
                        "dir": direction,
                        "wire": {"msg_id": fr.msg_id, "ack": fr.ack, "payload_len": len(fr.payload)},
                        "ext": {
                            "type": ext.get("type"),
                            "req": ext.get("req"),
                            "rpcId": ext.get("rpcId"),
                            "method": ext.get("method"),
                        },
                    }
                )


async def _pipe_ws(state: _WsDecodeState, src, dst, *, direction: str) -> None:
    async for msg in src:
        if msg.type == WSMsgType.BINARY:
            data = bytes(msg.data)
            _decode_ws_bytes(state, direction=direction, data=data)
            if direction == "c2u":
                async with state.upstream_send_lock:
                    await dst.send_bytes(data)
            else:
                await dst.send_bytes(data)
        elif msg.type == WSMsgType.TEXT:
            if direction == "c2u":
                async with state.upstream_send_lock:
                    await dst.send_str(msg.data)
            else:
                await dst.send_str(msg.data)
        elif msg.type == WSMsgType.PING:
            await dst.ping()
        elif msg.type == WSMsgType.PONG:
            await dst.pong()
        elif msg.type == WSMsgType.CLOSE:
            await dst.close()
        elif msg.type == WSMsgType.ERROR:
            break


def _filtered_headers(headers: "web.BaseRequest.headers.__class__") -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in _HOP_BY_HOP:
            continue
        out[k] = v
    return out


def _is_hex12(s: str) -> bool:
    return bool(re.match(r"^[0-9a-f]{12}$", s))


def _pick_trace_source_ext_ws_id(trace_path: str) -> Optional[str]:
    """
    Choose a likely 'real frontend' ExtensionHost ws_id from a trace file.

    We prefer ws_id values that look like the MITM client ids (12 hex chars)
    and have many c2u Regular frames with payload_b64 populated.
    """
    best_ws: Optional[str] = None
    best_score = -1
    counts: Dict[str, int] = {}
    bonus: Dict[str, int] = {}
    try:
        with open(trace_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") == "hover/provider_registration":
                    ws = o.get("ws_id")
                    if isinstance(ws, str) and _is_hex12(ws):
                        bonus[ws] = bonus.get(ws, 0) + 1000
                    continue

                if o.get("type") != "wire/frame" or o.get("stream") != "ext" or o.get("dir") != "c2u":
                    continue
                ws = o.get("ws_id")
                if not isinstance(ws, str) or not _is_hex12(ws):
                    continue
                w = o.get("wire") or {}
                if not w.get("payload_b64"):
                    continue
                counts[ws] = counts.get(ws, 0) + 1
    except Exception:
        return None

    for ws, c in counts.items():
        score = c + bonus.get(ws, 0)
        if score > best_score:
            best_score = score
            best_ws = ws
    return best_ws


def _pick_trace_source_mgmt_ws_id(trace_path: str) -> Optional[str]:
    """
    Choose a likely 'real frontend' Management ws_id from a trace file.
    """
    best_ws: Optional[str] = None
    best_score = -1
    counts: Dict[str, int] = {}
    try:
        with open(trace_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") != "wire/frame" or o.get("stream") != "mgmt" or o.get("dir") != "c2u":
                    continue
                ws = o.get("ws_id")
                if not isinstance(ws, str) or not _is_hex12(ws):
                    continue
                w = o.get("wire") or {}
                msg_type = w.get("msg_type")
                if msg_type == 9:
                    continue
                if not (w.get("payload_b64") or w.get("payload_ref") or w.get("payload_len") == 0):
                    continue
                counts[ws] = counts.get(ws, 0) + 1
    except Exception:
        return None

    for ws, c in counts.items():
        if c > best_score:
            best_score = c
            best_ws = ws
    return best_ws


def _load_bootstrap_payloads_from_trace(
    trace_path: str,
    *,
    source_ws_id: Optional[str],
    stream_kind: str,
    max_frames: int,
    max_payload_len: int,
) -> Dict[str, Any]:
    """
    Extract a sequence of ExtensionHost client->upstream Regular payloads suitable for replay.

    Returns a dict with:
      - ok: bool
      - source_ws_id: str
      - payloads: list[bytes]
      - skipped_no_b64: int
      - skipped_too_large: int
    """
    if not isinstance(trace_path, str) or not trace_path:
        return {"ok": False, "error": "trace_path missing"}

    if source_ws_id is None:
        if stream_kind == "mgmt":
            source_ws_id = _pick_trace_source_mgmt_ws_id(trace_path)
        else:
            source_ws_id = _pick_trace_source_ext_ws_id(trace_path)
    if not isinstance(source_ws_id, str) or not source_ws_id:
        return {"ok": False, "error": "could not pick source_ws_id from trace"}

    frames: list[Dict[str, Any]] = []
    skipped_no_b64 = 0
    skipped_too_large = 0

    try:
        with open(trace_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") != "wire/frame" or o.get("ws_id") != source_ws_id:
                    continue
                if o.get("stream") != stream_kind or o.get("dir") != "c2u":
                    continue
                w = o.get("wire") or {}
                msg_type = w.get("msg_type")
                if not isinstance(msg_type, int):
                    continue
                # Don't replay keepalive/ack-only frames from the trace; headless flow pump covers those.
                if msg_type in (3, 9):
                    continue
                ln = w.get("payload_len")
                if isinstance(ln, int) and isinstance(max_payload_len, int) and max_payload_len > 0 and ln > max_payload_len:
                    skipped_too_large += 1
                    continue

                # 0-length payload frames are meaningful (e.g. Pause/Resume/Ack/etc) and don't
                # require base64 capture to replay.
                if ln == 0:
                    frames.append({"msg_type": msg_type, "payload": b""})
                else:
                    b64 = w.get("payload_b64")
                    if isinstance(b64, str) and b64:
                        try:
                            payload = base64.b64decode(b64)
                            frames.append({"msg_type": msg_type, "payload": payload})
                            if len(frames) >= max_frames:
                                break
                            continue
                        except Exception:
                            skipped_no_b64 += 1

                    pref = w.get("payload_ref")
                    if isinstance(pref, dict):
                        payload = _read_payload_ref(pref)
                        if payload is not None:
                            frames.append({"msg_type": msg_type, "payload": payload})
                            if len(frames) >= max_frames:
                                break
                            continue

                    skipped_no_b64 += 1
                if len(frames) >= max_frames:
                    break
    except Exception as e:
        return {"ok": False, "error": f"failed to read trace: {e}"}

    return {
        "ok": True,
        "source_ws_id": source_ws_id,
        "frames": frames,
        "skipped_no_b64": skipped_no_b64,
        "skipped_too_large": skipped_too_large,
        "stream_kind": stream_kind,
    }


def _trace_summary(trace_path: str) -> Dict[str, Any]:
    """
    Summarize which ws_ids exist in a trace and whether they have replayable payloads.
    """
    by_stream_dir: Dict[str, int] = {}
    ext_b64: Dict[str, int] = {}
    mgmt_b64: Dict[str, int] = {}
    ext_any: Dict[str, int] = {}
    mgmt_any: Dict[str, int] = {}

    try:
        with open(trace_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                t = o.get("type")
                if t and isinstance(t, str):
                    by_stream_dir[t] = by_stream_dir.get(t, 0) + 1

                if o.get("type") != "wire/frame":
                    continue
                ws = o.get("ws_id")
                if not isinstance(ws, str) or not _is_hex12(ws):
                    continue
                stream = o.get("stream")
                direction = o.get("dir")
                if not isinstance(stream, str) or not isinstance(direction, str):
                    continue
                key = f"{stream}/{direction}"
                by_stream_dir[key] = by_stream_dir.get(key, 0) + 1

                if direction != "c2u":
                    continue
                w = o.get("wire") or {}
                if not isinstance(w, dict):
                    continue
                if w.get("msg_type") in (3, 9):
                    continue
                if stream == "ext":
                    ext_any[ws] = ext_any.get(ws, 0) + 1
                    if w.get("payload_b64") or w.get("payload_ref") or w.get("payload_len") == 0:
                        ext_b64[ws] = ext_b64.get(ws, 0) + 1
                if stream == "mgmt":
                    mgmt_any[ws] = mgmt_any.get(ws, 0) + 1
                    if w.get("payload_b64") or w.get("payload_ref") or w.get("payload_len") == 0:
                        mgmt_b64[ws] = mgmt_b64.get(ws, 0) + 1
    except Exception as e:
        return {"ok": False, "error": str(e)}

    def _top(d: Dict[str, int], n: int = 10) -> list[Dict[str, Any]]:
        return [{"ws_id": k, "count": v} for k, v in sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:n]]

    return {
        "ok": True,
        "trace_path": trace_path,
        "counts": {
            "ext_c2u_non_keepalive_frames": sum(ext_any.values()),
            "ext_c2u_replayable_frames": sum(ext_b64.values()),
            "mgmt_c2u_non_keepalive_frames": sum(mgmt_any.values()),
            "mgmt_c2u_replayable_frames": sum(mgmt_b64.values()),
        },
        "top": {
            "ext_replayable_ws": _top(ext_b64),
            "mgmt_replayable_ws": _top(mgmt_b64),
        },
    }


async def _close_headless(app: web.Application) -> None:
    headless = app.get("headless") or {}
    for kind in ("mgmt", "ext"):
        entry = headless.get(kind)
        if isinstance(entry, dict):
            for task_name in ("reader_task", "flow_task", "ack_task"):
                t = entry.get(task_name)
                if isinstance(t, asyncio.Task):
                    t.cancel()
            ws = entry.get("ws")
            if ws is not None:
                try:
                    await ws.close()
                except Exception:
                    pass
    headless["mgmt"] = None
    headless["ext"] = None


async def _te2_rpc_ws(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(autoping=True)
    await ws.prepare(request)
    await _BUS.add(ws)
    _emit({"type": "te2/ws_open", "ts_ms": _now_ms()})

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        try:
            obj = json.loads(msg.data)
        except Exception:
            continue

        if not isinstance(obj, dict) or obj.get("jsonrpc") != "2.0":
            continue
        mid = obj.get("id")
        method = obj.get("method")
        params = obj.get("params") or {}

        async def reply_ok(result: Any) -> None:
            if mid is None:
                return
            try:
                await ws.send_str(json.dumps({"jsonrpc": "2.0", "id": mid, "result": result}, ensure_ascii=False))
            except Exception:
                return

        async def reply_err(code: int, message: str, data: Any = None) -> None:
            if mid is None:
                return
            err: Dict[str, Any] = {"code": code, "message": message}
            if data is not None:
                err["data"] = data
            try:
                await ws.send_str(json.dumps({"jsonrpc": "2.0", "id": mid, "error": err}, ensure_ascii=False))
            except Exception:
                return

        if method == "te2.ping":
            await reply_ok({"ok": True, "ts_ms": _now_ms()})
            continue

        if method == "te2.status":
            active_state = _pick_ext_state(request.app, ws_id=_ACTIVE.ext_ws_id)
            hover_provider_handles = list(active_state.hover_provider_handles) if active_state is not None else []
            headless = request.app.get("headless") or {}
            await reply_ok(
                {
                    "ok": True,
                    "ts_ms": _now_ms(),
                    "active": {
                        "ext_ws_id": _ACTIVE.ext_ws_id,
                        "hover_provider_handle": _ACTIVE.hover_provider_handle,
                        "hover_provider_handles": hover_provider_handles,
                        "hover_rpc_id": _ACTIVE.hover_rpc_id,
                    },
                    "headless": {
                        "mgmt_ws_id": headless.get("mgmt", {}).get("ws_id") if isinstance(headless.get("mgmt"), dict) else None,
                        "ext_ws_id": headless.get("ext", {}).get("ws_id") if isinstance(headless.get("ext"), dict) else None,
                        "server_root_path": headless.get("server_root_path"),
                        "commit": headless.get("commit"),
                    },
                }
            )
            continue

        if method == "vscode.connect":
            upstream: str = request.app["upstream"]
            session: ClientSession = request.app["session"]

            # Replace any existing headless connections.
            await _close_headless(request.app)

            connection_token = params.get("connection_token") or "00000000000000000000"
            server_root_path = params.get("server_root_path")
            if not isinstance(server_root_path, str) or not server_root_path.startswith("/"):
                server_root_path = await _discover_server_root_path(session, upstream)
            commit = params.get("commit")
            if not isinstance(commit, str) or not commit:
                commit = _commit_from_server_root_path(server_root_path)

            reconnection = bool(params.get("reconnection", False))

            def _to_ws_url(path: str, *, reconnection_token: str) -> str:
                base = urljoin(upstream.rstrip("/") + "/", path.lstrip("/"))
                parsed = urlparse(base)
                ws_scheme = "wss" if parsed.scheme == "https" else "ws"
                q = f"reconnectionToken={reconnection_token}&reconnection={'true' if reconnection else 'false'}&skipWebSocketFrames=false"
                return parsed._replace(scheme=ws_scheme, query=q).geturl()

            # Management connection (ConnectionType.Management = 1)
            mgmt_ws_id = "hmgmt" + uuid.uuid4().hex[:8]
            mgmt_state = _WsDecodeState(ws_id=mgmt_ws_id, stream_kind="mgmt")
            mgmt_state.headless = True
            mgmt_url = _to_ws_url(server_root_path, reconnection_token=str(uuid.uuid4()))
            mgmt_ws = await session.ws_connect(mgmt_url)
            mgmt_state.upstream_ws = mgmt_ws
            request.app["ws_states"][mgmt_ws_id] = mgmt_state
            await _headless_handshake(
                mgmt_state,
                mgmt_ws,
                connection_token=connection_token,
                commit=commit,
                desired_connection_type=1,
                args=None,
            )

            # ExtensionHost connection (ConnectionType.ExtensionHost = 2)
            ext_ws_id = "hext" + uuid.uuid4().hex[:8]
            ext_state = _WsDecodeState(ws_id=ext_ws_id, stream_kind="ext")
            ext_state.headless = True
            ext_url = _to_ws_url(server_root_path, reconnection_token=str(uuid.uuid4()))
            ext_ws = await session.ws_connect(ext_url)
            ext_state.upstream_ws = ext_ws
            request.app["ws_states"][ext_ws_id] = ext_state
            ext_args = params.get("ext_args")
            if ext_args is None:
                ext_args = {"language": "en"}
            await _headless_handshake(
                ext_state,
                ext_ws,
                connection_token=connection_token,
                commit=commit,
                desired_connection_type=2,
                args=ext_args,
            )

            # Start background tasks
            mgmt_reader = asyncio.create_task(_headless_reader(mgmt_state))
            mgmt_flow = asyncio.create_task(_headless_flow_pump(mgmt_state))
            ext_reader = asyncio.create_task(_headless_reader(ext_state))
            ext_flow = asyncio.create_task(_headless_flow_pump(ext_state))

            request.app["headless"] = {
                "server_root_path": server_root_path,
                "commit": commit,
                "mgmt": {"ws_id": mgmt_ws_id, "ws": mgmt_ws, "reader_task": mgmt_reader, "flow_task": mgmt_flow},
                "ext": {"ws_id": ext_ws_id, "ws": ext_ws, "reader_task": ext_reader, "flow_task": ext_flow},
            }

            _ACTIVE.ext_ws_id = ext_ws_id
            await reply_ok({"ok": True, "server_root_path": server_root_path, "commit": commit, "mgmt_ws_id": mgmt_ws_id, "ext_ws_id": ext_ws_id})
            continue

        if method == "te2.trace_stats":
            trace_path = params.get("trace_path") or "hugelog.json"
            if not isinstance(trace_path, str) or not trace_path:
                await reply_err(-32602, "Invalid params; need trace_path as string")
                continue
            await reply_ok(_trace_summary(trace_path))
            continue

        if method == "vscode.bootstrap_from_trace":
            trace_path = params.get("trace_path") or "hugelog.json"
            source_ws_id = params.get("source_ws_id")
            max_frames = int(params.get("max_frames", 200))
            delay_ms = int(params.get("delay_ms", 0))
            max_payload_len = int(params.get("max_payload_len", 8192))
            max_inflight = int(params.get("max_inflight", 128))
            send_timeout_ms = int(params.get("send_timeout_ms", 15_000))
            include_mgmt = bool(params.get("include_mgmt", False))
            mgmt_source_ws_id = params.get("mgmt_source_ws_id")
            mgmt_max_frames = int(params.get("mgmt_max_frames", max_frames))

            if not isinstance(trace_path, str) or not trace_path:
                await reply_err(-32602, "Invalid params; need trace_path as string")
                continue
            if source_ws_id is not None and not isinstance(source_ws_id, str):
                await reply_err(-32602, "Invalid params; source_ws_id must be string if provided")
                continue

            target_ws_id = params.get("ws_id") or _ACTIVE.ext_ws_id
            target_state = _pick_ext_state(request.app, ws_id=target_ws_id)
            if target_state is None or target_state.upstream_ws is None:
                await reply_err(-32001, "No active ExtHost WS to replay into; call vscode.connect first", {"active": {"ext_ws_id": _ACTIVE.ext_ws_id}})
                continue
            if not target_state.headless:
                await reply_err(-32006, "bootstrap replay requires a headless ext connection (vscode.connect)")
                continue

            mgmt_state = None
            if include_mgmt:
                headless = request.app.get("headless") or {}
                mgmt_ws_id = headless.get("mgmt", {}).get("ws_id") if isinstance(headless.get("mgmt"), dict) else None
                mgmt_state = _pick_ext_state(request.app, ws_id=mgmt_ws_id) if False else request.app["ws_states"].get(mgmt_ws_id) if isinstance(mgmt_ws_id, str) else None
                if mgmt_state is None or mgmt_state.upstream_ws is None:
                    await reply_err(-32009, "include_mgmt requested but no headless mgmt WS is available", {"headless": headless})
                    continue

            loaded_ext = _load_bootstrap_payloads_from_trace(
                trace_path,
                source_ws_id=source_ws_id,
                stream_kind="ext",
                max_frames=max_frames,
                max_payload_len=max_payload_len,
            )
            if not loaded_ext.get("ok"):
                await reply_err(-32007, "Failed to load ext bootstrap payloads from trace", loaded_ext)
                continue

            loaded_mgmt = None
            if include_mgmt and mgmt_state is not None:
                loaded_mgmt = _load_bootstrap_payloads_from_trace(
                    trace_path,
                    source_ws_id=mgmt_source_ws_id,
                    stream_kind="mgmt",
                    max_frames=mgmt_max_frames,
                    max_payload_len=max_payload_len,
                )
                if not loaded_mgmt.get("ok"):
                    await reply_err(
                        -32010,
                        "Failed to load mgmt bootstrap payloads from trace (likely no mgmt traffic captured; open the real workbench through the proxy once to record mgmt WS)",
                        {"mgmt": loaded_mgmt, "trace": _trace_summary(trace_path)},
                    )
                    continue

            frames_ext: list[Dict[str, Any]] = loaded_ext["frames"]
            frames_mgmt: list[Dict[str, Any]] = loaded_mgmt["frames"] if isinstance(loaded_mgmt, dict) else []
            _emit(
                {
                    "type": "bootstrap/replay_start",
                    "ts_ms": _now_ms(),
                    "target_ws_id": target_state.ws_id,
                    "source_ws_id": loaded_ext.get("source_ws_id"),
                    "count": len(frames_ext),
                    "include_mgmt": include_mgmt,
                    "mgmt_source_ws_id": loaded_mgmt.get("source_ws_id") if isinstance(loaded_mgmt, dict) else None,
                    "mgmt_count": len(frames_mgmt),
                    "delay_ms": delay_ms,
                }
            )

            sent = 0
            try:
                # Replay mgmt first (if requested) to better approximate frontend startup.
                if include_mgmt and mgmt_state is not None and frames_mgmt:
                    for fr in frames_mgmt:
                        msg_type = fr.get("msg_type")
                        payload = fr.get("payload")
                        if not isinstance(msg_type, int) or not isinstance(payload, (bytes, bytearray)):
                            continue
                        await _headless_wait_send_ok(mgmt_state, max_inflight=max_inflight, timeout_ms=send_timeout_ms)
                        if msg_type == 1:
                            wire_msg_id = mgmt_state.headless_next_msg_id
                            mgmt_state.headless_next_msg_id += 1
                        else:
                            wire_msg_id = 0
                        wire_ack = int(mgmt_state.headless_ack_to_send or 0)
                        wire = encode_wire_frame(int(msg_type), int(wire_msg_id), wire_ack, bytes(payload))
                        async with mgmt_state.upstream_send_lock:
                            _decode_ws_bytes(mgmt_state, direction="c2u", data=wire)
                            await mgmt_state.upstream_ws.send_bytes(wire)
                        sent += 1
                        if delay_ms > 0:
                            await asyncio.sleep(delay_ms / 1000)

                for fr in frames_ext:
                    msg_type = fr.get("msg_type")
                    payload = fr.get("payload")
                    if not isinstance(msg_type, int) or not isinstance(payload, (bytes, bytearray)):
                        continue
                    await _headless_wait_send_ok(target_state, max_inflight=max_inflight, timeout_ms=send_timeout_ms)
                    if msg_type == 1:
                        wire_msg_id = target_state.headless_next_msg_id
                        target_state.headless_next_msg_id += 1
                    else:
                        # Observed control frames use msg_id=0
                        wire_msg_id = 0
                    wire_ack = int(target_state.headless_ack_to_send or 0)
                    wire = encode_wire_frame(int(msg_type), int(wire_msg_id), wire_ack, bytes(payload))
                    async with target_state.upstream_send_lock:
                        _decode_ws_bytes(target_state, direction="c2u", data=wire)
                        await target_state.upstream_ws.send_bytes(wire)
                    sent += 1
                    if delay_ms > 0:
                        await asyncio.sleep(delay_ms / 1000)
            except Exception as e:
                _emit({"type": "bootstrap/replay_error", "ts_ms": _now_ms(), "target_ws_id": target_state.ws_id, "sent": sent, "error": str(e)})
                await reply_err(-32008, "Replay failed while sending", {"sent": sent, "error": str(e)})
                continue

            _emit({"type": "bootstrap/replay_done", "ts_ms": _now_ms(), "target_ws_id": target_state.ws_id, "sent": sent})
            await reply_ok(
                {
                    "ok": True,
                    "target_ws_id": target_state.ws_id,
                    "source_ws_id": loaded_ext.get("source_ws_id"),
                    "sent": sent,
                    "skipped_no_b64": loaded_ext.get("skipped_no_b64"),
                    "skipped_too_large": loaded_ext.get("skipped_too_large"),
                    "mgmt": {
                        "included": include_mgmt,
                        "source_ws_id": loaded_mgmt.get("source_ws_id") if isinstance(loaded_mgmt, dict) else None,
                        "skipped_no_b64": loaded_mgmt.get("skipped_no_b64") if isinstance(loaded_mgmt, dict) else None,
                        "skipped_too_large": loaded_mgmt.get("skipped_too_large") if isinstance(loaded_mgmt, dict) else None,
                    },
                    "state": {
                        "headless_ack_to_send": target_state.headless_ack_to_send,
                        "headless_next_msg_id": target_state.headless_next_msg_id,
                        "hover_provider_handles": target_state.hover_provider_handles,
                        "known_methods": sorted(list(target_state.last_rpc_id_by_method.keys()))[:50],
                    },
                }
            )
            continue

        if method == "vscode.hover":
            # Best-effort injection: requires an active ExtHost stream (usually created by a hidden iframe session).
            uri = params.get("uri")
            line = params.get("lineNumber")
            col = params.get("column")
            ws_id = params.get("ws_id") or _ACTIVE.ext_ws_id
            provider_handle = params.get("provider_handle")
            rpc_id_override = params.get("rpc_id")
            timeout_ms = int(params.get("timeout_ms", 3000))
            wire_msg_id = int(params.get("wire_msg_id", 0))
            wire_ack = int(params.get("wire_ack", 0))
            cancellable = bool(params.get("cancellable", False))

            if not isinstance(uri, str) or not isinstance(line, int) or not isinstance(col, int):
                await reply_err(-32602, "Invalid params; need uri,lineNumber,column")
                continue

            target_state = _pick_ext_state(request.app, ws_id=ws_id)
            if target_state is None or target_state.upstream_ws is None:
                states: Dict[str, _WsDecodeState] = request.app["ws_states"]
                ext_ws_ids = sorted([s.ws_id for s in states.values() if s.stream_kind == "ext" and s.upstream_ws is not None])
                await reply_err(
                    -32001,
                    "No active ExtHost WS; open code-server session first (hidden iframe)",
                    {"active": {"ext_ws_id": _ACTIVE.ext_ws_id}, "available": {"ext_ws_ids": ext_ws_ids}},
                )
                continue

            if not isinstance(provider_handle, int):
                provider_handle = target_state.last_hover_provider_handle
            if not isinstance(provider_handle, int):
                if target_state.hover_provider_handles:
                    provider_handle = target_state.hover_provider_handles[-1]

            if not isinstance(provider_handle, int):
                await reply_err(
                    -32002,
                    "No provider_handle available yet; wait for $registerHoverProvider or trigger a real hover",
                    {"active": {"ext_ws_id": _ACTIVE.ext_ws_id}, "known": {"hover_provider_handles": target_state.hover_provider_handles}},
                )
                continue

            rpc_id = target_state.last_rpc_id_by_method.get("$provideHover")
            if isinstance(rpc_id_override, int):
                rpc_id = rpc_id_override
            if not isinstance(rpc_id, int):
                await reply_err(-32003, "No rpcId for $provideHover observed yet; trigger a real hover first", {"active": {"ext_ws_id": _ACTIVE.ext_ws_id}})
                continue

            # Request id: pick a random high value to avoid collision with workbench.
            req = int(uuid.uuid4().int & 0x7FFFFFFF)
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            target_state.inject_waiters[req] = fut

            # For headless connections, we must speak correct wire sequencing.
            if target_state.headless:
                await _headless_wait_send_ok(target_state, max_inflight=int(params.get("max_inflight", 128)), timeout_ms=int(params.get("send_timeout_ms", 15_000)))
                wire_msg_id = target_state.headless_next_msg_id
                target_state.headless_next_msg_id += 1
                wire_ack = int(target_state.headless_ack_to_send or 0)

            _emit(
                {
                    "type": "inject/sent",
                    "ts_ms": _now_ms(),
                    "ws_id": target_state.ws_id,
                    "stream": target_state.stream_kind,
                    "req": req,
                    "wire": {"msg_id": wire_msg_id, "ack": wire_ack},
                    "rpc": {"rpcId": rpc_id, "method": "$provideHover", "provider_handle": provider_handle},
                    "uri": uri,
                    "pos": {"lineNumber": line, "column": col},
                }
            )

            # Build args as seen in HARs: [providerHandle, uriObj, {lineNumber,column}, {}]
            parsed = urlparse(uri)
            uri_obj = {
                "scheme": parsed.scheme or "vscode-remote",
                "authority": parsed.netloc or "localhost:8080",
                "path": parsed.path,
            }
            args = [provider_handle, uri_obj, {"lineNumber": line, "column": col}, {}]
            payload = encode_ext_request_json_args(req=req, rpc_id=rpc_id, method="$provideHover", args=args, cancellable=cancellable)

            wire = encode_wire_frame(1, wire_msg_id, wire_ack, payload)
            try:
                async with target_state.upstream_send_lock:
                    await target_state.upstream_ws.send_bytes(wire)
            except Exception as e:
                target_state.inject_waiters.pop(req, None)
                await reply_err(-32004, "Failed to write to upstream ExtHost WS", str(e))
                continue

            try:
                ext_reply = await asyncio.wait_for(fut, timeout=timeout_ms / 1000)
            except asyncio.TimeoutError:
                target_state.inject_waiters.pop(req, None)
                await reply_err(-32005, "Timed out waiting for hover reply")
                continue

            await reply_ok({"req": req, "reply": ext_reply})
            continue

        await reply_err(-32601, f"Method not found: {method}")

    await _BUS.remove(ws)
    return ws


def _pick_ext_state(app: web.Application, *, ws_id: Optional[str]) -> Optional[_WsDecodeState]:
    states: Dict[str, _WsDecodeState] = app["ws_states"]
    if ws_id:
        st = states.get(ws_id)
        if st and st.stream_kind == "ext":
            return st
        return None
    # Pick most recently active ext stream.
    ext_states = [s for s in states.values() if s.stream_kind == "ext" and s.upstream_ws is not None]
    if not ext_states:
        return None
    return sorted(ext_states, key=lambda s: s.last_ext_seen_ms, reverse=True)[0]


def _headless_inflight(state: _WsDecodeState) -> int:
    """
    Best-effort estimate of in-flight Regular messages we have sent but upstream has not ACKed yet.
    """
    last_sent = int(state.headless_next_msg_id or 1) - 1
    acked = int(state.headless_remote_ack or 0)
    return max(0, last_sent - acked)


async def _headless_wait_send_ok(
    state: _WsDecodeState,
    *,
    max_inflight: int = 128,
    timeout_ms: int = 15_000,
) -> None:
    """
    Wait until it is safe to send more data on a headless connection.

    - Respects Pause/Resume frames.
    - Applies backpressure based on upstream ACK progression.
    """
    if not state.headless:
        return

    deadline = _now_ms() + int(timeout_ms)
    while True:
        if not state.headless_paused and _headless_inflight(state) <= int(max_inflight):
            return
        remaining_ms = deadline - _now_ms()
        if remaining_ms <= 0:
            raise TimeoutError(
                f"headless send blocked (paused={state.headless_paused}, inflight={_headless_inflight(state)}, max_inflight={max_inflight})"
            )
        try:
            # Wait for a signal (ack advance or resume).
            state.headless_signal.clear()
            await asyncio.wait_for(state.headless_signal.wait(), timeout=remaining_ms / 1000)
        except asyncio.TimeoutError as e:
            raise TimeoutError(
                f"headless send wait timed out (paused={state.headless_paused}, inflight={_headless_inflight(state)}, max_inflight={max_inflight})"
            ) from e


async def _handle_request(request: web.Request) -> web.StreamResponse:
    app = request.app
    upstream: str = app["upstream"]
    session: ClientSession = app["session"]

    upstream_url = urljoin(upstream.rstrip("/") + "/", str(request.rel_url).lstrip("/"))

    if request.path == "/te2/workbench-proxy":
        return await _te2_rpc_ws(request)

    ws_probe = web.WebSocketResponse()
    if ws_probe.can_prepare(request).ok:
        ws_id = uuid.uuid4().hex[:12]
        state = _WsDecodeState(ws_id=ws_id)

        client_ws = web.WebSocketResponse(autoping=True)
        await client_ws.prepare(request)

        parsed = urlparse(upstream_url)
        ws_url = parsed._replace(scheme="ws" if parsed.scheme == "http" else "wss").geturl()
        upstream_ws = await session.ws_connect(ws_url, headers=_filtered_headers(request.headers))
        state.upstream_ws = upstream_ws
        request.app["ws_states"][ws_id] = state

        _emit(
            {
                "type": "ws/open",
                "ts_ms": _now_ms(),
                "ws_id": ws_id,
                "path": request.path,
                "query": dict(request.query),
                "upstream_ws": ws_url,
            }
        )

        t1 = asyncio.create_task(_pipe_ws(state, client_ws, upstream_ws, direction="c2u"))
        t2 = asyncio.create_task(_pipe_ws(state, upstream_ws, client_ws, direction="u2c"))
        done, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
        for p in pending:
            p.cancel()
        await upstream_ws.close()
        await client_ws.close()
        _emit({"type": "ws/close", "ts_ms": _now_ms(), "ws_id": ws_id, "stream": state.stream_kind})
        request.app["ws_states"].pop(ws_id, None)
        return client_ws

    body = await request.read()
    headers = _filtered_headers(request.headers)
    # Let aiohttp set Host.
    headers.pop("Host", None)

    async with session.request(
        request.method,
        upstream_url,
        headers=headers,
        data=body if body else None,
        allow_redirects=False,
    ) as resp:
        out = web.StreamResponse(status=resp.status, reason=resp.reason)
        for k, v in resp.headers.items():
            lk = k.lower()
            if lk in _HOP_BY_HOP:
                continue
            out.headers[k] = v
        await out.prepare(request)
        async for chunk in resp.content.iter_chunked(64 * 1024):
            await out.write(chunk)
        await out.write_eof()
        return out


async def _run_app(listen_host: str, listen_port: int, upstream: str) -> None:
    app = web.Application()
    app["upstream"] = upstream
    # IMPORTANT: act as a transparent reverse proxy.
    # If the client session auto-decompresses while we forward upstream headers
    # (e.g. `Content-Encoding: gzip/br`), browsers will fail with
    # `net::ERR_CONTENT_DECODING_FAILED`.
    app["session"] = ClientSession(auto_decompress=False)
    app["ws_states"] = {}
    app["headless"] = {"mgmt": None, "ext": None}
    app.router.add_route("*", "/{tail:.*}", _handle_request)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=listen_host, port=listen_port)
    _emit(
        {
            "type": "proxy/start",
            "ts_ms": _now_ms(),
            "listen": f"http://{listen_host}:{listen_port}",
            "upstream": upstream,
            "wire_log": _WIRE_LOG,
            "wire_preview_bytes": _WIRE_PREVIEW_BYTES,
            "wire_payload_b64": _WIRE_PAYLOAD_B64,
            "wire_payload_b64_max": _WIRE_PAYLOAD_B64_MAX,
            "trace_out": getattr(_TRACE_FH, "name", None) if _TRACE_FH is not None else None,
            "payload_out": getattr(_PAYLOAD_FH, "name", None) if _PAYLOAD_FH is not None else None,
            "payload_max_bytes": _PAYLOAD_MAX_BYTES,
        }
    )
    await site.start()

    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await app["session"].close()
        await runner.cleanup()
        if _TRACE_FH is not None:
            try:
                _TRACE_FH.close()
            except Exception:
                pass
        if _PAYLOAD_FH is not None:
            try:
                _PAYLOAD_FH.close()
            except Exception:
                pass


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="workbench-protocol-proxy", add_help=True)
    p.add_argument("--listen-host", default=os.environ.get("TE2_WPP_LISTEN_HOST", "127.0.0.1"))
    p.add_argument("--listen-port", type=int, default=int(os.environ.get("TE2_WPP_LISTEN_PORT", "8000")))
    p.add_argument("--upstream", default=os.environ.get("TE2_WPP_UPSTREAM", "http://127.0.0.1:8080"))
    p.add_argument("--trace-out", default=os.environ.get("TE2_WPP_TRACE_OUT"))
    p.add_argument("--trace-max-bytes", type=int, default=int(os.environ.get("TE2_WPP_TRACE_MAX_BYTES", str(20 * 1024 * 1024))))
    p.add_argument("--wire-log", default=os.environ.get("TE2_WPP_WIRE_LOG", "1"))
    p.add_argument("--wire-preview-bytes", type=int, default=int(os.environ.get("TE2_WPP_WIRE_PREVIEW_BYTES", "0")))
    p.add_argument("--wire-payload-b64", default=os.environ.get("TE2_WPP_WIRE_PAYLOAD_B64", "0"))
    p.add_argument("--wire-payload-b64-max", type=int, default=int(os.environ.get("TE2_WPP_WIRE_PAYLOAD_B64_MAX", "8192")))
    p.add_argument("--payload-out", default=os.environ.get("TE2_WPP_PAYLOAD_OUT"))
    p.add_argument("--payload-max-bytes", type=int, default=int(os.environ.get("TE2_WPP_PAYLOAD_MAX_BYTES", str(100 * 1024 * 1024))))
    args = p.parse_args(argv)

    global _TRACE_FH, _TRACE_PATH, _TRACE_MAX_BYTES, _PAYLOAD_FH, _PAYLOAD_PATH, _PAYLOAD_MAX_BYTES, _WIRE_LOG, _WIRE_PREVIEW_BYTES, _WIRE_PAYLOAD_B64, _WIRE_PAYLOAD_B64_MAX
    _WIRE_LOG = str(args.wire_log).lower() not in {"0", "false", "no", "off", ""}
    _WIRE_PREVIEW_BYTES = int(args.wire_preview_bytes or 0)
    _WIRE_PAYLOAD_B64 = str(args.wire_payload_b64).lower() not in {"0", "false", "no", "off", ""}
    _WIRE_PAYLOAD_B64_MAX = int(args.wire_payload_b64_max or 0)
    _TRACE_MAX_BYTES = int(args.trace_max_bytes or 0)
    _PAYLOAD_MAX_BYTES = int(args.payload_max_bytes or 0)
    if isinstance(args.trace_out, str) and args.trace_out:
        try:
            _TRACE_PATH = args.trace_out
            _TRACE_FH = open(args.trace_out, "a+", encoding="utf-8")
        except Exception:
            _TRACE_PATH = None
            _TRACE_FH = None

    # Sidecar payload store (only useful when wire payload capture is enabled).
    if _WIRE_PAYLOAD_B64:
        payload_out = args.payload_out
        if not isinstance(payload_out, str) or not payload_out:
            if _TRACE_PATH:
                payload_out = _TRACE_PATH + ".payloads.bin"
        if isinstance(payload_out, str) and payload_out:
            try:
                _PAYLOAD_PATH = payload_out
                _PAYLOAD_FH = open(payload_out, "ab+")
            except Exception:
                _PAYLOAD_PATH = None
                _PAYLOAD_FH = None

    asyncio.run(_run_app(args.listen_host, args.listen_port, args.upstream))
    return 0
