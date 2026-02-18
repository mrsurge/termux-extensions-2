import http from "node:http";
import crypto from "node:crypto";
import v8 from "node:v8";
import path from "node:path";
import readline from "node:readline";

import { WorkbenchClient } from "./workbench_client.mjs";

const HOST = process.env.TE2_ADAPTER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TE2_ADAPTER_PORT ?? "8001");
const DEFAULT_CODE_SERVER_HTTP = process.env.TE2_CODE_SERVER_HTTP ?? "http://127.0.0.1:18180";
const DEFAULT_REMOTE_AUTHORITY = process.env.TE2_REMOTE_AUTHORITY ?? "localhost:18180";

const SYNC_TRACE_ENABLE = String(process.env.TE2_SYNC_TRACE || "") === "1";
const SYNC_TRACE_MAX = Number(process.env.TE2_SYNC_TRACE_MAX ?? "200");
const SYNC_TRACE_MIN_MS = Number(process.env.TE2_SYNC_TRACE_MIN_MS ?? "20");
const SYNC_TRACE_MIN_BYTES = Number(process.env.TE2_SYNC_TRACE_MIN_BYTES ?? String(256 * 1024));

const _BASE_JSON_STRINGIFY = JSON.stringify;
// With pipe backend, stdout is reserved for <<<RPC>>> responses.
// Redirect all console.log to stderr so logs remain visible in framework shells UI.
const _origConsoleLog = console.log;
console.log = (...args) => console.error(...args);

function _stackTop(skip = 2, limit = 6) {
  try {
    const s = new Error().stack || "";
    return s.split("\n").slice(skip, skip + limit).map((l) => l.trim());
  } catch {
    return [];
  }
}

function installSyncTrace() {
  if (!SYNC_TRACE_ENABLE) return;
  let remaining = Number.isFinite(SYNC_TRACE_MAX) ? SYNC_TRACE_MAX : 0;
  if (remaining <= 0) return;

  const log = (ev) => {
    if (remaining <= 0) return;
    remaining -= 1;
    try {
      // Use the baseline stringify to avoid recursion if JSON.stringify is patched.
      console.log(_BASE_JSON_STRINGIFY({ type: "sync/trace", ts_ms: Date.now(), ...ev }));
    } catch {}
  };

  // JSON.parse
  try {
    const origParse = JSON.parse;
    JSON.parse = function te2Parse(str, ...rest) {
      const start = Date.now();
      const s = typeof str === "string" ? str : "";
      try {
        return origParse.call(this, str, ...rest);
      } finally {
        const dur = Date.now() - start;
        const bytes = s ? Buffer.byteLength(s, "utf8") : 0;
        if (dur >= SYNC_TRACE_MIN_MS || bytes >= SYNC_TRACE_MIN_BYTES) {
          log({ op: "JSON.parse", dur_ms: dur, bytes, stack: _stackTop(3) });
        }
      }
    };
  } catch {}

  // JSON.stringify
  try {
    const origStringify = JSON.stringify;
    JSON.stringify = function te2Stringify(value, replacer, space) {
      const start = Date.now();
      let out = null;
      try {
        out = origStringify.call(this, value, replacer, space);
        return out;
      } finally {
        const dur = Date.now() - start;
        const bytes = typeof out === "string" ? Buffer.byteLength(out, "utf8") : 0;
        if (dur >= SYNC_TRACE_MIN_MS || bytes >= SYNC_TRACE_MIN_BYTES) {
          let kind = typeof value;
          if (value && typeof value === "object") kind = Array.isArray(value) ? "array" : "object";
          log({ op: "JSON.stringify", dur_ms: dur, out_bytes: bytes, in_kind: kind, stack: _stackTop(3) });
        }
      }
    };
  } catch {}

  // Buffer.concat
  try {
    const origConcat = Buffer.concat;
    Buffer.concat = function te2Concat(list, totalLength) {
      const start = Date.now();
      let out = null;
      try {
        out = origConcat.call(this, list, totalLength);
        return out;
      } finally {
        const dur = Date.now() - start;
        const outBytes = out?.length ?? 0;
        let inBytes = 0;
        try {
          if (Number.isFinite(totalLength)) inBytes = Number(totalLength) || 0;
          else if (Array.isArray(list)) inBytes = list.reduce((a, b) => a + (b?.length ?? 0), 0);
        } catch {}
        if (dur >= SYNC_TRACE_MIN_MS || outBytes >= SYNC_TRACE_MIN_BYTES) {
          log({ op: "Buffer.concat", dur_ms: dur, in_bytes: inBytes, out_bytes: outBytes, stack: _stackTop(3) });
        }
      }
    };
  } catch {}
}

function nowMs() {
  return Date.now();
}

function pathFromUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    if (u.protocol === "file:") return decodeURIComponent(u.pathname);
    if (u.protocol === "vscode-remote:") return decodeURIComponent(u.pathname);
    return null;
  } catch {
    return null;
  }
}

function authorityFromUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    return u.host || null;
  } catch {
    return null;
  }
}

function normalizePathParam(params) {
  const p = (params && typeof params === "object") ? params : {};
  if (typeof p.path === "string" && p.path.trim()) return p.path;
  if (typeof p.uri === "string" && p.uri.trim()) {
    const fromUri = pathFromUri(p.uri);
    if (typeof fromUri === "string" && fromUri.trim()) return fromUri;
  }
  return "";
}

function normalizeAuthorityParam(params, fallback = DEFAULT_REMOTE_AUTHORITY) {
  const p = (params && typeof params === "object") ? params : {};
  if (typeof p.authority === "string" && p.authority.trim()) return p.authority;
  if (typeof p.uri === "string" && p.uri.trim()) {
    const fromUri = authorityFromUri(p.uri);
    if (typeof fromUri === "string" && fromUri.trim()) return fromUri;
  }
  return fallback;
}

function vscodeRemoteUri(authority, fsPath) {
  const pathPart = String(fsPath || "");
  return `vscode-remote://${authority}${pathPart}`;
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
    upstreamHttp: process.env.TE2_UPSTREAM_HTTP ?? DEFAULT_CODE_SERVER_HTTP,
    proxyHttp: process.env.TE2_PROXY_HTTP ?? DEFAULT_CODE_SERVER_HTTP,
  },
  session: {
    connected: false,
    ready: false,
    mgmtConnected: false,
    extConnected: false,
    useRemote: null,
    authority: null,
    serverRootPath: null,
    commit: null,
    workspaceFolder: null,
    activePath: null,
    activeUri: null,
    activeLanguageId: null,
    lastOpenTs: null,
    docSymbolsProviderHandle: null,
    hoverProviderHandle: null,
  },
};

const wsClients = new Set();
const eventLog = [];
const EVENT_LOG_MAX = Number(process.env.TE2_EVENT_LOG_MAX ?? "200");

// Diagnostics baton: a pending Promise resolved when $changeMany includes the target path.
//
// Robustness rules:
// - Only one in-flight "open file -> wait for diagnostics for that file" job at a time.
// - A new open cancels the previous job without emitting diagnostics/ready for the cancelled job.
// - We resolve on the first diagnostics/update that matches the target path, regardless of marker count.
//   (Clean files still need the spinner to stop.)
const DIAG_BATON_TIMEOUT_MS = Number(process.env.TE2_DIAG_BATON_TIMEOUT_MS ?? "45000");
let _diagBatonJob = null; // { absPath, requestId, startMs, timer, resolve, promise }

function batonLog(msg) {
  console.log(`[baton] ts=${Date.now()} ${msg}`);
}

function _absPathFromUri(uri) {
  if (!uri) return "";
  if (typeof uri === "object") {
    // Support URI objects (revived) as well as strings.
    if (typeof uri.fsPath === "string" && uri.fsPath) return uri.fsPath;
    if (typeof uri.path === "string" && uri.path && uri.path.startsWith("/")) return uri.path;
    if (typeof uri.external === "string" && uri.external) return _absPathFromUri(uri.external);
    return "";
  }
  if (typeof uri !== "string") return "";
  if (uri.startsWith("/")) return uri;
  if (uri.startsWith("file://")) return uri.slice(7);
  if (uri.startsWith("vscode-remote://")) {
    const slash = uri.indexOf("/", "vscode-remote://".length);
    return slash !== -1 ? uri.slice(slash) : "";
  }
  return "";
}

function _cancelDiagBatonJob(reason = "cancelled") {
  if (!_diagBatonJob) return;
  try { clearTimeout(_diagBatonJob.timer); } catch {}
  const job = _diagBatonJob;
  _diagBatonJob = null;
  try {
    job.resolve({ status: "cancelled", reason, absPath: job.absPath, requestId: job.requestId });
  } catch {}
}

function _startDiagBatonJob(absPath, requestId) {
  // Cancel previous job without emitting diagnostics/ready for it.
  if (_diagBatonJob && (_diagBatonJob.absPath !== absPath || _diagBatonJob.requestId !== requestId)) {
    batonLog(`cancelling stale job for ${_diagBatonJob.absPath}`);
    _cancelDiagBatonJob("superseded");
  }
  if (_diagBatonJob && _diagBatonJob.absPath === absPath && _diagBatonJob.requestId === requestId) {
    batonLog(`reusing existing job for ${absPath}`);
    return _diagBatonJob.promise;
  }

  batonLog(`CREATED job for ${absPath} requestId=${requestId || "-"}`);
  const startMs = Date.now();
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const timer = setTimeout(() => {
    const elapsed = Date.now() - startMs;
    batonLog(`TIMEOUT path=${absPath} requestId=${requestId || "-"} after ${elapsed}ms`);
    if (_diagBatonJob && _diagBatonJob.absPath === absPath && _diagBatonJob.requestId === requestId) {
      _diagBatonJob = null;
    }
    resolve({ status: "timeout", absPath, requestId, elapsed_ms: elapsed });
  }, Math.max(1000, DIAG_BATON_TIMEOUT_MS));
  _diagBatonJob = { absPath, requestId, startMs, timer, resolve, promise };
  return promise;
}

const EVENT_TRUNC_STR_MAX = Number(process.env.TE2_EVENT_TRUNC_STR_MAX ?? "4096");
const EVENT_TRUNC_ARR_MAX = Number(process.env.TE2_EVENT_TRUNC_ARR_MAX ?? "200");

function _truncateEvent(ev) {
  if (!ev || typeof ev !== "object") return ev;
  const out = { ...ev };
  for (const k of ["result", "error", "body", "data"]) {
    const v = out[k];
    if (typeof v === "string" && v.length > EVENT_TRUNC_STR_MAX) {
      out[k] = `${v.slice(0, EVENT_TRUNC_STR_MAX)}…(truncated ${v.length - EVENT_TRUNC_STR_MAX} chars)`;
    }
  }
  if (Array.isArray(out.args) && out.args.length > EVENT_TRUNC_ARR_MAX) {
    out.args = [...out.args.slice(0, EVENT_TRUNC_ARR_MAX), `…(truncated ${out.args.length - EVENT_TRUNC_ARR_MAX} items)`];
  }
  // Common hot path: openFile sends huge document line arrays; never retain them in server event log.
  try {
    if (Array.isArray(out.args)) {
      for (let i = 0; i < out.args.length; i++) {
        const a = out.args[i];
        if (a && typeof a === "object" && Array.isArray(a?.addedDocuments)) {
          const docs = a.addedDocuments.map((d) => (d && typeof d === "object" ? { ...d, lines: d.lines ? `…(${d.lines.length} lines omitted)` : d.lines } : d));
          out.args[i] = { ...a, addedDocuments: docs };
        }
      }
    }
  } catch {}
  return out;
}

const HEAP_SNAPSHOT_ENABLE = String(process.env.TE2_HEAP_SNAPSHOT_ENABLE || "") === "1";
const HEAP_SNAPSHOT_RATIO = Number(process.env.TE2_HEAP_SNAPSHOT_RATIO ?? "0.9");
const HEAP_SNAPSHOT_INTERVAL_MS = Number(process.env.TE2_HEAP_SNAPSHOT_INTERVAL_MS ?? "1000");
const HEAP_SNAPSHOT_PATH = process.env.TE2_HEAP_SNAPSHOT_PATH || "";
const HEAP_SNAPSHOT_DIR = process.env.TE2_HEAP_SNAPSHOT_DIR || "";
let _heapSnapTimer = null;

function wsBroadcastNotification(method, params) {
  if (wsClients.size === 0) return;
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  for (const sock of wsClients) {
    try {
      wsSendText(sock, msg);
    } catch {}
  }
}

function emitTe2Event(ev) {
  if (Number.isFinite(EVENT_LOG_MAX) && EVENT_LOG_MAX > 0) {
    eventLog.push(ev);
    while (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
  }
  wsBroadcastNotification("te2.event", ev);
}

function uriObjToString(uriObj) {
  if (!uriObj) return null;
  if (typeof uriObj === "string") return uriObj;
  if (typeof uriObj !== "object") return null;

  // Prefer VS Code's computed external form when present.
  if (typeof uriObj.external === "string" && uriObj.external) return uriObj.external;
  // Some uri objects carry fsPath but not scheme; treat as a file URI string.
  if (typeof uriObj.fsPath === "string" && uriObj.fsPath) return `file://${uriObj.fsPath}`;

  const scheme = typeof uriObj.scheme === "string" ? uriObj.scheme : "";
  const authority = typeof uriObj.authority === "string" ? uriObj.authority : "";
  const path = typeof uriObj.path === "string" ? uriObj.path : "";
  if (!scheme || !path) return null;
  return `${scheme}://${authority}${path}`;
}

function diagnosticsFromChangeMany(args) {
  if (!Array.isArray(args) || args.length < 2) return null;
  const owner = typeof args[0] === "string" ? args[0] : "unknown";
  const pairs = Array.isArray(args[1]) ? args[1] : [];
  const items = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const uriObj = pair[0];
    // Markers are usually an array, but in mixed-arg payloads they may show up wrapped
    // as { __json_with_buffers__: <json>, buffers: <n> }. Unwrap defensively.
    let markersRaw = pair[1];
    if (markersRaw && typeof markersRaw === "object" && !Array.isArray(markersRaw)) {
      if (Object.prototype.hasOwnProperty.call(markersRaw, "__json_with_buffers__")) {
        markersRaw = markersRaw.__json_with_buffers__;
      } else if (Object.prototype.hasOwnProperty.call(markersRaw, "markers")) {
        markersRaw = markersRaw.markers;
      }
    }
    const markers = Array.isArray(markersRaw) ? markersRaw : [];
    const uri = uriObjToString(uriObj);
    if (!uri) continue;
    items.push({ uri, markers });
  }
  return { owner, items };
}

function buildStatusResult() {
  const s = wb.status();
  state.session.connected = !!s.connected;
  state.session.ready = !!s.ready;
  state.session.mgmtConnected = !!s.mgmtConnected;
  state.session.extConnected = !!s.extConnected;
  state.session.useRemote = s.useRemote ?? null;
  state.session.authority = s.authority ?? null;
  state.session.serverRootPath = s.serverRootPath ?? null;
  state.session.commit = s.commit ?? null;
  state.session.workspaceFolder = s.workspaceFolder ?? null;
  state.session.activePath = s.activePath ?? null;
  state.session.activeUri = s.activeUri ?? null;
  state.session.activeLanguageId = s.activeLanguageId ?? null;
  state.session.lastOpenTs = s.lastOpenTs ?? null;
  state.session.docSymbolsProviderHandle = s.docSymbolsProviderHandle ?? null;
  state.session.hoverProviderHandle = s.hoverProviderHandle ?? null;
  return {
    ok: true,
    ts_ms: nowMs(),
    config: state.config,
    clients: { ws: wsClients.size },
    session: state.session,
  };
}

function logStatus(reason, extra = null) {
  try {
    const snap = buildStatusResult();
    const payload = {
      type: "adapter/status",
      ts_ms: nowMs(),
      reason: String(reason || "update"),
      clients: snap.clients,
      session: snap.session,
    };
    if (extra && typeof extra === "object") payload.extra = extra;
    console.log(JSON.stringify(payload));
  } catch {}
}

const wb = new WorkbenchClient({
  onEvent: (ev) => {
    const safeEv = _truncateEvent(ev);
    emitTe2Event(safeEv);

    // Push semantic tokens provider registration to frontend via stdout pipe
    if (safeEv?.type === "provider/semanticTokens") {
      const pushPayload = {
        event: "semantic_tokens_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
        legend: safeEv.legend,
        range: !!safeEv.range,
      };
      console.error(`[server] PUSH semantic_tokens_provider_registered lang=${safeEv.language} handle=${safeEv.handle} range=${!!safeEv.range} legendTypes=${safeEv.legend?.tokenTypes?.length ?? 0}`);
      process.stdout.write("<<<PUSH>>> " + JSON.stringify(pushPayload) + "\n");
    }

    if (safeEv?.type === "diagnostics/changeMany" && Array.isArray(safeEv?.args)) {
      const norm = diagnosticsFromChangeMany(safeEv.args);
      console.log(`[server] diagnostics/changeMany -> norm=${norm ? `owner=${norm.owner} items=${norm.items.length} markerCounts=[${norm.items.map(i => (i.markers||[]).length).join(',')}]` : 'null'}`);
      if (norm) {
        emitTe2Event({
          type: "diagnostics/update",
          ts_ms: nowMs(),
          owner: norm.owner,
          items: norm.items,
        });

        // Diagnostics baton: resolve the current in-flight job when any item URI matches its path.
        // We intentionally resolve on the first match, regardless of marker count, so clean files
        // do not spin forever and late-arriving diagnostics for previous files won't block.
        // EXCEPTION: When markers=0 arrives very quickly (<1500ms), defer resolution briefly
        // because some extensions (clangd) clear diagnostics on document re-open then re-send.
        const DIAG_EMPTY_GRACE_MS = 1500;
        if (_diagBatonJob) {
          const wantPath = _diagBatonJob.absPath;
          for (const item of norm.items) {
            const itemPath = _absPathFromUri(item.uri || "");
            try {
              // Minimal debug to see why a match is missed without dumping huge payloads.
              batonLog(`diag item uri=${typeof item.uri === "string" ? item.uri : "[obj]"} itemPath=${itemPath} wantPath=${wantPath} markers=${(item.markers || []).length}`);
            } catch {}
            if (itemPath && wantPath && itemPath === wantPath) {
              const markerCount = (item.markers || []).length;
              const elapsed = Date.now() - (_diagBatonJob.startMs || Date.now());
              // If markers=0 and we're still within the grace window, defer — wait for real diagnostics.
              if (markerCount === 0 && elapsed < DIAG_EMPTY_GRACE_MS) {
                batonLog(`DEFER empty match path=${itemPath} elapsed=${elapsed}ms (grace ${DIAG_EMPTY_GRACE_MS}ms)`);
                // Schedule a fallback: if no non-empty match arrives in the grace window, resolve with 0.
                if (!_diagBatonJob._emptyGraceTimer) {
                  const jobRef = _diagBatonJob;
                  _diagBatonJob._emptyGraceTimer = setTimeout(() => {
                    if (_diagBatonJob === jobRef) {
                      batonLog(`GRACE expired, resolving with markers=0 for ${itemPath}`);
                      try { clearTimeout(_diagBatonJob.timer); } catch {}
                      _diagBatonJob = null;
                      try {
                        jobRef.resolve({ status: "matched", absPath: itemPath, requestId: jobRef.requestId, owner: norm.owner, markers: 0, elapsed_ms: Date.now() - jobRef.startMs });
                      } catch {}
                    }
                  }, DIAG_EMPTY_GRACE_MS - elapsed);
                }
                break;
              }
              batonLog(`MATCH path=${itemPath} owner=${norm.owner} markers=${markerCount} elapsed=${elapsed}ms`);
              try { clearTimeout(_diagBatonJob.timer); } catch {}
              try { clearTimeout(_diagBatonJob._emptyGraceTimer); } catch {}
              const job = _diagBatonJob;
              _diagBatonJob = null;
              try {
                job.resolve({ status: "matched", absPath: itemPath, requestId: job.requestId, owner: norm.owner, markers: markerCount, elapsed_ms: elapsed });
              } catch {}
              break;
            }
          }
        }
      }
    }
  },
});

installSyncTrace();

if (HEAP_SNAPSHOT_ENABLE) {
  try {
    _heapSnapTimer = setInterval(() => {
      const usage = process.memoryUsage();
      const limit = v8.getHeapStatistics().heap_size_limit || 0;
      const used = usage.heapUsed || 0;
      if (!limit || !used) return;
      const ratio = used / limit;
      if (ratio < HEAP_SNAPSHOT_RATIO) return;

      const outPath = HEAP_SNAPSHOT_PATH || undefined;
      const file = v8.writeHeapSnapshot(outPath);
      try {
        console.log(
          JSON.stringify({
            type: "metrics/heap_snapshot",
            ts_ms: nowMs(),
            heap_used: used,
            heap_limit: limit,
            ratio,
            file,
          })
        );
      } catch {}

      clearInterval(_heapSnapTimer);
      _heapSnapTimer = null;
    }, Math.max(200, HEAP_SNAPSHOT_INTERVAL_MS));
    _heapSnapTimer.unref?.();
  } catch {}
}

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

  if (method === "te2.status" || method === "adapter.status") {
    return { jsonrpc: "2.0", id, result: buildStatusResult() };
  }

  if (method === "adapter.events") {
    const p = (params && typeof params === "object") ? params : {};
    const limit = Number.isFinite(Number(p.limit)) ? Math.max(0, Math.min(5000, Number(p.limit))) : 200;
    const slice = limit ? eventLog.slice(-limit) : [...eventLog];
    if (p.clear === true) eventLog.length = 0;
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), count: eventLog.length, events: slice } };
  }

  if (method === "adapter.shutdown") {
    // Graceful shutdown (useful for heap-profiling runs).
    setTimeout(() => {
      process.exit(0);
    }, 50).unref?.();
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs() } };
  }

  if (method === "adapter.connect") {
    const p = (params && typeof params === "object") ? params : {};
    const result = await wb.connect({
      proxyHttp: p.proxyHttp ?? state.config.proxyHttp,
      token: p.token,
      folder: p.folder,
      authority: p.authority ?? DEFAULT_REMOTE_AUTHORITY,
      serverRootPath: p.serverRootPath,
      commit: p.commit,
      proxyUri: p.proxyUri,
    });
    buildStatusResult();
    logStatus("adapter_connected");
    // Broadcast adapter readiness via WS so the diagnostics bridge can relay it.
    emitTe2Event({ type: "adapter/ready", ts_ms: nowMs(), session: state.session });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "adapter.disconnect") {
    try {
      wb.disconnect?.();
    } catch {}
    state.session.connected = false;
    state.session.ready = false;
    state.session.mgmtConnected = false;
    state.session.extConnected = false;
    state.session.activePath = null;
    state.session.activeUri = null;
    state.session.activeLanguageId = null;
    state.session.lastOpenTs = null;
    state.session.docSymbolsProviderHandle = null;
    state.session.hoverProviderHandle = null;
    logStatus("adapter_disconnected");
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs() } };
  }

  if (method === "adapter.resubscribeWatcher") {
    try {
      await wb.resubscribeWatcher();
      return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs() } };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message ?? e) } };
    }
  }

  if (method === "adapter.reconnect") {
    const p = (params && typeof params === "object") ? params : {};
    try {
      wb.disconnect();
      const connectParams = {
        folder: p.workspaceFolder ?? null,
        authority: p.authority ?? DEFAULT_REMOTE_AUTHORITY,
        proxyHttp: p.proxyHttp ?? DEFAULT_CODE_SERVER_HTTP,
        token: p.token ?? "00000000000000000000",
      };
      const result = await wb.connect(connectParams);
      state.session = { ...state.session, ...wb.state };
      logStatus("adapter_reconnected");
      return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), ...result } };
    } catch (e) {
      logStatus("adapter_reconnect_error");
      return { jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message ?? e) } };
    }
  }

  if (method === "adapter.heapSnapshot") {
    const p = (params && typeof params === "object") ? params : {};
    const label = typeof p.label === "string" ? p.label : "manual";
    const dir = HEAP_SNAPSHOT_DIR || (HEAP_SNAPSHOT_PATH ? path.dirname(HEAP_SNAPSHOT_PATH) : "");
    const outPath = typeof p.path === "string"
      ? p.path
      : (dir ? path.join(dir, `te2-${label}-${nowMs()}.heapsnapshot`) : undefined);
    const usage = process.memoryUsage();
    const limit = v8.getHeapStatistics().heap_size_limit || 0;
    const used = usage.heapUsed || 0;
    const file = v8.writeHeapSnapshot(outPath);
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), file, heap_used: used, heap_limit: limit } };
  }

  if (method === "adapter.providers") {
    const result = wb.providers?.() ?? { hover: [], documentSymbols: [] };
    return { jsonrpc: "2.0", id, result: { ok: true, ts_ms: nowMs(), ...result } };
  }

  if (method === "vscode.openFile") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    const requestId = (typeof p.requestId === "string" && p.requestId) ? p.requestId : null;
    const forceRefreshReq = p.forceRefresh === true;
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);

    const alreadyActive = resolvedPath === wb.state?.activePath;
    // IMPORTANT:
    // The editor can reconnect/refresh and re-request openFile for the already-active path.
    // If we skip the open cycle, the ext host may not re-emit diagnostics for the new client.
    // To make "change file" requests deterministic for *every* client, treat alreadyActive
    // + requestId as an explicit refresh request.
    const forceRefreshEff = forceRefreshReq || (alreadyActive && !!requestId);
    batonLog(
      `vscode.openFile ENTER path=${resolvedPath} id=${id} requestId=${requestId || "-"} alreadyActive=${alreadyActive ? 1 : 0} forceRefresh_req=${forceRefreshReq ? 1 : 0} forceRefresh_eff=${forceRefreshEff ? 1 : 0}`
    );

    const openFileSnapEnabled =
      String(process.env.TE2_OPENFILE_SNAPSHOT_ENABLE || "") === "1"
      || Object.hasOwn(process.env, "TE2_OPENFILE_SNAPSHOT_AFTER_MS")
      || Object.hasOwn(process.env, "TE2_OPENFILE_SNAPSHOT_PATH");
    if (openFileSnapEnabled) {
      const snapAfterMs = Number(process.env.TE2_OPENFILE_SNAPSHOT_AFTER_MS ?? "0");
      const snapExit = String(process.env.TE2_OPENFILE_SNAPSHOT_EXIT || "") === "1";
      if (Number.isFinite(snapAfterMs) && snapAfterMs >= 0) {
        const snapDir = HEAP_SNAPSHOT_DIR || (HEAP_SNAPSHOT_PATH ? path.dirname(HEAP_SNAPSHOT_PATH) : "");
        const snapPath = process.env.TE2_OPENFILE_SNAPSHOT_PATH
          || (snapDir ? path.join(snapDir, `te2-openFile-${nowMs()}.heapsnapshot`) : undefined);
        const timer = setTimeout(() => {
          try {
            const usage = process.memoryUsage();
            const limit = v8.getHeapStatistics().heap_size_limit || 0;
            const used = usage.heapUsed || 0;
            const file = v8.writeHeapSnapshot(snapPath);
            console.log(
              JSON.stringify({
                type: "metrics/heap_snapshot",
                ts_ms: nowMs(),
                reason: "openFile",
                after_ms: snapAfterMs,
                heap_used: used,
                heap_limit: limit,
                file,
              })
            );
          } catch {}
          if (snapExit) process.exit(0);
        }, snapAfterMs);
        timer.unref?.();
      }
    }

    const result = await wb.openFile({
      path: resolvedPath,
      languageId: p.languageId,
      authority,
      forceRefresh: forceRefreshEff,
      generation: p.generation,
    });
    batonLog(`wb.openFile returned for ${resolvedPath}`);
    logStatus("open_file", { path: resolvedPath });

    // Diagnostics baton: wait for $changeMany to include this file's URI.
    // The Promise resolves when onEvent sees a matching diagnostics/update for this file,
    // or on timeout. Non-blocking to the HTTP response — fires async.
    (async () => {
      batonLog(`waiting for diagnostics for ${resolvedPath} requestId=${requestId || "-"}`);
      const r = await _startDiagBatonJob(resolvedPath, requestId);
      if (r && r.status === "cancelled") return;
      const error = r && r.status === "timeout";
      batonLog(`emitting diagnostics/ready path=${resolvedPath} status=${r?.status || "?"}`);
      emitTe2Event({
        type: "diagnostics/ready",
        ts_ms: nowMs(),
        path: resolvedPath,
        request_id: requestId,
        error: error || undefined,
        reason: r?.status || undefined,
        markers: (r && typeof r.markers === "number") ? r.markers : undefined,
        owner: r?.owner,
      });
    })();

    return { jsonrpc: "2.0", id, result: { ...result, path: resolvedPath, uri: vscodeRemoteUri(authority, resolvedPath) } };
  }

  if (method === "vscode.documentSymbols") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);
    const result = await wb.documentSymbols({
      path: resolvedPath,
      authority,
      providerHandle: p.providerHandle,
      languageId: p.languageId,
      timeoutMs: p.timeoutMs,
      generation: p.generation,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.hover") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);
    const result = await wb.hover({
      path: resolvedPath,
      authority,
      providerHandle: p.providerHandle,
      languageId: p.languageId,
      lineNumber: p.lineNumber,
      column: p.column,
      timeoutMs: p.timeoutMs,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.completions") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);
    const result = await wb.completions({
      path: resolvedPath,
      authority,
      providerHandle: p.providerHandle,
      languageId: p.languageId,
      lineNumber: p.lineNumber,
      column: p.column,
      triggerKind: p.triggerKind,
      triggerCharacter: p.triggerCharacter,
      timeoutMs: p.timeoutMs,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.semanticTokens") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);
    const result = await wb.semanticTokens({
      path: resolvedPath,
      authority,
      providerHandle: p.providerHandle,
      languageId: p.languageId,
      previousResultId: p.previousResultId,
      timeoutMs: p.timeoutMs,
    });
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.semanticTokensLegend") {
    const p = (params && typeof params === "object") ? params : {};
    const languageId = String(p.languageId || "");
    const legend = await wb.getSemanticTokensLegend(languageId);
    return { jsonrpc: "2.0", id, result: { ok: !!legend, legend } };
  }

  if (method === "vscode.semanticTokensRange") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const authority = normalizeAuthorityParam(p, DEFAULT_REMOTE_AUTHORITY);
    const result = await wb.semanticTokensRange({
      path: resolvedPath,
      authority,
      providerHandle: p.providerHandle,
      languageId: p.languageId,
      range: p.range,
      timeoutMs: p.timeoutMs,
    });
    console.error(`[semanticTokensRange_reply] ok=${result?.ok} hasData=${!!(result?.result?.data?.length)} dataLen=${result?.result?.data?.length ?? 0}`);
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "vscode.didChange") {
    const p = (params && typeof params === "object") ? params : {};
    const resolvedPath = normalizePathParam(p);
    if (!resolvedPath) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: provide path or uri" } };
    }
    const result = wb.didChange({
      path: resolvedPath,
      text: String(p.text ?? ""),
      languageId: p.languageId,
      generation: p.generation,
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
          `  curl -s -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"te2.status\"}' http://${HOST}:${PORT}/cmd`,
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
    logStatus("ws_client_open");
    const drop = () => {
      wsClients.delete(socket);
      logStatus("ws_client_close");
    };
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
  // Startup beacon MUST go to stdout (not stderr) for the shellspec stdout_regex readiness probe.
  process.stdout.write(JSON.stringify({ type: "adapter/start", ts_ms: nowMs(), listen: `http://${HOST}:${PORT}`, config: state.config }) + "\n");
});

// ── stdio JSON-RPC transport ────────────────────────────────────────
// Allows the Python worker (editor_ws.py) to call handleJsonRpc over
// a pipe instead of HTTP, eliminating a network hop.
// Protocol: one JSON object per line on stdin → <<<RPC>>> {json}\n on stdout.
// Non-RPC output (console.log, etc.) is unchanged — Python splits on prefix.

const _stdinRl = readline.createInterface({ input: process.stdin, terminal: false });

_stdinRl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    const err = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    process.stdout.write("<<<RPC>>> " + JSON.stringify(err) + "\n");
    return;
  }
  try {
    const reply = await handleJsonRpc(msg);
    if (reply && reply.id != null) {
      process.stdout.write("<<<RPC>>> " + JSON.stringify(reply) + "\n");
    }
  } catch (e) {
    const err = { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32000, message: String(e?.message ?? e) } };
    process.stdout.write("<<<RPC>>> " + JSON.stringify(err) + "\n");
  }
});

_stdinRl.on("close", () => {
  // stdin closed — parent process gone. Graceful shutdown.
  setTimeout(() => process.exit(0), 100).unref?.();
});
