import http from "node:http";
import v8 from "node:v8";
import path from "node:path";
import readline from "node:readline";
import fs from "node:fs/promises";
import process from "node:process";
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EditorWbaSocketServer } from "./editor-socket.mjs";
import type { EventBridgeRuntime } from "./event-bridge";
import type {
  AdapterServerState as DispatchServerState,
  HeapSnapshotResult,
  WorkbenchLike,
} from "./request-dispatch";
import { formatErrorMessage } from "./error-format.mjs";
import { sendWebviewResourceResponse } from "./webview-resource-response.mjs";

const { WorkbenchClient } = await import("../client/workbench-client.mjs");
const bridgeMod = await import("./event-bridge.mjs");
const dispatchMod = await import("./request-dispatch.mjs");
const editorSocketMod = await import("./editor-socket.mjs");
const stdioMod = await import("./stdio-protocol.mjs");
const textmateMod = await import("./textmate-grammars.mjs");

const {
  buildStatusResult: buildBridgeStatusResult,
  createWorkbenchEventHandler,
  emitTe2Event: emitBridgeEvent,
  logStatus: logBridgeStatus,
} = bridgeMod;
const { dispatchJsonRpcRequest } = dispatchMod;
const { attachEditorWbaSocket } = editorSocketMod;
const {
  buildJsonRpcErrorReply,
  encodePushLine,
  encodeRpcReplyLine,
  encodeStartupBeaconLine,
  parseStdioJsonLine,
} = stdioMod;
const { listTextmateGrammars, loadTextmateGrammar } = textmateMod;

type AdapterRuntimeConfig = Record<string, unknown> & {
  upstreamHttp: string;
  proxyHttp: string;
  codeServerSocketPath: string | null;
};
type AdapterRuntimeState = Omit<DispatchServerState, "config"> & {
  startedAtMs: number;
  config: AdapterRuntimeConfig;
};
type RuntimeWorkbench = Omit<WorkbenchLike, "state"> & {
  state?: Record<string, unknown>;
  status: () => Record<string, unknown>;
  getExtensions?: () => unknown[];
  webviewWrapperHtml: (surfaceId: string) => string;
  webviewDocumentHtml: (
    surfaceId: string,
    resourceOrigin: string,
    bootstrapToken: string,
  ) => string;
  webviewResource: (
    surfaceId: string,
    resourceToken: string,
    scheme: string,
    authority: string,
    resourcePath: string,
  ) => Promise<{
    body: Uint8Array;
    contentType: string;
    etag: string;
    lastModified: string;
  }>;
};
type JsonRpcReply = Record<string, unknown>;
type JsonRpcEnvelope = Record<string, unknown> & {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  cmd?: unknown;
  args?: unknown;
};
type SyncTraceEvent = Record<string, unknown>;
type JsonStringifyReplacer =
  | ((this: unknown, key: string, value: unknown) => unknown)
  | Array<string | number>
  | null;
const HOST = process.env.TE2_ADAPTER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TE2_ADAPTER_PORT ?? "8001");
const DEFAULT_CODE_SERVER_SOCKET_PATH =
  String(process.env.TE2_CODE_SERVER_SOCKET ?? "").trim() || null;
const DEFAULT_CODE_SERVER_HTTP =
  process.env.TE2_CODE_SERVER_HTTP ?? "http://localhost";
const DEFAULT_REMOTE_AUTHORITY =
  process.env.TE2_REMOTE_AUTHORITY ?? "localhost";
const EXTENSION_STORAGE_PATH = String(
  process.env.TE2_EXTENSION_STORAGE_PATH ?? "",
).trim();
if (!EXTENSION_STORAGE_PATH) {
  throw new Error("TE2_EXTENSION_STORAGE_PATH is required");
}
const WEBVIEW_RECONSTRUCTION_STORAGE_PATH = String(
  process.env.TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH ?? "",
).trim();
if (!WEBVIEW_RECONSTRUCTION_STORAGE_PATH) {
  throw new Error("TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH is required");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asJsonRpcEnvelope(value: unknown): JsonRpcEnvelope {
  return isRecord(value) ? value : {};
}

function errorMessage(error: unknown): string {
  return formatErrorMessage(error);
}

const SYNC_TRACE_ENABLE = String(process.env.TE2_SYNC_TRACE || "") === "1";
const SYNC_TRACE_MAX = Number(process.env.TE2_SYNC_TRACE_MAX ?? "200");
const SYNC_TRACE_MIN_MS = Number(process.env.TE2_SYNC_TRACE_MIN_MS ?? "20");
const SYNC_TRACE_MIN_BYTES = Number(
  process.env.TE2_SYNC_TRACE_MIN_BYTES ?? String(256 * 1024),
);

const _BASE_JSON_STRINGIFY = JSON.stringify;
// With pipe backend, stdout is reserved for <<<RPC>>> responses.
// Redirect all console.log to stderr so logs remain visible in framework shells UI.
const _origConsoleLog = console.log;
console.log = (...args) => console.error(...args);

// Guard against EPIPE when Python parent closes the pipe before adapter exits.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err?.code === "EPIPE") return;
  console.error("[server] stdout error:", err);
});

function _stackTop(skip = 2, limit = 6): string[] {
  try {
    const s = new Error().stack || "";
    return s
      .split("\n")
      .slice(skip, skip + limit)
      .map((l) => l.trim());
  } catch {
    return [];
  }
}

function installSyncTrace(): void {
  if (!SYNC_TRACE_ENABLE) return;
  let remaining = Number.isFinite(SYNC_TRACE_MAX) ? SYNC_TRACE_MAX : 0;
  if (remaining <= 0) return;

  const log = (ev: SyncTraceEvent): void => {
    if (remaining <= 0) return;
    remaining -= 1;
    try {
      // Use the baseline stringify to avoid recursion if JSON.stringify is patched.
      console.log(
        _BASE_JSON_STRINGIFY({ type: "sync/trace", ts_ms: Date.now(), ...ev }),
      );
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
    const jsonHooks = JSON as {
      stringify: (
        value: unknown,
        replacer?: JsonStringifyReplacer,
        space?: string | number,
      ) => string | undefined;
    };
    const origStringify = jsonHooks.stringify;
    jsonHooks.stringify = function te2Stringify(
      value: unknown,
      replacer?: JsonStringifyReplacer,
      space?: string | number,
    ): string | undefined {
      const start = Date.now();
      let out: string | undefined;
      try {
        out = origStringify(value, replacer, space);
        return out;
      } finally {
        const dur = Date.now() - start;
        const bytes =
          typeof out === "string" ? Buffer.byteLength(out, "utf8") : 0;
        if (dur >= SYNC_TRACE_MIN_MS || bytes >= SYNC_TRACE_MIN_BYTES) {
          let kind: string = typeof value;
          if (value && typeof value === "object")
            kind = Array.isArray(value) ? "array" : "object";
          log({
            op: "JSON.stringify",
            dur_ms: dur,
            out_bytes: bytes,
            in_kind: kind,
            stack: _stackTop(3),
          });
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
          else if (Array.isArray(list))
            inBytes = list.reduce((a, b) => a + (b?.length ?? 0), 0);
        } catch {}
        if (dur >= SYNC_TRACE_MIN_MS || outBytes >= SYNC_TRACE_MIN_BYTES) {
          log({
            op: "Buffer.concat",
            dur_ms: dur,
            in_bytes: inBytes,
            out_bytes: outBytes,
            stack: _stackTop(3),
          });
        }
      }
    };
  } catch {}
}

function nowMs(): number {
  return Date.now();
}

function pathFromUri(uri: unknown): string | null {
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

function authorityFromUri(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    return u.host || null;
  } catch {
    return null;
  }
}

function normalizePathParam(params: unknown): string {
  const p = isRecord(params) ? params : {};
  if (typeof p.path === "string" && p.path.trim()) return p.path;
  if (typeof p.uri === "string" && p.uri.trim()) {
    const fromUri = pathFromUri(p.uri);
    if (typeof fromUri === "string" && fromUri.trim()) return fromUri;
  }
  return "";
}

function normalizeAuthorityParam(
  params: unknown,
  fallback = DEFAULT_REMOTE_AUTHORITY,
): string {
  const p = isRecord(params) ? params : {};
  if (typeof p.authority === "string" && p.authority.trim()) return p.authority;
  if (typeof p.uri === "string" && p.uri.trim()) {
    const fromUri = authorityFromUri(p.uri);
    if (typeof fromUri === "string" && fromUri.trim()) return fromUri;
  }
  return fallback;
}

function vscodeRemoteUri(authority: string, fsPath: string): string {
  const pathPart = String(fsPath || "");
  return `vscode-remote://${authority}${pathPart}`;
}

function jsonResponse(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function textResponse(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function bodyResponse(
  res: ServerResponse,
  code: number,
  body: string | Uint8Array,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  res.writeHead(code, {
    "content-type": contentType,
    "content-length": payload.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

function httpOrigin(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : "";
  } catch {
    return "";
  }
}

async function readJson(
  req: IncomingMessage,
  maxBytes = 2 * 1024 * 1024,
): Promise<unknown | null> {
  const chunks: Buffer[] = [];
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

const state: AdapterRuntimeState = {
  startedAtMs: nowMs(),
  // Will be filled by the real implementation:
  // - upstream base URL (code-server)
  // - go decoder proxy URL (optional)
  // - mgmt/ext connection status
  config: {
    upstreamHttp: process.env.TE2_UPSTREAM_HTTP ?? DEFAULT_CODE_SERVER_HTTP,
    proxyHttp: process.env.TE2_PROXY_HTTP ?? DEFAULT_CODE_SERVER_HTTP,
    codeServerSocketPath: DEFAULT_CODE_SERVER_SOCKET_PATH,
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

const eventLog: unknown[] = [];
const EVENT_LOG_MAX = Number(process.env.TE2_EVENT_LOG_MAX ?? "200");

const EVENT_TRUNC_STR_MAX = Number(
  process.env.TE2_EVENT_TRUNC_STR_MAX ?? "4096",
);
const EVENT_TRUNC_ARR_MAX = Number(
  process.env.TE2_EVENT_TRUNC_ARR_MAX ?? "200",
);

const HEAP_SNAPSHOT_ENABLE =
  String(process.env.TE2_HEAP_SNAPSHOT_ENABLE || "") === "1";
const HEAP_SNAPSHOT_RATIO = Number(
  process.env.TE2_HEAP_SNAPSHOT_RATIO ?? "0.9",
);
const HEAP_SNAPSHOT_INTERVAL_MS = Number(
  process.env.TE2_HEAP_SNAPSHOT_INTERVAL_MS ?? "1000",
);
const HEAP_SNAPSHOT_PATH = process.env.TE2_HEAP_SNAPSHOT_PATH || "";
const HEAP_SNAPSHOT_DIR = process.env.TE2_HEAP_SNAPSHOT_DIR || "";
let _heapSnapTimer: NodeJS.Timeout | null = null;
let editorWbaSocketServer: EditorWbaSocketServer | null = null;

function wsBroadcastNotification(method: string, params: unknown): void {
  try {
    editorWbaSocketServer?.broadcastNotification(method, params);
  } catch {}
}

function bridgeRuntime(): EventBridgeRuntime {
  return {
    wb,
    state,
    eventLog,
    eventLogMax: EVENT_LOG_MAX,
    eventTruncStrMax: EVENT_TRUNC_STR_MAX,
    eventTruncArrMax: EVENT_TRUNC_ARR_MAX,
    nowMs,
    wsClientCount: () => editorWbaSocketServer?.clientCount() ?? 0,
    wsBroadcastNotification,
    writePushLine: (payload: unknown) =>
      process.stdout.write(encodePushLine(payload)),
    log: (...args: unknown[]) => console.log(...args),
  };
}

function emitTe2Event(ev: Record<string, unknown>): void {
  emitBridgeEvent(bridgeRuntime(), ev);
}

function buildStatusResult(): Record<string, unknown> {
  return buildBridgeStatusResult(bridgeRuntime());
}

function logStatus(
  reason: string,
  extra: Record<string, unknown> | null = null,
): void {
  logBridgeStatus(bridgeRuntime(), reason, extra);
}

function scheduleOpenFileSnapshot(): void {
  const openFileSnapEnabled =
    String(process.env.TE2_OPENFILE_SNAPSHOT_ENABLE || "") === "1" ||
    Object.hasOwn(process.env, "TE2_OPENFILE_SNAPSHOT_AFTER_MS") ||
    Object.hasOwn(process.env, "TE2_OPENFILE_SNAPSHOT_PATH");
  if (!openFileSnapEnabled) return;

  const snapAfterMs = Number(process.env.TE2_OPENFILE_SNAPSHOT_AFTER_MS ?? "0");
  const snapExit = String(process.env.TE2_OPENFILE_SNAPSHOT_EXIT || "") === "1";
  if (!Number.isFinite(snapAfterMs) || snapAfterMs < 0) return;

  const snapDir =
    HEAP_SNAPSHOT_DIR ||
    (HEAP_SNAPSHOT_PATH ? path.dirname(HEAP_SNAPSHOT_PATH) : "");
  const snapPath =
    process.env.TE2_OPENFILE_SNAPSHOT_PATH ||
    (snapDir
      ? path.join(snapDir, `te2-openFile-${nowMs()}.heapsnapshot`)
      : undefined);
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
        }),
      );
    } catch {}
    if (snapExit) process.exit(0);
  }, snapAfterMs);
  timer.unref?.();
}

function takeHeapSnapshot(
  label = "manual",
  explicitPath: string | null = null,
): HeapSnapshotResult {
  const dir =
    HEAP_SNAPSHOT_DIR ||
    (HEAP_SNAPSHOT_PATH ? path.dirname(HEAP_SNAPSHOT_PATH) : "");
  const outPath =
    typeof explicitPath === "string" && explicitPath
      ? explicitPath
      : dir
        ? path.join(dir, `te2-${label}-${nowMs()}.heapsnapshot`)
        : undefined;
  const usage = process.memoryUsage();
  const limit = v8.getHeapStatistics().heap_size_limit || 0;
  const used = usage.heapUsed || 0;
  const file = v8.writeHeapSnapshot(outPath);
  return { file, heap_used: used, heap_limit: limit };
}

let wb: RuntimeWorkbench;
const workbenchEventHandler = (ev: unknown): void =>
  createWorkbenchEventHandler(bridgeRuntime())(ev);
wb = new WorkbenchClient({
  onEvent: workbenchEventHandler,
  onNotification: wsBroadcastNotification,
  extensionStoragePath: EXTENSION_STORAGE_PATH,
  webviewReconstructionStoragePath: WEBVIEW_RECONSTRUCTION_STORAGE_PATH,
}) as unknown as RuntimeWorkbench;

installSyncTrace();

if (HEAP_SNAPSHOT_ENABLE) {
  try {
    _heapSnapTimer = setInterval(
      () => {
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
            }),
          );
        } catch {}

        if (_heapSnapTimer) clearInterval(_heapSnapTimer);
        _heapSnapTimer = null;
      },
      Math.max(200, HEAP_SNAPSHOT_INTERVAL_MS),
    );
    _heapSnapTimer.unref?.();
  } catch {}
}

async function handleJsonRpc(reqObj: unknown): Promise<JsonRpcReply> {
  // We accept either JSON-RPC 2.0, or a simple {cmd,args} convenience envelope.
  const envelope = asJsonRpcEnvelope(reqObj);
  let id = envelope.id ?? null;
  let method = envelope.method ?? null;
  let params = envelope.params ?? null;

  if (typeof method !== "string" && typeof envelope.cmd === "string") {
    method = envelope.cmd;
    params = envelope.args ?? null;
    id = envelope.id ?? 1;
  }

  if (typeof method !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request" },
    };
  }

  const dispatched = await dispatchJsonRpcRequest(
    {
      wb,
      state,
      eventLog,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      defaultCodeServerHttp: DEFAULT_CODE_SERVER_HTTP,
      nowMs,
      normalizePathParam,
      normalizeAuthorityParam,
      vscodeRemoteUri,
      buildStatusResult,
      logStatus,
      emitTe2Event,
      requestShutdown: () => {
        setTimeout(() => {
          process.exit(0);
        }, 50).unref?.();
      },
      scheduleOpenFileSnapshot,
      takeHeapSnapshot,
      log: (...args: unknown[]) => console.log(...args),
    },
    { id, method, params },
  );
  if (dispatched) return dispatched;

  // ── TextMate grammar serving ──────────────────────────────────────
  if (method === "vscode.textmate.grammars.list") {
    const grammars = listTextmateGrammars({
      getExtensions: () => wb.getExtensions?.() ?? [],
      resolvePath: (basePath: string, relativePath: string) =>
        path.resolve(basePath, relativePath),
      readTextFile: (filePath: string) => fs.readFile(filePath, "utf8"),
      log: (...args: unknown[]) => console.log(...args),
    });
    return { jsonrpc: "2.0", id, result: { ok: true, grammars } };
  }

  if (method === "vscode.textmate.grammars.load") {
    const p = isRecord(params) ? params : {};
    const grammarId = typeof p.id === "string" ? p.id : null;
    if (!grammarId) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required param: id" },
      };
    }
    const loaded = await loadTextmateGrammar(
      {
        getExtensions: () => wb.getExtensions?.() ?? [],
        resolvePath: (basePath: string, relativePath: string) =>
          path.resolve(basePath, relativePath),
        readTextFile: (filePath: string) => fs.readFile(filePath, "utf8"),
        log: (...args: unknown[]) => console.log(...args),
      },
      grammarId,
    );
    if (!loaded.ok) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: loaded.error },
      };
    }
    return { jsonrpc: "2.0", id, result: loaded };
  }

  // Placeholder: next step will implement connect/bootstrap and high-level calls
  // like vscode.symbols/vscode.hover/vscode.openFile/etc.
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

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
          "  /wba_ws/socket.io /wba   (editor-facing WBA Socket.IO RPC/event stream)",
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

    if (
      req.method === "GET" &&
      url.pathname === "/webview/runtime/messagepack-codec.mjs"
    ) {
      const codec = await fs.readFile(
        new URL("../protocol/messagepack-codec.mjs", import.meta.url),
      );
      return bodyResponse(
        res,
        200,
        codec,
        "text/javascript; charset=utf-8",
      );
    }

    if (
      req.method === "GET" &&
      url.pathname === "/webview/runtime/socket.io.min.js"
    ) {
      const socketIoClient = await fs.readFile(
        new URL(
          "../../../../vendor/node_socketio/node_modules/socket.io/client-dist/socket.io.min.js",
          import.meta.url,
        ),
      );
      return bodyResponse(
        res,
        200,
        socketIoClient,
        "application/javascript; charset=utf-8",
      );
    }

    if (req.method === "GET" && url.pathname.startsWith("/webview/")) {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length >= 6 && segments[1] === "resource") {
        const resource = await wb.webviewResource(
          "",
          segments[2] ?? "",
          segments[3] ?? "",
          segments[4] ?? "",
          segments.slice(5).join("/"),
        );
        return await sendWebviewResourceResponse(req, res, resource);
      }
      const surfaceId = decodeURIComponent(segments[1] ?? "");
      if (segments.length === 2) {
        return bodyResponse(
          res,
          200,
          wb.webviewWrapperHtml(surfaceId),
          "text/html; charset=utf-8",
          {
            "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-src 'self'",
          },
        );
      }
      if (segments.length === 3 && segments[2] === "document") {
        const requestedOrigin = httpOrigin(url.searchParams.get("resourceOrigin"));
        const wrapperOrigin = httpOrigin(req.headers.referer);
        if (!requestedOrigin || requestedOrigin !== wrapperOrigin) {
          return textResponse(
            res,
            400,
            "Extension document resource origin did not match its wrapper.",
          );
        }
        return bodyResponse(
          res,
          200,
          wb.webviewDocumentHtml(
            surfaceId,
            requestedOrigin,
            String(url.searchParams.get("bootstrapToken") ?? "").trim(),
          ),
          "text/html; charset=utf-8",
        );
      }
      if (segments.length >= 6 && segments[2] === "resource") {
        const resource = await wb.webviewResource(
          surfaceId,
          "",
          segments[3] ?? "",
          segments[4] ?? "",
          segments.slice(5).join("/"),
        );
        return await sendWebviewResourceResponse(req, res, resource);
      }
    }

    if (req.method === "POST" && url.pathname === "/cmd") {
      const obj = await readJson(req);
      if (obj == null) {
        return jsonResponse(res, 400, {
          ok: false,
          error: "missing JSON body",
        });
      }
      const reply = await handleJsonRpc(obj);
      return jsonResponse(res, 200, reply);
    }

    return textResponse(res, 404, "not found\n");
  } catch (e) {
    return jsonResponse(res, 500, { ok: false, error: errorMessage(e) });
  }
});

editorWbaSocketServer = attachEditorWbaSocket(server, {
  handleJsonRpc,
  nowMs,
  log: (...args: unknown[]) => console.log(...args),
});

server.listen(PORT, HOST, () => {
  // Startup beacon MUST go to stdout (not stderr) for the shellspec stdout_regex readiness probe.
  process.stdout.write(
    encodeStartupBeaconLine({
      type: "adapter/start",
      ts_ms: nowMs(),
      listen: `http://${HOST}:${PORT}`,
      config: state.config,
    }),
  );
});

// ── stdio JSON-RPC transport ────────────────────────────────────────
// Allows the Python worker (editor_ws.py) to call handleJsonRpc over
// a pipe instead of HTTP, eliminating a network hop.
// Protocol: one JSON object per line on stdin → <<<RPC>>> {json}\n on stdout.
// Non-RPC output (console.log, etc.) is unchanged — Python splits on prefix.

const _stdinRl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

_stdinRl.on("line", async (line: string) => {
  const parsed = parseStdioJsonLine(line);
  if (!parsed.ok) {
    if (parsed.errorReply) {
      process.stdout.write(encodeRpcReplyLine(parsed.errorReply));
    }
    return;
  }
  const msg = parsed.value;
  try {
    const reply = await handleJsonRpc(msg);
    if (reply && reply.id != null) {
      process.stdout.write(encodeRpcReplyLine(reply));
    }
  } catch (e) {
    const message = asJsonRpcEnvelope(msg);
    const err = buildJsonRpcErrorReply(
      message.id ?? null,
      -32000,
      errorMessage(e),
    );
    process.stdout.write(encodeRpcReplyLine(err));
  }
});

_stdinRl.on("close", () => {
  // stdin closed — parent process gone. Graceful shutdown.
  setTimeout(() => process.exit(0), 100).unref?.();
});
