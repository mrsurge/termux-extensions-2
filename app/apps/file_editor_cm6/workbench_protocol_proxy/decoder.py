from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


def _u32be(b: bytes, off: int) -> int:
    return struct.unpack_from(">I", b, off)[0]


def _p32be(v: int) -> bytes:
    return struct.pack(">I", v & 0xFFFFFFFF)


def encode_wire_frame(msg_type: int, msg_id: int, ack: int, payload: bytes) -> bytes:
    """
    Encode a VS Code wire protocol frame:
      TYPE(u8) + ID(u32be) + ACK(u32be) + LEN(u32be) + PAYLOAD
    """
    if not (0 <= msg_type <= 255):
        raise ValueError("msg_type out of range")
    return bytes([msg_type]) + _p32be(msg_id) + _p32be(ack) + _p32be(len(payload)) + payload


def encode_ext_request_json_args(req: int, rpc_id: int, method: str, args: Any, *, cancellable: bool = False) -> bytes:
    """
    Encode ExtensionHost RPC RequestJSONArgs / RequestJSONArgsWithCancellation.

    Format:
      u8 type (1 or 2)
      u32 req
      u8 rpcId
      u8 methodLen
      method bytes (utf-8)
      u32 argsLen
      args JSON bytes (utf-8)
    """
    if not (0 <= rpc_id <= 255):
        raise ValueError("rpc_id out of range")
    method_b = method.encode("utf-8", errors="strict")
    if len(method_b) > 255:
        raise ValueError("method too long for u8 length")
    args_b = json.dumps(args, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    msg_type = 2 if cancellable else 1
    return (
        bytes([msg_type])
        + _p32be(req)
        + bytes([rpc_id])
        + bytes([len(method_b)])
        + method_b
        + _p32be(len(args_b))
        + args_b
    )


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


def deserialize_mgmt_value(r: _Reader, *, max_depth: int = 20) -> Any:
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
        ln, r.off = _read_vql(r.b, r.off)
        return r.read_bytes(ln).decode("utf-8", errors="replace")
    if dtype == 2 or dtype == 3:
        ln, r.off = _read_vql(r.b, r.off)
        blob = r.read_bytes(ln)
        return {"__bytes__": len(blob)}
    if dtype == 4:
        ln, r.off = _read_vql(r.b, r.off)
        arr = []
        for _i in range(ln):
            arr.append(deserialize_mgmt_value(r, max_depth=max_depth - 1))
        return arr
    if dtype == 5:
        ln, r.off = _read_vql(r.b, r.off)
        raw = r.read_bytes(ln).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"__json_parse_error__": True, "raw": raw[:256]}
    if dtype == 6:
        v, r.off = _read_vql(r.b, r.off)
        return v

    return {"__unknown_dtype__": dtype}


@dataclass
class WireFrame:
    msg_type: int
    msg_id: int
    ack: int
    payload: bytes


def try_decode_handshake(buf: bytes) -> Optional[Dict[str, Any]]:
    """
    Try decode a code-server/VS Code handshake message.

    This is a normal VS Code wire frame of type Control (2):
      TYPE(u8=2) + ID(u32be=0) + ACK(u32be=0) + LEN(u32be) + JSON(utf-8)
    """
    if len(buf) < 13:
        return None
    if buf[0] != 0x02:  # Control
        return None
    msg_id = _u32be(buf, 1)
    ack = _u32be(buf, 5)
    ln = _u32be(buf, 9)
    if 13 + ln > len(buf):
        return None
    raw = buf[13 : 13 + ln]
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {"__handshake_parse_error__": True, "raw": raw[:128].hex()}


def decode_wire_stream(stream: bytearray) -> List[WireFrame]:
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


def mgmt_header_to_name(header: Any) -> Optional[str]:
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


def decode_ext_host_rpc(payload: bytes) -> Dict[str, Any]:
    """
    Decode a subset of the VS Code extension-host RPC payload.

    We handle:
      - RequestJSONArgs (1) / RequestJSONArgsWithCancellation (2)
      - RequestMixedArgs (3) / RequestMixedArgsWithCancellation (4)
      - ReplyOKJSON (9) / ReplyOKJSONWithBuffers (10)
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
        if msg_type in (5, 6, 7, 12, 8):
            return {"kind": "ext", "type": msg_type, "req": req}
        return {"kind": "ext", "type": msg_type, "req": req, "len": len(payload)}
    except Exception as e:
        return {"kind": "ext", "type": msg_type, "req": req, "error": f"decode_fail:{e}"}


def try_decode_mgmt_regular(payload: bytes) -> Optional[Dict[str, Any]]:
    try:
        r = _Reader(payload, 0)
        header = deserialize_mgmt_value(r)
        body = deserialize_mgmt_value(r) if r.remaining() > 0 else None
        name = mgmt_header_to_name(header)
        if name is None:
            return None
        return {"kind": "mgmt", "name": name, "header": header, "body": body}
    except Exception:
        return None
