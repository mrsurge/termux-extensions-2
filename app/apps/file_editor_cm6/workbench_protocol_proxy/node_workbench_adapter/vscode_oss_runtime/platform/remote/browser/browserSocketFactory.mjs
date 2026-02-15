import WebSocket from "../../../../../../../../static/vendor/ws/index.js";
import { Emitter } from "../../../base/common/event.mjs";
import { VSBuffer } from "../../../base/common/buffer.mjs";

// Force ws implementation to avoid native WebSocket leaks in Node 25.x.
globalThis.WebSocket = WebSocket;

const WS_TRACE = String(process?.env?.TE2_WS_TRACE || "") === "1";
const WS_TRACE_EVERY = Number(process?.env?.TE2_WS_TRACE_EVERY ?? "200");

class NodeWebSocket {
  constructor(url) {
    if (typeof WebSocket === "undefined") {
      throw new Error("Global WebSocket is not available in this Node runtime");
    }
    // permessage-deflate can cause large memory spikes/leaks on some Node/Android builds; disable for stability.
    this._ws = new WebSocket(url, { perMessageDeflate: false });
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
        console.log(JSON.stringify({ type: "ws/connect", ts_ms: Date.now(), url }));
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
              })
            );
          } catch {}
        }
      }
      if (data instanceof ArrayBuffer) {
        this._onData.fire(VSBuffer.wrap(new Uint8Array(data)));
      } else if (ArrayBuffer.isView(data)) {
        this._onData.fire(VSBuffer.wrap(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
      } else if (typeof data === "string") {
        this._onData.fire(VSBuffer.fromString(data));
      } else {
        // Node's WebSocket should yield ArrayBuffer; ignore unknown
      }
    });
    this._ws.addEventListener("close", (ev) => {
      this._onClose.fire({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean, event: ev });
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
    this._bpHighWater = Number(process?.env?.TE2_WS_BACKPRESSURE_HIGH_WATER ?? String(1024 * 1024));
    this._bpMaxPending = Number(process?.env?.TE2_WS_BACKPRESSURE_MAX_PENDING ?? String(8 * 1024 * 1024));
    this._bpTrace = String(process?.env?.TE2_WS_BACKPRESSURE_TRACE || "") === "1";
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
          })
        );
      } catch {}
    }

    // If the underlying ws is already buffering a lot, enqueue and drip-feed to avoid unbounded internal buffering.
    if (buffered >= this._bpHighWater || this._flushing || this._pending.length > 0) {
      this._pending.push(b);
      this._pendingBytes += b.length;
      if (this._bpMaxPending > 0 && this._pendingBytes > this._bpMaxPending) {
        throw new Error(
          `ws backpressure queue exceeded: pendingBytes=${this._pendingBytes} bufferedAmount=${buffered} label=${this.debugLabel ?? ""}`
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
  constructor({ wsSchema = "ws", basePathname = "/" } = {}) {
    this._wsSchema = wsSchema || "ws";
    this._basePathname = basePathname || "/";
  }

  connect({ host, port }, path, query, debugLabel) {
    return new Promise((resolve, reject) => {
      const base = String(this._basePathname || "/").replace(/\/+$/g, "");
      const p = String(path ?? "").replace(/^\/+/g, "");
      // match browser behavior: prefix with basePathname and collapse // -> /
      const fullPath = `${base}/${p}`.replace(/\/+/g, "/");
      const hostPart = /:/.test(host) && !/\[/.test(host) ? `[${host}]` : host;
      const url = `${this._wsSchema}://${hostPart}:${port}${fullPath}?${query}&skipWebSocketFrames=false`;
      const ws = new NodeWebSocket(url);
      const d = ws.onError(reject);
      ws.onOpen(() => {
        d.dispose?.();
        resolve(new NodeSocket(ws, debugLabel));
      });
    });
  }
}
