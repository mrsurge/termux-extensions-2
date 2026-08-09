import crypto from "node:crypto";
import net from "node:net";
import { Emitter } from "../../../base/common/event.mjs";
import { VSBuffer } from "../../../base/common/buffer.mjs";

const WS_TRACE = String(process?.env?.TE2_WS_TRACE || "") === "1";
const WS_TRACE_EVERY = Number(process?.env?.TE2_WS_TRACE_EVERY ?? "200");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function buildAcceptValue(secWebSocketKey) {
  return crypto
    .createHash("sha1")
    .update(secWebSocketKey + WS_GUID, "utf8")
    .digest("base64");
}

function parseHeaders(raw) {
  const lines = raw.split("\r\n");
  const statusLine = lines.shift() || "";
  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line
      .slice(idx + 1)
      .trim();
  }
  return { statusLine, headers };
}

function encodeFrame(data, opcode) {
  const payload =
    typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++)
    masked[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
  return Buffer.concat([header, mask, masked]);
}

function tryReadFrame(buffer) {
  if (buffer.length < 2) return null;
  const b0 = buffer[0] ?? 0;
  const b1 = buffer[1] ?? 0;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < offset + 2) return null;
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLen = buffer.readBigUInt64BE(offset);
    if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame too large");
    }
    len = Number(bigLen);
    offset += 8;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + len) return null;
  let payload = buffer.subarray(offset, offset + len);
  if (masked && mask) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++)
      out[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
    payload = out;
  }
  return { fin, opcode, payload, consumed: offset + len };
}

function decodeClosePayload(payload) {
  if (!payload || payload.length < 2) return { code: 1005, reason: "" };
  return {
    code: payload.readUInt16BE(0),
    reason: payload.subarray(2).toString("utf8"),
  };
}

class UdsWebSocket {
  constructor({ socketPath, requestPath, headers = {} }) {
    if (!socketPath) throw new Error("code-server UDS socket path is required");
    this.binaryType = "arraybuffer";
    this._socketPath = socketPath;
    this._requestPath = requestPath || "/";
    this._headers = headers;
    this._listeners = new Map();
    this._socket = null;
    this._handshakeBuffer = Buffer.alloc(0);
    this._frameBuffer = Buffer.alloc(0);
    this._fragmentOpcode = null;
    this._fragmentChunks = [];
    this._open = false;
    this._closed = false;
    this._connect();
  }

  get bufferedAmount() {
    return Number(this._socket?.writableLength ?? 0);
  }

  addEventListener(type, listener) {
    if (typeof listener !== "function") return;
    let listeners = this._listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }

  send(data) {
    if (!this._open || !this._socket || this._closed) {
      throw new Error("WebSocket is not open");
    }
    this._socket.write(encodeFrame(data, typeof data === "string" ? 0x1 : 0x2));
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      if (this._open && this._socket && !this._socket.destroyed) {
        this._socket.write(encodeFrame(Buffer.alloc(0), 0x8));
        this._socket.end();
      } else {
        this._socket?.destroy();
      }
    } catch {}
  }

  _connect() {
    const key = crypto.randomBytes(16).toString("base64");
    const host = String(this._headers.host || "localhost");
    const request = [
      `GET ${this._requestPath} HTTP/1.1`,
      `Host: ${host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n");

    const socket = net.createConnection({ path: this._socketPath });
    this._socket = socket;
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk) => this._onData(Buffer.from(chunk), key));
    socket.on("error", (error) => this._fail(error));
    socket.on("close", () => this._emitClose(1006, "", false));
  }

  _onData(chunk, key) {
    if (!this._open) {
      this._handshakeBuffer = Buffer.concat([this._handshakeBuffer, chunk]);
      const marker = this._handshakeBuffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const head = this._handshakeBuffer.subarray(0, marker).toString("utf8");
      const rest = this._handshakeBuffer.subarray(marker + 4);
      this._handshakeBuffer = Buffer.alloc(0);
      try {
        this._finishHandshake(head, key);
      } catch (error) {
        this._fail(error);
        return;
      }
      if (rest.length) this._processFrames(rest);
      return;
    }
    this._processFrames(chunk);
  }

  _finishHandshake(rawHeaders, key) {
    const { statusLine, headers } = parseHeaders(rawHeaders);
    if (!/^HTTP\/1\.[01] 101(?:\s|$)/.test(statusLine)) {
      throw new Error(`Unexpected server response: ${statusLine || "empty"}`);
    }
    if (String(headers.upgrade || "").toLowerCase() !== "websocket") {
      throw new Error("Invalid Upgrade header");
    }
    const expected = buildAcceptValue(key);
    if (headers["sec-websocket-accept"] !== expected) {
      throw new Error("Invalid Sec-WebSocket-Accept header");
    }
    this._open = true;
    this._emit("open", { type: "open", target: this });
  }

  _processFrames(chunk) {
    this._frameBuffer = Buffer.concat([this._frameBuffer, chunk]);
    while (this._frameBuffer.length) {
      const frame = tryReadFrame(this._frameBuffer);
      if (!frame) return;
      this._frameBuffer = this._frameBuffer.subarray(frame.consumed);
      this._handleFrame(frame);
    }
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === 0x8) {
      const { code, reason } = decodeClosePayload(payload);
      try {
        if (this._socket && !this._socket.destroyed) {
          this._socket.write(encodeFrame(payload, 0x8));
          this._socket.end();
        }
      } catch {}
      this._emitClose(code, reason, true);
      return;
    }
    if (opcode === 0x9) {
      try {
        this._socket?.write(encodeFrame(payload, 0xa));
      } catch {}
      return;
    }
    if (opcode === 0xa) return;

    if (opcode === 0x0) {
      if (this._fragmentOpcode == null) return;
      this._fragmentChunks.push(payload);
      if (fin) {
        const data = Buffer.concat(this._fragmentChunks);
        const firstOpcode = this._fragmentOpcode;
        this._fragmentOpcode = null;
        this._fragmentChunks = [];
        this._emitMessage(firstOpcode, data);
      }
      return;
    }

    if (opcode !== 0x1 && opcode !== 0x2) return;
    if (!fin) {
      this._fragmentOpcode = opcode;
      this._fragmentChunks = [payload];
      return;
    }
    this._emitMessage(opcode, payload);
  }

  _emitMessage(opcode, payload) {
    const data = opcode === 0x1 ? payload.toString("utf8") : payload;
    this._emit("message", { type: "message", data, target: this });
  }

  _fail(error) {
    this._emit("error", {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      error,
      target: this,
    });
    try {
      this._socket?.destroy();
    } catch {}
    this._emitClose(1006, "", false);
  }

  _emitClose(code, reason, wasClean) {
    if (this._closed) return;
    this._closed = true;
    this._open = false;
    this._emit("close", {
      type: "close",
      code,
      reason,
      wasClean,
      target: this,
    });
  }

  _emit(type, event) {
    const listeners = Array.from(this._listeners.get(type) || []);
    for (const listener of listeners) {
      try {
        listener.call(this, event);
      } catch {}
    }
  }
}

// The adapter relies on code-server's UDS WebSocket endpoint; no network fallback is valid.
globalThis.WebSocket = UdsWebSocket;

class NodeWebSocket {
  constructor({ socketPath, requestPath, headers = {}, debugUrl }) {
    this._ws = new UdsWebSocket({ socketPath, requestPath, headers });
    this._onData = new Emitter();
    this.onData = this._onData.event;
    this._onOpen = new Emitter();
    this.onOpen = this._onOpen.event;
    this._onClose = new Emitter();
    this.onClose = this._onClose.event;
    this._onError = new Emitter();
    this.onError = this._onError.event;

    this._traceCount = 0;
    this._traceBytes = 0;
    this._traceMax = 0;

    if (WS_TRACE) {
      try {
        console.log(
          JSON.stringify({
            type: "ws/connect",
            ts_ms: Date.now(),
            url: debugUrl,
          }),
        );
      } catch {}
    }

    this._ws.binaryType = "arraybuffer";
    this._ws.addEventListener("open", () => this._onOpen.fire());
    this._ws.addEventListener("message", (ev) => {
      const data = ev.data;
      let size = 0;
      if (data instanceof ArrayBuffer) {
        size = data.byteLength;
      } else if (ArrayBuffer.isView(data)) {
        size = data.byteLength;
      } else if (typeof data === "string") {
        size = data.length;
      }
      if (WS_TRACE) {
        this._traceCount++;
        this._traceBytes += size;
        if (size > this._traceMax) this._traceMax = size;
        if (this._traceCount % WS_TRACE_EVERY === 0) {
          try {
            console.log(
              JSON.stringify({
                type: "ws/trace",
                ts_ms: Date.now(),
                msg_count: this._traceCount,
                total_bytes: this._traceBytes,
                max_bytes: this._traceMax,
                last_bytes: size,
              }),
            );
          } catch {}
        }
      }
      if (data instanceof ArrayBuffer) {
        this._onData.fire(VSBuffer.wrap(new Uint8Array(data)));
      } else if (ArrayBuffer.isView(data)) {
        this._onData.fire(
          VSBuffer.wrap(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          ),
        );
      } else if (typeof data === "string") {
        this._onData.fire(VSBuffer.fromString(data));
      } else {
        // The UDS WebSocket path should yield Buffer/string payloads; ignore unknown.
      }
    });
    this._ws.addEventListener("close", (ev) => {
      this._onClose.fire({
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        event: ev,
      });
    });
    this._ws.addEventListener("error", (ev) => this._onError.fire(ev));
  }

  send(data) {
    this._ws.send(data);
  }

  close() {
    try {
      this._ws.close();
    } catch {}
  }
}

class NodeSocket {
  constructor(ws, debugLabel) {
    this._ws = ws;
    this.debugLabel = debugLabel;
    this._pending = [];
    this._pendingBytes = 0;
    this._flushing = false;
    this._bpHighWater = Number(
      process?.env?.TE2_WS_BACKPRESSURE_HIGH_WATER ?? String(1024 * 1024),
    );
    this._bpMaxPending = Number(
      process?.env?.TE2_WS_BACKPRESSURE_MAX_PENDING ?? String(8 * 1024 * 1024),
    );
    this._bpTrace =
      String(process?.env?.TE2_WS_BACKPRESSURE_TRACE || "") === "1";
  }

  dispose() {
    this._ws.close();
  }

  onData(listener) {
    return this._ws.onData(listener);
  }

  onClose(listener) {
    return this._ws.onClose(listener);
  }

  onEnd(_listener) {
    return { dispose() {} };
  }

  write(buffer) {
    const b = buffer instanceof VSBuffer ? buffer.buffer : Buffer.from(buffer);
    const raw = this._ws?._ws;
    const buffered = Number(raw?.bufferedAmount ?? 0);
    if (this._bpTrace && buffered >= this._bpHighWater) {
      try {
        console.log(
          JSON.stringify({
            type: "ws/backpressure",
            ts_ms: Date.now(),
            label: this.debugLabel ?? null,
            bufferedAmount: buffered,
            pendingBytes: this._pendingBytes,
            writeBytes: b.length,
          }),
        );
      } catch {}
    }

    // If the underlying ws is already buffering a lot, enqueue and drip-feed to avoid unbounded internal buffering.
    if (
      buffered >= this._bpHighWater ||
      this._flushing ||
      this._pending.length > 0
    ) {
      this._pending.push(b);
      this._pendingBytes += b.length;
      if (this._bpMaxPending > 0 && this._pendingBytes > this._bpMaxPending) {
        throw new Error(
          `ws backpressure queue exceeded: pendingBytes=${this._pendingBytes} bufferedAmount=${buffered} label=${this.debugLabel ?? ""}`,
        );
      }
      this._scheduleFlush();
      return;
    }
    this._ws.send(b);
  }

  end() {
    this._ws.close();
  }

  drain() {
    // Best-effort: wait until our queue empties and underlying bufferedAmount drops.
    return new Promise((resolve) => {
      const raw = this._ws?._ws;
      const check = () => {
        const buffered = Number(raw?.bufferedAmount ?? 0);
        if (this._pending.length === 0 && buffered < this._bpHighWater / 2) {
          resolve();
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  _scheduleFlush() {
    if (this._flushing) return;
    this._flushing = true;
    setTimeout(() => this._flushLoop(), 0);
  }

  _flushLoop() {
    const raw = this._ws?._ws;
    const buffered = Number(raw?.bufferedAmount ?? 0);
    if (buffered >= this._bpHighWater) {
      setTimeout(() => this._flushLoop(), 5);
      return;
    }
    const next = this._pending.shift();
    if (!next) {
      this._pendingBytes = 0;
      this._flushing = false;
      return;
    }
    this._pendingBytes -= next.length;
    try {
      this._ws.send(next);
    } catch {
      // If send fails, drop remaining.
      this._pending.length = 0;
      this._pendingBytes = 0;
      this._flushing = false;
      return;
    }
    setTimeout(() => this._flushLoop(), 0);
  }
}

export class NodeSocketFactory {
  constructor({ wsSchema = "ws", basePathname = "/", socketPath = null } = {}) {
    this._wsSchema = wsSchema || "ws";
    this._basePathname = basePathname || "/";
    this._socketPath = socketPath || null;
  }

  connect({ host, port }, path, query, debugLabel) {
    return new Promise((resolve, reject) => {
      if (!this._socketPath) {
        reject(new Error("code-server UDS socket path is required"));
        return;
      }
      const base = String(this._basePathname || "/").replace(/\/+$/g, "");
      const p = String(path ?? "").replace(/^\/+/g, "");
      // match browser behavior: prefix with basePathname and collapse // -> /
      const fullPath = `${base}/${p}`.replace(/\/+/g, "/");
      const queryPrefix = query ? `${query}&` : "";
      const requestPath = `${fullPath}?${queryPrefix}skipWebSocketFrames=false`;
      const debugUrl = `ws+unix:${this._socketPath}:${requestPath}`;
      const ws = new NodeWebSocket({
        socketPath: this._socketPath,
        requestPath,
        headers: { host: "localhost" },
        debugUrl,
      });
      const d = ws.onError(reject);
      ws.onOpen(() => {
        d.dispose?.();
        resolve(new NodeSocket(ws, debugLabel));
      });
    });
  }
}
