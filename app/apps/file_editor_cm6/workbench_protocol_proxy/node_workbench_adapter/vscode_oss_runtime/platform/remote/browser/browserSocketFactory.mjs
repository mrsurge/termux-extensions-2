import { Emitter } from "../../../base/common/event.mjs";
import { VSBuffer } from "../../../base/common/buffer.mjs";

class NodeWebSocket {
  constructor(url) {
    if (typeof WebSocket === "undefined") {
      throw new Error("Global WebSocket is not available in this Node runtime");
    }
    this._ws = new WebSocket(url);
    this._onData = new Emitter();
    this.onData = this._onData.event;
    this._onOpen = new Emitter();
    this.onOpen = this._onOpen.event;
    this._onClose = new Emitter();
    this.onClose = this._onClose.event;
    this._onError = new Emitter();
    this.onError = this._onError.event;

    this._ws.binaryType = "arraybuffer";
    this._ws.addEventListener("open", () => this._onOpen.fire());
    this._ws.addEventListener("message", (ev) => {
      const data = ev.data;
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
    this._ws.send(b);
  }

  end() {
    this._ws.close();
  }

  drain() {
    return Promise.resolve();
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
