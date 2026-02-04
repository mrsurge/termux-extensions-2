import http from "node:http";
import crypto from "node:crypto";

import { WorkbenchClient } from "./workbench_client.mjs";

const HOST = process.env.TE2_ADAPTER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TE2_ADAPTER_PORT ?? "8001");

function nowMs() {
  return Date.now();
}

function jsonResponse(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function textResponse(res, code, text) {
  res.writeHead(code, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function wsAcceptValue(secWebSocketKey) {
  // RFC6455: accept = base64( SHA1(key + GUID) )
  const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  return crypto
    .createHash("sha1")
    .update(secWebSocketKey + GUID, "utf8")
    .digest("base64");
}

function wsSendFrame(socket, opcode, payloadBuf) {
  const payload = payloadBuf ?? Buffer.alloc(0);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f); // FIN + opcode
  socket.write(Buffer.concat([header, payload]));
}

function wsSendText(socket, text) {
  wsSendFrame(socket, 0x1, Buffer.from(text, "utf8"));
}

function wsSendClose(socket, code = 1000, reason = "") {
  const reasonBuf = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  wsSendFrame(socket, 0x8, payload);
}

function wsTryReadFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;

  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off);
    off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    const n = buf.readBigUInt64BE(off);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("ws frame too large");
    }
    len = Number(n);
    off += 8;
  }

  let maskKey = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    maskKey = buf.subarray(off, off + 4);
    off += 4;
  }

  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  const consumed = off + len;

  if (masked) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
    payload = out;
  }

  return { fin, opcode, payload, consumed };
}

async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

const state = {
  startedAtMs: nowMs(),
  // Will be filled by the real implementation:
  // - upstream base URL (code-server)
  // - go decoder proxy URL (optional)
  // - mgmt/ext connection status
  config: {
    upstreamHttp: process.env.TE2_UPSTREAM_HTTP ?? "http://127.0.0.1:8080",
    proxyHttp: process.env.TE2_PROXY_HTTP ?? "http://127.0.0.1:8000",
  },
  session: {
    connected: false,
    ready: false,
    docSymbolsProviderHandle: null,
    hoverProviderHandle: null,
  },
};

const wsClients = new Set();
const eventLog = [];
const EVENT_LOG_MAX = Number(process.env.TE2_EVENT_LOG_MAX ?? "2000");

function wsBroadcastNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  for (const sock of wsClients) {
    try {
      wsSendText(sock, msg);
    } catch {}
  }
}

const wb = new WorkbenchClient({
  onEvent: (ev) => {
    eventLog.push(ev);
    while (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
    // Mirror to WS clients as TE2 events; HTTP clients can poll via adapter.status.
    wsBroadcastNotification("te2.event", ev);
  },
});

async function handleJsonRpc(reqObj) {
  // We accept either JSON-RPC 2.0, or a simple {cmd,args} convenience envelope.
  let id = reqObj?.id ?? null;
  let method = reqObj?.method ?? null;
  let params = reqObj?.params ?? null;

  if (typeof method !== "string" && typeof reqObj?.cmd === "string") {
    method = reqObj.cmd;
    params = reqObj.args ?? null;
    id = reqObj.id ?? 1;
  }

  if (typeof method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
  }

  if (method === "te2.ping") {
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs() } };
  }

  if (method === "adapter.status") {
    const s = wb.status();
    state.session.connected = !!s.connected;
    state.session.ready = !!s.ready;
    state.session.docSymbolsProviderHandle = s.docSymbolsProviderHandle ?? null;
    state.session.hoverProviderHandle = s.hoverProviderHandle ?? null;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        ok: true,
        ts_ms: nowMs(),
        config: state.config,
        session: state.session,
      },
    };
  }

  if (method === "adapter.events") {
    const p = (params && typeof params === "object") ? params : {};
    const limit = Number.isFinite(Number(p.limit)) ? Math.max(0, Math.min(5000, Number(p.limit))) : 200;
    const slice = limit ? eventLog.slice(-limit) : [...eventLog];
    if (p.clear === true) eventLog.length = 0;
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), count: eventLog.length, events: slice } };
  }

  if (method === "adapter.connect") {
    const p = (params && typeof params === "object") ? params : {};
    const result = await wb.connect({
      proxyHttp: p.proxyHttp ?? state.config.proxyHttp,
      token: p.token,
      folder: p.folder,
      authority: p.authority ?? "localhost:8000",
      serverRootPath: p.serverRootPath,
      commit: p.commit,
      proxyUri: p.proxyUri,
    });
    const s = wb.status();
    state.session.connected = !!s.connected;
    state.session.ready = !!s.ready;
    state.session.docSymbolsProviderHandle = s.docSymbolsProviderHandle ?? null;
    state.session.hoverProviderHandle = s.hoverProviderHandle ?? null;
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.openFile") {
    const p = (params && typeof params === "object") ? params : {};
    const result = await wb.openFile({
      path: p.path,
      languageId: p.languageId,
      authority: p.authority ?? "localhost:8000",
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.documentSymbols") {
    const p = (params && typeof params === "object") ? params : {};
    const result = await wb.documentSymbols({
      path: p.path,
      authority: p.authority ?? "localhost:8000",
      providerHandle: p.providerHandle,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.hover") {
    const p = (params && typeof params === "object") ? params : {};
    const result = await wb.hover({
      path: p.path,
      authority: p.authority ?? "localhost:8000",
      providerHandle: p.providerHandle,
      lineNumber: p.lineNumber,
      column: p.column,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "adapter.configure") {
    const obj = (params && typeof params === "object") ? params : {};
    if (typeof obj.upstreamHttp === "string") state.config.upstreamHttp = obj.upstreamHttp;
    if (typeof obj.proxyHttp === "string") state.config.proxyHttp = obj.proxyHttp;
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), config: state.config } };
  }

  // Placeholder: next step will implement connect/bootstrap and high-level calls
  // like vscode.symbols/vscode.hover/vscode.openFile/etc.
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      return textResponse(
        res,
        200,
        [
          "TE2 Node workbench adapter (skeleton)",
          "",
          "HTTP:",
          "  POST /cmd   JSON-RPC request (or {cmd,args})",
          "  GET  /health",
          "",
          "Reserved:",
          "  /ws   (WebSocket JSON-RPC in final product)",
          "",
          "Try:",
          `  curl -s -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"te2.ping\"}' http://${HOST}:${PORT}/cmd`,
          `  curl -s -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"adapter.status\"}' http://${HOST}:${PORT}/cmd`,
          "",
        ].join("\n"),
      );
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse(res, 200, { ok: true, ts_ms: nowMs() });
    }

    if (url.pathname === "/ws") {
      return textResponse(res, 426, "Upgrade Required (use WebSocket upgrade)\n");
    }

    if (req.method === "POST" && url.pathname === "/cmd") {
      const obj = await readJson(req);
      if (obj == null) {
        return jsonResponse(res, 400, { ok: false, error: "missing JSON body" });
      }
      const reply = await handleJsonRpc(obj);
      return jsonResponse(res, 200, reply);
    }

    return textResponse(res, 404, "not found\n");
  } catch (e) {
    return jsonResponse(res, 500, { ok: false, error: String(e?.message ?? e) });
  }
});

server.on("upgrade", (req, socket) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    const accept = wsAcceptValue(key);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );

    wsClients.add(socket);
    const drop = () => { wsClients.delete(socket); };
    socket.on("close", drop);
    socket.on("end", drop);
    socket.on("error", drop);

    let buf = Buffer.alloc(0);
    socket.on("data", async (chunk) => {
      buf = Buffer.concat([buf, Buffer.from(chunk)]);
      while (true) {
        const frame = wsTryReadFrame(buf);
        if (!frame) break;
        buf = buf.subarray(frame.consumed);

        const { opcode, payload } = frame;
        if (opcode === 0x8) {
          wsSendClose(socket);
          socket.end();
          drop();
          return;
        }
        if (opcode === 0x9) {
          // ping -> pong
          wsSendFrame(socket, 0xA, payload);
          continue;
        }
        if (opcode !== 0x1) {
          continue;
        }

        // text
        let msg;
        try {
          msg = JSON.parse(payload.toString("utf8"));
        } catch {
          wsSendText(socket, JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
          continue;
        }
        try {
          const reply = await handleJsonRpc(msg);
          // Notifications may have no id; in that case, don't respond.
          if (reply && Object.prototype.hasOwnProperty.call(reply, "id") && reply.id != null) {
            wsSendText(socket, JSON.stringify(reply));
          }
        } catch (e) {
          wsSendText(socket, JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32000, message: String(e?.message ?? e) } }));
        }
      }
    });
  } catch {
    socket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: "adapter/start", ts_ms: nowMs(), listen: `http://${HOST}:${PORT}`, config: state.config }));
});
