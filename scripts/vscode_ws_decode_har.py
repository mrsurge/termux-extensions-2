#!/usr/bin/env python3
"""
Decode VS Code / code-server websocket protocol frames from a Firefox HAR export.

This is a lightweight decoder intended for protocol discovery (method names, channels,
and message type distributions). It is NOT a full VS Code remote client.

Inputs:
  - Firefox HAR with `_webSocketMessages` entries (like `someWSoutput.har`).

Outputs:
  - Human-readable stdout summary + optional JSON dump.

Notes:
  - code-server also sends an initial handshake message family that looks like:
      0x02 + 11x 0x00 + <u8 len> + <json bytes>
    We decode that separately.
  - "Wire protocol" frames are described in progrium/vscode-protocol README:
      TYPE (u8), ID (u32be), ACK (u32be), DATA_LENGTH (u32be), DATA
    We decode those from a streaming buffer per WS connection + direction.
  - Management "channel protocol" payload is a sequence of values encoded with
    a simple tagged format (DataType + VQL lengths).
  - ExtensionHost RPC payload is a separate binary protocol; we decode the
    common JSON-only variants.
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _u32be(b: bytes, off: int) -> int:
    return struct.unpack_from(">I", b, off)[0]


def _read_vql(b: bytes, off: int) -> Tuple[int, int]:
    """
    Read a VS Code style "VQL" int32 (7 bits per byte, msb continuation).
    Returns (value, new_offset).
    """
    shift = 0
    value = 0
    while True:
        if off >= len(b):
            raise EOFError("vql: out of data")
        byte = b[off]
        off += 1
        value |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            break
        shift += 7
        if shift > 28:
            raise ValueError("vql: too many bytes")
    return value, off


class _Reader:
    def __init__(self, b: bytes, off: int = 0) -> None:
        self.b = b
        self.off = off

    def read_u8(self) -> int:
        if self.off >= len(self.b):
            raise EOFError("u8: out of data")
        v = self.b[self.off]
        self.off += 1
        return v

    def read_bytes(self, n: int) -> bytes:
        if self.off + n > len(self.b):
            raise EOFError("bytes: out of data")
        out = self.b[self.off : self.off + n]
        self.off += n
        return out

    def remaining(self) -> int:
        return len(self.b) - self.off


def _deserialize_mgmt_value(r: _Reader, *, max_depth: int = 20) -> Any:
    if max_depth <= 0:
        return "<max_depth>"
    dtype = r.read_u8()

    # DataType:
    # 0 undefined
    # 1 string (vql len + bytes)
    # 2 buffer (vql len + bytes)
    # 3 VSBuffer (vql len + bytes)
    # 4 array (vql length + values)
    # 5 object (vql len + json bytes)
    # 6 int (vql)
    if dtype == 0:
        return None
    if dtype == 1:
        ln, _ = _read_vql(r.b, r.off)
        r.off = _
        return r.read_bytes(ln).decode("utf-8", errors="replace")
    if dtype == 2 or dtype == 3:
        ln, _ = _read_vql(r.b, r.off)
        r.off = _
        blob = r.read_bytes(ln)
        return {"__bytes__": len(blob)}
    if dtype == 4:
        ln, _ = _read_vql(r.b, r.off)
        r.off = _
        arr = []
        for _i in range(ln):
            arr.append(_deserialize_mgmt_value(r, max_depth=max_depth - 1))
        return arr
    if dtype == 5:
        ln, _ = _read_vql(r.b, r.off)
        r.off = _
        raw = r.read_bytes(ln).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"__json_parse_error__": True, "raw": raw[:256]}
    if dtype == 6:
        v, _ = _read_vql(r.b, r.off)
        r.off = _
        return v

    return {"__unknown_dtype__": dtype}


@dataclass
class WireFrame:
    msg_type: int
    msg_id: int
    ack: int
    payload: bytes


def _try_decode_handshake(buf: bytes) -> Optional[Dict[str, Any]]:
    # Observed on code-server: 0x02 + 11x 0x00 + <u8 len> + <json>
    if len(buf) < 14:
        return None
    if buf[0] != 0x02:
        return None
    if any(x != 0 for x in buf[1:12]):
        return None
    ln = buf[12]
    if 13 + ln > len(buf):
        return None
    raw = buf[13 : 13 + ln]
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {"__handshake_parse_error__": True, "raw": raw[:128].hex()}


def _decode_wire_stream(stream: bytearray) -> List[WireFrame]:
    out: List[WireFrame] = []
    # Header: TYPE(1) + ID(4) + ACK(4) + LEN(4) = 13 bytes
    while True:
        if len(stream) < 13:
            break
        msg_type = stream[0]
        msg_id = _u32be(stream, 1)
        ack = _u32be(stream, 5)
        ln = _u32be(stream, 9)
        total = 13 + ln
        if len(stream) < total:
            break
        payload = bytes(stream[13:total])
        del stream[:total]
        out.append(WireFrame(msg_type=msg_type, msg_id=msg_id, ack=ack, payload=payload))
    return out


def _decode_ext_host_rpc(payload: bytes) -> Dict[str, Any]:
    """
    Decode a subset of the VS Code extension-host RPC payload.

    We handle:
      - RequestJSONArgs (1) / RequestJSONArgsWithCancellation (2)
      - ReplyOKJSON (9)
      - ReplyErrError (11)
      - Acknowledged (5), Cancel (6), ReplyOKEmpty (7), ReplyErrEmpty (12)
    """
    if len(payload) < 5:
        return {"kind": "ext", "error": "short", "len": len(payload)}
    msg_type = payload[0]
    req = _u32be(payload, 1)
    off = 5

    def read_u8() -> int:
        nonlocal off
        if off >= len(payload):
            raise EOFError
        v = payload[off]
        off += 1
        return v

    def read_u32() -> int:
        nonlocal off
        if off + 4 > len(payload):
            raise EOFError
        v = _u32be(payload, off)
        off += 4
        return v

    def read_short_string() -> str:
        ln = read_u8()
        nonlocal off
        if off + ln > len(payload):
            raise EOFError
        s = payload[off : off + ln].decode("utf-8", errors="replace")
        off += ln
        return s

    def read_long_string() -> str:
        ln = read_u32()
        nonlocal off
        if off + ln > len(payload):
            raise EOFError
        s = payload[off : off + ln].decode("utf-8", errors="replace")
        off += ln
        return s

    def read_vsbuffer() -> bytes:
        ln = read_u32()
        nonlocal off
        if off + ln > len(payload):
            raise EOFError
        b = payload[off : off + ln]
        off += ln
        return b

    def read_mixed_array() -> List[Any]:
        """
        Decode MessageBuffer.readMixedArray() from VS Code rpcProtocol.

        Encoding:
          u8 arrLen
          for each:
            u8 argType:
              1 String: longString (u32 len + bytes) where bytes contain JSON string
              2 VSBuffer: vsbuffer (u32 len + bytes)
              3 SerializedObjectWithBuffers:
                  u32 bufferCount
                  longString (JSON string)
                  bufferCount * vsbuffer
              4 Undefined: no payload
        """
        arr_len = read_u8()
        out: List[Any] = []
        for _i in range(arr_len):
            arg_type = read_u8()
            if arg_type == 1:  # String
                raw = read_long_string()
                try:
                    out.append(json.loads(raw))
                except Exception:
                    out.append({"__json_parse_error__": True, "raw": raw[:256]})
            elif arg_type == 2:  # VSBuffer
                b = read_vsbuffer()
                out.append({"__vsbuffer__": len(b)})
            elif arg_type == 3:  # SerializableObjectWithBuffers
                buf_count = read_u32()
                raw = read_long_string()
                buffers = []
                for _j in range(buf_count):
                    buffers.append({"__vsbuffer__": len(read_vsbuffer())})
                try:
                    out.append({"__json_with_buffers__": json.loads(raw), "buffers": buffers})
                except Exception:
                    out.append({"__json_with_buffers_parse_error__": True, "raw": raw[:256], "buffers": buffers})
            elif arg_type == 4:  # Undefined
                out.append(None)
            else:
                out.append({"__unknown_arg_type__": arg_type})
        return out

    try:
        if msg_type in (1, 2):
            rpc_id = read_u8()
            method = read_short_string()
            args_raw = read_long_string()
            args = json.loads(args_raw) if args_raw else []
            return {
                "kind": "ext",
                "type": msg_type,
                "req": req,
                "rpcId": rpc_id,
                "method": method,
                "args": args,
                "cancellable": msg_type == 2,
            }
        if msg_type in (3, 4):
            rpc_id = read_u8()
            method = read_short_string()
            args = read_mixed_array()
            return {
                "kind": "ext",
                "type": msg_type,
                "req": req,
                "rpcId": rpc_id,
                "method": method,
                "args": args,
                "cancellable": msg_type == 4,
            }
        if msg_type == 9:
            res_raw = read_long_string()
            return {"kind": "ext", "type": msg_type, "req": req, "result": json.loads(res_raw) if res_raw else None}
        if msg_type == 10:
            buf_count = read_u32()
            res_raw = read_long_string()
            buffers = [{"__vsbuffer__": len(read_vsbuffer())} for _i in range(buf_count)]
            try:
                val = json.loads(res_raw) if res_raw else None
            except Exception:
                val = {"__json_parse_error__": True, "raw": res_raw[:256]}
            return {"kind": "ext", "type": msg_type, "req": req, "result": {"value": val, "buffers": buffers}}
        if msg_type == 11:
            err_raw = read_long_string()
            return {"kind": "ext", "type": msg_type, "req": req, "error": json.loads(err_raw) if err_raw else None}
        if msg_type in (5, 6, 7, 12, 8, 10):
            return {"kind": "ext", "type": msg_type, "req": req}
        return {"kind": "ext", "type": msg_type, "req": req, "len": len(payload)}
    except Exception as e:
        return {"kind": "ext", "type": msg_type, "req": req, "error": f"decode_fail:{e}"}


def _mgmt_header_to_name(header: Any) -> Optional[str]:
    # expected: [type,id,"channel","command"] or variants
    if not isinstance(header, list) or len(header) < 4:
        return None
    if not isinstance(header[0], int):
        return None
    ch = header[2]
    cmd = header[3]
    if isinstance(ch, str) and isinstance(cmd, str):
        return f"{ch}/{cmd}"
    return None


@dataclass
class Stats:
    handshake_types: Dict[str, int] = field(default_factory=dict)
    wire_types: Dict[int, int] = field(default_factory=dict)
    mgmt_methods: Dict[str, int] = field(default_factory=dict)
    mgmt_events: Dict[str, int] = field(default_factory=dict)
    ext_methods: Dict[str, int] = field(default_factory=dict)
    ext_types: Dict[int, int] = field(default_factory=dict)

    def inc(self, d: Dict[Any, int], k: Any) -> None:
        d[k] = d.get(k, 0) + 1


def _proto_msg_type_name(t: int) -> str:
    return {
        0: "None",
        1: "Regular",
        2: "Control",
        3: "Ack",
        5: "Disconnect",
        6: "ReplayRequest",
        7: "Pause",
        8: "Resume",
        9: "KeepAlive",
    }.get(t, f"Unknown({t})")


def _ext_msg_type_name(t: int) -> str:
    return {
        1: "RequestJSONArgs",
        2: "RequestJSONArgsWithCancellation",
        3: "RequestMixedArgs",
        4: "RequestMixedArgsWithCancellation",
        5: "Acknowledged",
        6: "Cancel",
        7: "ReplyOKEmpty",
        8: "ReplyOKVSBuffer",
        9: "ReplyOKJSON",
        10: "ReplyOKJSONWithBuffers",
        11: "ReplyErrError",
        12: "ReplyErrEmpty",
    }.get(t, f"Unknown({t})")


def _mgmt_ipc_type_name(t: int) -> str:
    return {
        100: "req",
        101: "cancel",
        102: "subscribe",
        103: "unsubscribe",
        200: "init",
        201: "reply",
        202: "replyErr",
        203: "replyErrObj",
        204: "event",
    }.get(t, str(t))


def _load_har_json(path: Path) -> Dict[str, Any]:
    raw_text = path.read_bytes()
    # Some HARs are saved with a leading comment line (e.g. containing the WS URL).
    # Make this tolerant by trimming anything before the first '{'.
    start = raw_text.find(b"{")
    if start == -1:
        raise ValueError(f"invalid HAR (no '{{' found): {path}")
    return json.loads(raw_text[start:].decode("utf-8", errors="replace"))


def _decode_har_internal(path: Path, *, verbose: bool) -> Tuple[Stats, List[Dict[str, Any]]]:
    har = _load_har_json(path)
    entries = har.get("log", {}).get("entries", [])

    # Keyed by (ws_url, direction)
    streams: Dict[Tuple[str, str], bytearray] = {}
    stats = Stats()
    decoded_dump: List[Dict[str, Any]] = []

    def get_stream(ws_url: str, direction: str) -> bytearray:
        key = (ws_url, direction)
        if key not in streams:
            streams[key] = bytearray()
        return streams[key]

    for e in entries:
        ws_url = e.get("request", {}).get("url", "")
        if not ws_url.startswith("ws"):
            continue

        messages = e.get("_webSocketMessages") or e.get("webSocketMessages") or []
        for m in messages:
            typ = m.get("type")  # 'send'/'receive'
            data_b64 = m.get("data", "")
            opcode = m.get("opcode")
            if opcode != 2:
                continue  # only binary
            try:
                raw = base64.b64decode(data_b64)
            except Exception:
                continue

            # handshake family
            hs = _try_decode_handshake(raw)
            if hs is not None:
                hs_type = str(hs.get("type", "unknown"))
                stats.inc(stats.handshake_types, hs_type)
                if verbose:
                    decoded_dump.append({"ws": ws_url, "dir": typ, "kind": "handshake", "data": hs})
                continue

            # wire protocol stream decode (can be fragmented)
            stream = get_stream(ws_url, typ)
            stream.extend(raw)
            frames = _decode_wire_stream(stream)
            for fr in frames:
                stats.inc(stats.wire_types, fr.msg_type)

                if fr.msg_type != 1:
                    if verbose:
                        decoded_dump.append(
                            {
                                "ws": ws_url,
                                "dir": typ,
                                "kind": "wire",
                                "type": _proto_msg_type_name(fr.msg_type),
                                "id": fr.msg_id,
                                "ack": fr.ack,
                            }
                        )
                    continue

                # Regular payload: try Management decode first
                mgmt_ok = False
                mgmt_header = None
                mgmt_body = None
                try:
                    r = _Reader(fr.payload, 0)
                    mgmt_header = _deserialize_mgmt_value(r)
                    # Some Regular messages may have just header (init) or no body.
                    mgmt_body = _deserialize_mgmt_value(r) if r.remaining() > 0 else None
                    name = _mgmt_header_to_name(mgmt_header)
                    if name is not None:
                        mgmt_ok = True
                        # header[0] indicates req/reply/event
                        ipc_t = mgmt_header[0] if isinstance(mgmt_header, list) and mgmt_header else None
                        if ipc_t == 204:
                            stats.inc(stats.mgmt_events, name)
                        elif ipc_t in (100, 102):
                            stats.inc(stats.mgmt_methods, name)
                        else:
                            stats.inc(stats.mgmt_methods, f"{name}:{_mgmt_ipc_type_name(int(ipc_t))}" if isinstance(ipc_t, int) else name)
                except Exception:
                    mgmt_ok = False

                if mgmt_ok:
                    if verbose:
                        decoded_dump.append(
                            {
                                "ws": ws_url,
                                "dir": typ,
                                "kind": "mgmt",
                                "id": fr.msg_id,
                                "ack": fr.ack,
                                "header": mgmt_header,
                                "body": mgmt_body,
                            }
                        )
                    continue

                # ExtensionHost RPC decode
                ext = _decode_ext_host_rpc(fr.payload)
                stats.inc(stats.ext_types, int(ext.get("type", -1)) if "type" in ext else -1)
                if "method" in ext and isinstance(ext["method"], str):
                    stats.inc(stats.ext_methods, ext["method"])
                if verbose:
                    decoded_dump.append({"ws": ws_url, "dir": typ, "kind": "ext", "id": fr.msg_id, "ack": fr.ack, "ext": ext})

    return stats, decoded_dump


def decode_har(path: Path, *, dump_json: Optional[Path] = None, verbose: bool = False) -> None:
    stats, decoded_dump = _decode_har_internal(path, verbose=verbose)

    def top(d: Dict[Any, int], n: int = 25) -> List[Tuple[Any, int]]:
        return sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:n]

    print(f"har={path.name}")
    print(f"timestamp_ms={int(time.time()*1000)}")

    print("\n[Handshake] types:")
    for k, v in top(stats.handshake_types, 20):
        print(f"  {k}: {v}")

    print("\n[Wire] message types:")
    for k, v in top({_proto_msg_type_name(t): c for t, c in stats.wire_types.items()}, 20):
        print(f"  {k}: {v}")

    print("\n[Management] top methods/events:")
    for k, v in top(stats.mgmt_methods, 25):
        print(f"  {k}: {v}")
    for k, v in top(stats.mgmt_events, 25):
        print(f"  EVENT {k}: {v}")

    print("\n[ExtensionHost] message types:")
    for k, v in top({_ext_msg_type_name(t): c for t, c in stats.ext_types.items()}, 20):
        print(f"  {k}: {v}")

    print("\n[ExtensionHost] top methods:")
    for k, v in top(stats.ext_methods, 40):
        print(f"  {k}: {v}")

    if dump_json:
        dump_json.write_text(json.dumps(decoded_dump, indent=2))
        print(f"\nWrote verbose dump: {dump_json}")


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("har", type=Path, help="Firefox HAR containing _webSocketMessages")
    ap.add_argument("--dump-json", type=Path, default=None, help="Write verbose decoded frames to JSON")
    ap.add_argument("--verbose", action="store_true", help="Collect verbose decoded frames (large)")
    ap.add_argument(
        "--extract-te2",
        action="store_true",
        help="Emit TE2-friendly JSONL events to stdout (best-effort, for protocol discovery)",
    )
    ap.add_argument(
        "--extract-method",
        action="append",
        default=[],
        help="In --extract-te2 mode, also emit ext request frames for this method name (repeatable).",
    )
    args = ap.parse_args(argv)

    if not args.har.exists():
        print(f"missing: {args.har}", file=sys.stderr)
        return 2

    if not args.extract_te2:
        decode_har(args.har, dump_json=args.dump_json, verbose=args.verbose)
        return 0

    # Extraction path: decode verbose frames into memory, then emit a small set of TE2-friendly events.
    # This intentionally avoids needing the Go decoder/proxy just to identify payload shapes.
    _stats, frames = _decode_har_internal(args.har, verbose=True)

    # Correlate ext replies to reqs and emit only the “gold”.
    ext_req: Dict[int, Dict[str, Any]] = {}
    extract_methods = set(args.extract_method or [])
    for f in frames:
        if f.get("kind") != "ext":
            continue
        e = f.get("ext") or {}
        t = e.get("type")
        req = e.get("req")
        if not isinstance(req, int):
            continue
        if t in (1, 2, 3, 4) and isinstance(e.get("method"), str):
            ext_req[req] = {"method": e.get("method"), "args": e.get("args"), "rpcId": e.get("rpcId")}
            if extract_methods and e.get("method") in extract_methods:
                print(
                    json.dumps(
                        {
                            "type": "ext/request",
                            "dir": f.get("dir"),
                            "req": req,
                            "rpcId": e.get("rpcId"),
                            "method": e.get("method"),
                            "args": e.get("args"),
                        },
                        ensure_ascii=False,
                    )
                )

        # diagnostics: $changeMany owner + markers payload (already decoded for mixed args)
        if e.get("method") == "$changeMany" and isinstance(e.get("args"), list) and len(e.get("args")) == 2:
            owner = e["args"][0]
            payload = e["args"][1]
            print(
                json.dumps(
                    {
                        "type": "diagnostics/changeMany",
                        "owner": owner,
                        "payload": payload,
                        "req": req,
                        "ws": f.get("ws"),
                    },
                    ensure_ascii=False,
                )
            )

        # replies (map to request where possible)
        if t in (7, 8, 9, 10, 11, 12) and req in ext_req:
            meta = ext_req.get(req, {})
            out = {
                "type": "ext/reply",
                "req": req,
                "method": meta.get("method"),
                "rpcId": meta.get("rpcId"),
                "ok": t in (7, 8, 9, 10),
                "responseType": _ext_msg_type_name(int(t)) if isinstance(t, int) else t,
            }
            if t in (9, 10):
                out["result"] = e.get("result")
            elif t == 11:
                out["error"] = e.get("error")
            print(json.dumps(out, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BrokenPipeError:
        # Allow piping to `head`/etc without a traceback.
        raise SystemExit(0)
