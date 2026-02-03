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

from .decoder import encode_wire_frame, try_decode_handshake


def _now_ms() -> int:
    return int(time.time() * 1000)


def _encode_handshake_message(obj: dict[str, Any]) -> bytes:
    """
    Encode a code-server handshake control message as observed:
      0x02 + 11x 0x00 + <u8 len> + <json>
    """
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > 255:
        raise ValueError(f"Handshake payload too large for u8 length: {len(payload)} bytes")
    return bytes([0x02]) + (b"\x00" * 11) + bytes([len(payload)]) + payload


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


async def _handshake(ws, *, token: str, commit: Optional[str], desired: int, args: Any) -> None:
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

    # Wait for ok or first wire frame
    while True:
        msg = await ws.receive()
        if msg.type != WSMsgType.BINARY:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                raise RuntimeError("WS closed during handshake (waiting ok)")
            continue
        data = bytes(msg.data)
        hs = try_decode_handshake(data)
        if isinstance(hs, dict) and hs.get("type") == "ok":
            return
        # wire-framed messages do not start with 0x02
        if len(data) >= 13 and data[:1] != b"\x02":
            return


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
        await _handshake(mgmt_ws, token=args.connection_token, commit=commit, desired=1, args=None)
        mgmt = _Conn(name="mgmt", ws=mgmt_ws, buf=bytearray())
        print(json.dumps({"type": "connected", "ts_ms": _now_ms(), "conn": "mgmt"}), flush=True)

        ext_ws = await session.ws_connect(ws_url.replace(str(q["reconnectionToken"]), str(uuid.uuid4())))
        await _handshake(ext_ws, token=args.connection_token, commit=commit, desired=2, args={"language": "en"})
        ext = _Conn(name="ext", ws=ext_ws, buf=bytearray())
        print(json.dumps({"type": "connected", "ts_ms": _now_ms(), "conn": "ext"}), flush=True)

        tasks = [
            asyncio.create_task(_recv_loop(mgmt)),
            asyncio.create_task(_flow_loop(mgmt)),
            asyncio.create_task(_recv_loop(ext)),
            asyncio.create_task(_flow_loop(ext)),
        ]
        if args.run_seconds and args.run_seconds > 0:
            try:
                await asyncio.sleep(float(args.run_seconds))
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
