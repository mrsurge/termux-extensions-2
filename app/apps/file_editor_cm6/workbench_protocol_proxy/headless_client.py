from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlencode, urljoin, urlparse

from aiohttp import ClientSession, WSMsgType

from .decoder import decode_ext_host_rpc, encode_ext_request_json_args, encode_wire_frame, try_decode_handshake


def _now_ms() -> int:
    return int(time.time() * 1000)


def _encode_handshake_message(obj: dict[str, Any]) -> bytes:
    """
    Encode a code-server/VS Code handshake control message.

    This is a normal VS Code wire frame of type Control (2) with msg_id=0/ack=0,
    carrying a JSON payload.
    """
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return encode_wire_frame(2, 0, 0, payload)

def _jsonl_iter(path: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out


def _extract_te2_event(obj: dict[str, Any]) -> Optional[dict[str, Any]]:
    # Trace lines might be bare events or TE2 JSON-RPC notifications.
    if "type" in obj and isinstance(obj.get("type"), str):
        return obj
    if obj.get("jsonrpc") != "2.0":
        return None
    if obj.get("method") != "te2.event":
        return None
    params = obj.get("params")
    if isinstance(params, dict) and isinstance(params.get("type"), str):
        return params
    return None


def _rewrite_trace_args(obj: Any, *, authority: str, path_from: Optional[str], path_to: Optional[str]) -> Any:
    """
    Rewrite trace-derived args to fit the current headless session.

    - Authority: rewrite vscode-remote:// and 'authority' fields.
    - Optional path rewrite: replace absolute path prefixes (useful when tracing one folder and replaying in another).
    """
    if isinstance(obj, str):
        s = obj
        # Best-effort authority rewrite in URI strings.
        s = re.sub(r"vscode-remote://[^/]+/", f"vscode-remote://{authority}/", s)
        if path_from and path_to and s.startswith(path_from):
            s = path_to + s[len(path_from) :]
        return s
    if isinstance(obj, list):
        return [_rewrite_trace_args(x, authority=authority, path_from=path_from, path_to=path_to) for x in obj]
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if k == "authority" and isinstance(v, str):
                out[k] = authority
                continue
            out[k] = _rewrite_trace_args(v, authority=authority, path_from=path_from, path_to=path_to)
        return out
    return obj


async def _discover_server_root_path(session: ClientSession, http_base: str, *, folder: Optional[str]) -> str:
    url = http_base.rstrip("/") + "/"
    if folder:
        url = url + "?" + urlencode({"folder": folder})
    try:
        async with session.get(url, headers={"accept": "text/html", "accept-encoding": "identity"}, allow_redirects=True) as resp:
            text = await resp.text(errors="ignore")
    except Exception:
        return "/"
    m = re.search(r"(?:/)?(stable-[0-9a-f]{40})", text)
    if not m:
        return "/"
    return "/" + m.group(1)


def _commit_from_server_root_path(server_root_path: str) -> Optional[str]:
    m = re.match(r"^/stable-([0-9a-f]{40})$", server_root_path)
    if not m:
        return None
    return m.group(1)


def _http_to_ws_base(http_base: str) -> str:
    u = urlparse(http_base)
    if u.scheme not in ("http", "https"):
        raise ValueError(f"Unexpected http_base scheme: {u.scheme!r}")
    ws_scheme = "wss" if u.scheme == "https" else "ws"
    return u._replace(scheme=ws_scheme).geturl().rstrip("/")


@dataclass
class _Conn:
    name: str  # mgmt|ext
    ws: Any
    buf: bytearray
    paused: bool = False
    # upstream->client Regular msg_id tracking (what we should ACK back)
    ack_to_send: int = 0
    last_ack_sent: int = 0
    # upstream->client header ACK (how far upstream ACKed our Regular sends)
    remote_ack: int = 0
    # client->upstream Regular msg_id tracking
    next_msg_id: int = 1


def _u32be(b: bytes, off: int) -> int:
    return int.from_bytes(b[off : off + 4], "big", signed=False)


def _decode_wire_frames(buf: bytearray) -> list[tuple[int, int, int, bytes]]:
    out: list[tuple[int, int, int, bytes]] = []
    while True:
        if len(buf) < 13:
            break
        msg_type = buf[0]
        msg_id = _u32be(buf, 1)
        ack = _u32be(buf, 5)
        ln = _u32be(buf, 9)
        total = 13 + ln
        if len(buf) < total:
            break
        payload = bytes(buf[13:total])
        del buf[:total]
        out.append((msg_type, msg_id, ack, payload))
    return out


def _ingest_wire_packet(conn: _Conn, data: bytes) -> None:
    conn.buf.extend(data)
    for msg_type, msg_id, ack, _payload in _decode_wire_frames(conn.buf):
        if ack > conn.remote_ack:
            conn.remote_ack = ack
        if msg_type == 7 and not conn.paused:
            conn.paused = True
            print(json.dumps({"type": "pause", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
        if msg_type == 8 and conn.paused:
            conn.paused = False
            print(json.dumps({"type": "resume", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
        if msg_type == 1 and msg_id > conn.ack_to_send:
            conn.ack_to_send = msg_id


async def _handshake(ws, *, token: str, commit: Optional[str], desired: int, args: Any) -> Optional[bytes]:
    # Send auth
    auth_b = _encode_handshake_message({"type": "auth", "auth": token, "data": str(uuid.uuid4())})
    await ws.send_bytes(auth_b)

    # Wait for sign
    while True:
        msg = await ws.receive()
        if msg.type != WSMsgType.BINARY:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                raise RuntimeError("WS closed during handshake (waiting sign)")
            continue
        data = bytes(msg.data)
        hs = try_decode_handshake(data)
        if isinstance(hs, dict) and hs.get("type") == "sign":
            sign = hs
            break

    signed = sign.get("data")
    if not isinstance(signed, str):
        raise RuntimeError(f"Unexpected sign message: {sign!r}")

    conn = {"type": "connectionType", "commit": commit, "signedData": signed, "desiredConnectionType": desired}
    if args is not None:
        conn["args"] = args
    await ws.send_bytes(_encode_handshake_message(conn))

    # Wait for ok or first non-handshake wire packet. If we see a wire packet
    # (Pause/Resume/Regular/etc) during handshake, return it to be ingested by
    # the normal loops (do not drop it).
    while True:
        msg = await ws.receive()
        if msg.type != WSMsgType.BINARY:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                raise RuntimeError("WS closed during handshake (waiting ok)")
            continue
        data = bytes(msg.data)
        hs = try_decode_handshake(data)
        if isinstance(hs, dict) and hs.get("type") == "ok":
            return None
        # Non-handshake wire packets (including Pause/Resume/Regular/KeepAlive/Ack).
        if len(data) >= 13 and data[:1] != b"\x02":
            return data


async def _recv_loop(conn: _Conn) -> None:
    async for msg in conn.ws:
        if msg.type != WSMsgType.BINARY:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                break
            continue
        data = bytes(msg.data)

        # Handshake/control JSON (rare after connect; ignore)
        hs = try_decode_handshake(data)
        if hs is not None:
            continue

        conn.buf.extend(data)
        for msg_type, msg_id, ack, _payload in _decode_wire_frames(conn.buf):
            if ack > conn.remote_ack:
                conn.remote_ack = ack
            if msg_type == 7 and not conn.paused:
                conn.paused = True
                print(json.dumps({"type": "pause", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
            if msg_type == 8 and conn.paused:
                conn.paused = False
                print(json.dumps({"type": "resume", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
            if msg_type == 1 and msg_id > conn.ack_to_send:
                conn.ack_to_send = msg_id

    print(json.dumps({"type": "close", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)


async def _flow_loop(conn: _Conn, *, keepalive_s: float = 2.0, ack_poll_s: float = 0.25) -> None:
    last_keepalive_ms = 0
    while True:
        await asyncio.sleep(ack_poll_s)
        try:
            ack_to_send = int(conn.ack_to_send)
            if ack_to_send > int(conn.last_ack_sent):
                await conn.ws.send_bytes(encode_wire_frame(3, 0, ack_to_send, b""))
                conn.last_ack_sent = ack_to_send

            now_ms = _now_ms()
            if last_keepalive_ms == 0 or (now_ms - last_keepalive_ms) >= int(keepalive_s * 1000):
                await conn.ws.send_bytes(encode_wire_frame(9, 0, ack_to_send, b""))
                last_keepalive_ms = now_ms
        except Exception:
            return


def _p32be(v: int) -> bytes:
    return int(v & 0xFFFFFFFF).to_bytes(4, "big", signed=False)


def _encode_ext_reply_ok_empty(req: int) -> bytes:
    # ExtensionHost RPC ReplyOKEmpty: u8 type=7 + u32 req
    return bytes([7]) + _p32be(req)


def _encode_ext_reply_err_empty(req: int) -> bytes:
    # ExtensionHost RPC ReplyErrEmpty: u8 type=12 + u32 req
    return bytes([12]) + _p32be(req)


async def _wait_unpaused(conn: _Conn, *, timeout_s: float = 15.0) -> None:
    if not conn.paused:
        return
    deadline = time.time() + timeout_s
    while conn.paused:
        if time.time() >= deadline:
            raise TimeoutError(f"{conn.name}: still paused after {timeout_s}s")
        await asyncio.sleep(0.05)


async def _send_wire_regular(conn: _Conn, payload: bytes) -> None:
    await _wait_unpaused(conn)
    msg_id = conn.next_msg_id
    conn.next_msg_id += 1
    frame = encode_wire_frame(1, msg_id, int(conn.ack_to_send), payload)
    await conn.ws.send_bytes(frame)


def _replace_placeholders(obj: Any, *, authority: str, workspace_path: str, workspace_name: str, workspace_id: str) -> Any:
    if isinstance(obj, str):
        return (
            obj.replace("__AUTHORITY__", authority)
            .replace("__WORKSPACE_PATH__", workspace_path)
            .replace("__WORKSPACE_NAME__", workspace_name)
            .replace("__WORKSPACE_ID__", workspace_id)
        )
    if isinstance(obj, list):
        return [_replace_placeholders(x, authority=authority, workspace_path=workspace_path, workspace_name=workspace_name, workspace_id=workspace_id) for x in obj]
    if isinstance(obj, dict):
        return {k: _replace_placeholders(v, authority=authority, workspace_path=workspace_path, workspace_name=workspace_name, workspace_id=workspace_id) for k, v in obj.items()}
    return obj


class _ExtSession:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn
        self._pending: dict[int, asyncio.Future] = {}
        self._lock = asyncio.Lock()
        self.doc_symbols_provider_handle: Optional[int] = None
        self.last_change_many: Optional[dict[str, Any]] = None

    def _future(self, req: int) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self._pending[req] = fut
        return fut

    def _resolve(self, req: int, payload: dict[str, Any]) -> None:
        fut = self._pending.pop(req, None)
        if fut is not None and not fut.done():
            fut.set_result(payload)

    async def call(self, rpc_id: int, method: str, args: Any, *, cancellable: bool = False, timeout_s: float = 10.0) -> dict[str, Any]:
        # request id: monotonic small ints are fine for headless
        req = int(uuid.uuid4().int & 0x7FFFFFFF)
        fut = self._future(req)
        payload = encode_ext_request_json_args(req=req, rpc_id=rpc_id, method=method, args=args, cancellable=cancellable)
        async with self._lock:
            await _send_wire_regular(self.conn, payload)
        try:
            return await asyncio.wait_for(fut, timeout=timeout_s)
        except asyncio.TimeoutError as e:
            self._pending.pop(req, None)
            raise TimeoutError(f"Ext call timed out: {method}") from e

    async def send(self, rpc_id: int, method: str, args: Any, *, cancellable: bool = False) -> int:
        """
        Send an ExtHost request without waiting for a reply.

        Some workbench->ExtHost messages are effectively notifications in practice
        (no reply observed on the wire). For these, use send() so headless flows
        don't block forever.
        """
        req = int(uuid.uuid4().int & 0x7FFFFFFF)
        payload = encode_ext_request_json_args(req=req, rpc_id=rpc_id, method=method, args=args, cancellable=cancellable)
        async with self._lock:
            await _send_wire_regular(self.conn, payload)
        return req

    async def reply_ok_empty(self, req: int) -> None:
        async with self._lock:
            await _send_wire_regular(self.conn, _encode_ext_reply_ok_empty(req))

    async def reply_err_empty(self, req: int) -> None:
        async with self._lock:
            await _send_wire_regular(self.conn, _encode_ext_reply_err_empty(req))


async def _ext_recv_loop(ext: _ExtSession) -> None:
    conn = ext.conn
    async for msg in conn.ws:
        if msg.type != WSMsgType.BINARY:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                break
            continue
        data = bytes(msg.data)
        hs = try_decode_handshake(data)
        if hs is not None:
            continue

        conn.buf.extend(data)
        for msg_type, msg_id, ack, payload in _decode_wire_frames(conn.buf):
            if ack > conn.remote_ack:
                conn.remote_ack = ack
            if msg_type == 7 and not conn.paused:
                conn.paused = True
                print(json.dumps({"type": "pause", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
            if msg_type == 8 and conn.paused:
                conn.paused = False
                print(json.dumps({"type": "resume", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)
            if msg_type == 1 and msg_id > conn.ack_to_send:
                conn.ack_to_send = msg_id

            if msg_type != 1 or not payload:
                continue
            ext_msg = decode_ext_host_rpc(payload)
            if ext_msg.get("kind") != "ext":
                continue

            mtype = ext_msg.get("type")
            req = ext_msg.get("req")
            if not isinstance(mtype, int) or not isinstance(req, int):
                continue

            # Incoming request from server to client: reply ok-empty and extract signals.
            if mtype in (1, 2, 3, 4):
                method = ext_msg.get("method")
                args = ext_msg.get("args")
                if method == "$registerDocumentSymbolProvider" and isinstance(args, list) and len(args) >= 2:
                    try:
                        handle = int(args[0])
                    except Exception:
                        handle = None
                    selector = args[1]
                    if handle is not None and isinstance(selector, list):
                        # look for python selector entries
                        for s in selector:
                            if isinstance(s, dict) and s.get("language") == "python":
                                ext.doc_symbols_provider_handle = handle
                                print(json.dumps({"type": "learn/provider_document_symbols", "ts_ms": _now_ms(), "handle": handle}), flush=True)
                                break

                if method == "$changeMany":
                    ext.last_change_many = {"req": req, "method": method, "args": args}
                    print(json.dumps({"type": "diagnostics/changeMany", "ts_ms": _now_ms(), "req": req, "args": args}, ensure_ascii=False), flush=True)

                # Default behavior: ack with empty OK so server keeps going.
                try:
                    await ext.reply_ok_empty(req)
                except Exception:
                    pass
                continue

            # Replies: resolve pending calls.
            if mtype in (7, 8, 9, 10, 11, 12, 5, 6):
                ext._resolve(req, ext_msg)
                continue

    print(json.dumps({"type": "close", "ts_ms": _now_ms(), "conn": conn.name}), flush=True)


async def _ext_bootstrap(ext: _ExtSession, *, contract_path: str, authority: str, workspace_path: str, workspace_name: str) -> None:
    with open(contract_path, "r", encoding="utf-8") as f:
        contract = json.load(f)
    calls = (((contract or {}).get("ext") or {}).get("calls") or [])
    if not isinstance(calls, list):
        raise ValueError("contract.ext.calls must be a list")
    workspace_id = hex(uuid.uuid4().int & 0xFFFFFFF)[2:]
    for c in calls:
        if not isinstance(c, dict):
            continue
        rpc_id = c.get("rpcId")
        method = c.get("method")
        args = c.get("args")
        if not isinstance(rpc_id, int) or not isinstance(method, str):
            continue
        args = _replace_placeholders(args, authority=authority, workspace_path=workspace_path, workspace_name=workspace_name, workspace_id=workspace_id)
        await ext.call(rpc_id, method, args, timeout_s=20.0)

async def _ext_bootstrap_from_trace(
    ext: _ExtSession,
    *,
    trace_path: str,
    authority: str,
    max_events: int = 2000,
    delay_ms: int = 0,
    path_from: Optional[str] = None,
    path_to: Optional[str] = None,
) -> dict[str, Any]:
    """
    Replay a *minimal* bootstrap slice from a Go decoder trace.

    We only replay ExtHost client->server requests (dir == ">>") between:
      - ext connectionType handshake, and
      - the first python $registerDocumentSymbolProvider (server->client)

    This is an instrumentation shortcut to learn the minimal init sequence; it
    should be replaced by a native bootstrap sequence over time.
    """
    raw_lines = _jsonl_iter(trace_path)
    events: list[dict[str, Any]] = []
    for o in raw_lines:
        e = _extract_te2_event(o)
        if e is not None:
            events.append(e)

    start_i: Optional[int] = None
    end_i: Optional[int] = None
    for i, e in enumerate(events):
        if (
            e.get("type") == "wire/control"
            and e.get("stream") == "ext"
            and e.get("dir") == ">>"
            and isinstance(e.get("hs"), dict)
            and e["hs"].get("type") == "connectionType"
            and e["hs"].get("desiredConnectionType") == 2
        ):
            start_i = i
            break

    if start_i is None:
        raise ValueError("bootstrap trace: could not find ext connectionType (desiredConnectionType=2)")

    for i in range(start_i, len(events)):
        e = events[i]
        if e.get("type") != "ext/request" or e.get("stream") != "ext" or e.get("dir") != "<<":
            continue
        if e.get("method") != "$registerDocumentSymbolProvider":
            continue
        args = e.get("args")
        if not isinstance(args, list) or len(args) < 2:
            continue
        selector = args[1]
        if not isinstance(selector, list):
            continue
        for s in selector:
            if isinstance(s, dict) and s.get("language") == "python":
                end_i = i
                break
        if end_i is not None:
            break

    if end_i is None:
        raise ValueError("bootstrap trace: could not find python $registerDocumentSymbolProvider")

    sent = 0
    for e in events[start_i:end_i]:
        if sent >= max_events:
            break
        if e.get("type") != "ext/request" or e.get("stream") != "ext" or e.get("dir") != ">>":
            continue
        rpc_id = e.get("rpcId")
        method = e.get("method")
        args = e.get("args")
        cancellable = bool(e.get("cancellable")) if "cancellable" in e else False
        if not isinstance(rpc_id, int) or not isinstance(method, str):
            continue
        args = _rewrite_trace_args(args, authority=authority, path_from=path_from, path_to=path_to)
        await ext.send(rpc_id, method, args, cancellable=cancellable)
        sent += 1
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000.0)

    return {"ok": True, "trace_path": trace_path, "start_i": start_i, "end_i": end_i, "sent": sent, "max_events": max_events}


async def _ext_open_file(ext: _ExtSession, *, rpc_id: int, authority: str, path: str, language_id: str) -> None:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        txt = f.read()
    lines = txt.splitlines()
    # VS Code protocol expects an array of lines, without trailing newline; keep EOL separately.
    uri_obj = {
        "$mid": 1,
        "fsPath": path,
        "external": f"vscode-remote://{authority}{path}",
        "path": path,
        "scheme": "vscode-remote",
        "authority": authority,
    }
    delta = {
        "newActiveEditor": "vs.editor.ICodeEditor:1,$model2",
        "addedDocuments": [
            {
                "uri": uri_obj,
                "versionId": 1,
                "lines": lines,
                "EOL": "\n",
                "encoding": "utf8",
                "isDirty": True,
                "languageId": language_id,
            }
        ],
        "removedDocuments": [],
        "addedEditors": [],
        "removedEditors": [],
    }
    # Observed: no reply for this request (the real workbench does not wait).
    await ext.send(rpc_id, "$acceptDocumentsAndEditorsDelta", [delta])


async def _ext_request_document_symbols(ext: _ExtSession, *, rpc_id: int, provider_handle: int, authority: str, path: str) -> dict[str, Any]:
    uri_obj = {
        "$mid": 1,
        "fsPath": path,
        "external": f"vscode-remote://{authority}{path}",
        "path": path,
        "scheme": "vscode-remote",
        "authority": authority,
    }
    return await ext.call(rpc_id, "$provideDocumentSymbols", [provider_handle, uri_obj], timeout_s=30.0)


async def run(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="te2-headless-workbench-client", add_help=True)
    p.add_argument("--http-base", default="http://127.0.0.1:8000", help="HTTP base to fetch stable path (can be Go decoder proxy)")
    p.add_argument("--ws-base", default=None, help="WS base (defaults derived from --http-base)")
    p.add_argument("--folder", default=None, help="Optional folder query for code-server (helps trigger correct stable path)")
    p.add_argument("--connection-token", default="00000000000000000000")
    p.add_argument("--server-root-path", default=None, help="Override server root path, e.g. /stable-<hash>")
    p.add_argument("--commit", default=None, help="Override commit/hash; default derived from server-root-path")
    p.add_argument("--reconnection", action="store_true", help="Set reconnection=true")
    p.add_argument("--run-seconds", type=float, default=0.0, help="Exit after N seconds (0 = run forever)")
    p.add_argument("--authority", default="localhost:8000", help="VS Code remote authority used in vscode-remote:// URIs")
    p.add_argument("--workspace", default=None, help="Workspace folder path (defaults to --folder)")
    p.add_argument("--ext-contract", default=None, help="Path to ExtHost bootstrap contract JSON")
    p.add_argument("--bootstrap-ext", action="store_true", help="Run ExtHost bootstrap contract (otherwise skip)")
    p.add_argument("--bootstrap-trace", default=None, help="Go decoder JSONL trace to replay minimal bootstrap slice from")
    p.add_argument("--bootstrap-trace-max-events", type=int, default=2000, help="Max ext requests to replay from --bootstrap-trace")
    p.add_argument("--bootstrap-trace-delay-ms", type=int, default=0, help="Delay between replayed ext requests")
    p.add_argument("--bootstrap-trace-path-from", default=None, help="Optional path prefix to rewrite from (trace)")
    p.add_argument("--bootstrap-trace-path-to", default=None, help="Optional path prefix to rewrite to (current)")
    p.add_argument("--open-file", default=None, help="Open this file (sends $acceptDocumentsAndEditorsDelta)")
    p.add_argument("--open-language-id", default="python", help="Language id for --open-file")
    p.add_argument("--request-symbols", action="store_true", help="Request document symbols after provider handle is learned")
    p.add_argument(
        "--ext-env-proxy-uri",
        default=None,
        help="Value for VSCODE_PROXY_URI in the ExtensionHost connectionType args (defaults to http://<authority>/proxy/{{port}}/)",
    )
    args = p.parse_args(argv)

    http_base = str(args.http_base)
    ws_base = str(args.ws_base) if args.ws_base else _http_to_ws_base(http_base)

    async with ClientSession(auto_decompress=True) as session:
        server_root_path = args.server_root_path
        if not isinstance(server_root_path, str) or not server_root_path.startswith("/"):
            server_root_path = await _discover_server_root_path(session, http_base, folder=args.folder)
        commit = args.commit
        if not isinstance(commit, str) or not commit:
            commit = _commit_from_server_root_path(server_root_path)

        q = {
            "reconnectionToken": str(uuid.uuid4()),
            "reconnection": "true" if args.reconnection else "false",
            "skipWebSocketFrames": "false",
        }
        ws_url = urljoin(ws_base.rstrip("/") + "/", server_root_path.lstrip("/")) + "?" + urlencode(q)

        print(json.dumps({"type": "start", "ts_ms": _now_ms(), "ws_url": ws_url, "server_root_path": server_root_path, "commit": commit}), flush=True)

        mgmt_ws = await session.ws_connect(ws_url)
        mgmt = _Conn(name="mgmt", ws=mgmt_ws, buf=bytearray())
        mgmt_first = await _handshake(mgmt_ws, token=args.connection_token, commit=commit, desired=1, args=None)
        if isinstance(mgmt_first, (bytes, bytearray)) and mgmt_first:
            _ingest_wire_packet(mgmt, bytes(mgmt_first))
        print(json.dumps({"type": "connected", "ts_ms": _now_ms(), "conn": "mgmt"}), flush=True)

        ext_ws = await session.ws_connect(ws_url.replace(str(q["reconnectionToken"]), str(uuid.uuid4())))
        proxy_uri = args.ext_env_proxy_uri
        if not isinstance(proxy_uri, str) or not proxy_uri:
            proxy_uri = f"http://{args.authority}/proxy/{{{{port}}}}/"
        ext_args = {
            "language": "en",
            # Match what the real web workbench sends (helps server pick proper connection behavior).
            "break": False,
            "port": None,
            "env": {"VSCODE_PROXY_URI": proxy_uri},
        }
        ext_conn = _Conn(name="ext", ws=ext_ws, buf=bytearray())
        ext_first = await _handshake(ext_ws, token=args.connection_token, commit=commit, desired=2, args=ext_args)
        if isinstance(ext_first, (bytes, bytearray)) and ext_first:
            _ingest_wire_packet(ext_conn, bytes(ext_first))
        ext = _ExtSession(ext_conn)
        print(json.dumps({"type": "connected", "ts_ms": _now_ms(), "conn": "ext"}), flush=True)

        tasks = [
            asyncio.create_task(_recv_loop(mgmt)),
            asyncio.create_task(_flow_loop(mgmt)),
            asyncio.create_task(_ext_recv_loop(ext)),
            asyncio.create_task(_flow_loop(ext_conn)),
        ]

        overall_deadline: Optional[float] = None
        if args.run_seconds and args.run_seconds > 0:
            overall_deadline = time.time() + float(args.run_seconds)

        # Bootstrap ExtHost into a minimally-usable state.
        workspace_path = args.workspace or args.folder or "/"
        workspace_name = workspace_path.rstrip("/").split("/")[-1] or "workspace"
        if isinstance(args.bootstrap_trace, str) and args.bootstrap_trace:
            try:
                res = await _ext_bootstrap_from_trace(
                    ext,
                    trace_path=str(args.bootstrap_trace),
                    authority=str(args.authority),
                    max_events=int(args.bootstrap_trace_max_events),
                    delay_ms=int(args.bootstrap_trace_delay_ms),
                    path_from=str(args.bootstrap_trace_path_from) if args.bootstrap_trace_path_from else None,
                    path_to=str(args.bootstrap_trace_path_to) if args.bootstrap_trace_path_to else None,
                )
                print(json.dumps({"type": "bootstrap/trace_ok", "ts_ms": _now_ms(), "result": res}, ensure_ascii=False), flush=True)
            except Exception as e:
                print(json.dumps({"type": "bootstrap/trace_error", "ts_ms": _now_ms(), "error": str(e), "trace": args.bootstrap_trace}), flush=True)
        elif args.bootstrap_ext:
            contract_path = args.ext_contract
            if not isinstance(contract_path, str) or not contract_path:
                contract_path = str(__file__).rsplit("/", 1)[0] + "/boot_contract_v0.json"
            try:
                await _ext_bootstrap(ext, contract_path=contract_path, authority=str(args.authority), workspace_path=str(workspace_path), workspace_name=str(workspace_name))
                print(json.dumps({"type": "bootstrap/ext_ok", "ts_ms": _now_ms(), "contract": contract_path}), flush=True)
            except Exception as e:
                print(json.dumps({"type": "bootstrap/ext_error", "ts_ms": _now_ms(), "error": str(e), "contract": contract_path}), flush=True)
        else:
            print(json.dumps({"type": "bootstrap/ext_skipped", "ts_ms": _now_ms()}), flush=True)

        if isinstance(args.open_file, str) and args.open_file:
            try:
                await _ext_open_file(ext, rpc_id=84, authority=str(args.authority), path=str(args.open_file), language_id=str(args.open_language_id))
                print(json.dumps({"type": "open_file/ok", "ts_ms": _now_ms(), "path": args.open_file}), flush=True)
            except Exception as e:
                print(json.dumps({"type": "open_file/error", "ts_ms": _now_ms(), "path": args.open_file, "error": str(e)}), flush=True)

        if args.request_symbols and isinstance(args.open_file, str) and args.open_file:
            # Wait for provider registration (python symbols)
            deadline = time.time() + 60.0
            if overall_deadline is not None:
                deadline = min(deadline, overall_deadline)
            while ext.doc_symbols_provider_handle is None and time.time() < deadline:
                await asyncio.sleep(0.1)
            if ext.doc_symbols_provider_handle is None:
                print(json.dumps({"type": "symbols/error", "ts_ms": _now_ms(), "error": "no provider handle learned"}), flush=True)
            else:
                try:
                    rep = await _ext_request_document_symbols(
                        ext,
                        rpc_id=94,
                        provider_handle=int(ext.doc_symbols_provider_handle),
                        authority=str(args.authority),
                        path=str(args.open_file),
                    )
                    print(json.dumps({"type": "symbols/reply", "ts_ms": _now_ms(), "reply": rep}, ensure_ascii=False), flush=True)
                except Exception as e:
                    print(json.dumps({"type": "symbols/error", "ts_ms": _now_ms(), "error": str(e)}), flush=True)

        if overall_deadline is not None:
            try:
                remaining = overall_deadline - time.time()
                if remaining > 0:
                    await asyncio.sleep(remaining)
            finally:
                for t in tasks:
                    t.cancel()
                try:
                    await mgmt_ws.close()
                except Exception:
                    pass
                try:
                    await ext_ws.close()
                except Exception:
                    pass
        else:
            await asyncio.gather(*tasks)

    return 0


def main() -> int:
    try:
        return asyncio.run(run())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
