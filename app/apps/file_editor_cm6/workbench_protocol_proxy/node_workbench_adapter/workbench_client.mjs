import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { VSBuffer } from "./vscode_oss_runtime/base/common/buffer.mjs";
import { NodeSocketFactory } from "./vscode_oss_runtime/platform/remote/browser/browserSocketFactory.mjs";
import { ConnectionType, connectToRemoteAgent, createNoopSignService } from "./vscode_oss_runtime/platform/remote/common/remoteAgentConnection.mjs";
import { IpcPromiseClient } from "./vscode_oss_runtime/base/parts/ipc/common/ipc.mjs";

const DEFAULT_CODE_SERVER_HTTP = process.env.TE2_CODE_SERVER_HTTP ?? "http://127.0.0.1:18180";
const DEFAULT_REMOTE_AUTHORITY = process.env.TE2_REMOTE_AUTHORITY ?? "localhost:18180";
const DEBUG_METRICS = String(process.env.TE2_DEBUG_METRICS || "") === "1";
const INIT_SIZE_PROFILE = String(process.env.TE2_INIT_SIZE_PROFILE || "") === "1";
const INIT_SIZE_MAX_ITEMS = Number(process.env.TE2_INIT_SIZE_MAX_ITEMS ?? "500");
const EXT_EXCLUDE_IDS = String(process.env.TE2_EXT_EXCLUDE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const REPLY_DROP_METHODS = new Set(
  String(process.env.TE2_REPLY_DROP_METHODS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const REPLY_EMPTY_METHODS = new Set(
  String(process.env.TE2_REPLY_EMPTY_METHODS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const REPLY_NULL_METHODS = new Set(
  String(process.env.TE2_REPLY_NULL_METHODS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const PARSE_ALL_ARGS = String(process.env.TE2_PARSE_ALL_ARGS || "") === "1";
const PARSE_ARGS_ONLY_METHODS = new Set([
  // Provider registration + minimal main-thread contract methods.
  "$registerHoverProvider",
  "$registerDocumentSymbolProvider",
  "$registerCompletionsProvider",
  "$registerDocumentLinkProvider",
  "$registerCodeActionSupport",
  "$registerCodeLensesProvider",
  "$registerFoldingRangeProvider",
  "$registerSignatureHelpProvider",
  "$registerDefinitionProvider",
  "$registerTypeDefinitionProvider",
  "$registerImplementationProvider",
  "$registerReferenceProvider",
  "$registerWorkspaceSymbolProvider",
  "$registerRenameProvider",
  "$registerDocumentFormattingSupport",
  "$registerDocumentRangeFormattingSupport",
  "$registerOnTypeFormattingSupport",

  "$getInitialState",
  "$checkExists",
  "$requestWorkspaceTrust",
  "$initializeExtensionStorage",
  "$registerLogger",

  // Keep diagnostics/hover requests parseable when we need them later.
  "$changeMany",
  "$provideHover",
  "$provideDocumentSymbols",
]);
for (const s of String(process.env.TE2_PARSE_ARGS_ONLY_METHODS || "").split(",")) {
  const v = s.trim();
  if (v) PARSE_ARGS_ONLY_METHODS.add(v);
}

const SKIP_ARGS_PARSE_METHODS = new Set();
for (const s of String(process.env.TE2_SKIP_ARGS_PARSE_METHODS || "").split(",")) {
  const v = s.trim();
  if (v) SKIP_ARGS_PARSE_METHODS.add(v);
}

function _shouldParseArgsForMethod(method) {
  if (PARSE_ALL_ARGS) return true;
  if (SKIP_ARGS_PARSE_METHODS.has(method)) return false;
  return PARSE_ARGS_ONLY_METHODS.has(method);
}
const MAX_JSON_BYTES = Number(process.env.TE2_MAX_JSON_BYTES ?? String(8 * 1024 * 1024));
const SPAN_TRACE_ENABLE = String(process.env.TE2_SPAN_TRACE || "") === "1";
const SPAN_TRACE_MAX = Number(process.env.TE2_SPAN_TRACE_MAX ?? "200");
const SPAN_TRACE_MIN_MS = Number(process.env.TE2_SPAN_TRACE_MIN_MS ?? "5");
let _spanTraceRemaining = SPAN_TRACE_MAX;

const EXT_MSG_TRACE = String(process.env.TE2_EXT_MSG_TRACE || "") === "1";
const EXT_MSG_TRACE_EVERY = Number(process.env.TE2_EXT_MSG_TRACE_EVERY ?? "100");
const EXT_MSG_TRACE_MAX = Number(process.env.TE2_EXT_MSG_TRACE_MAX ?? "2000");

// Derived from a real code-server workbench session trace. This is used to bootstrap the
// remote extension host with a language id universe so onLanguage:* activation works.
const BOOTSTRAP_LANGUAGE_IDS = [
  "plaintext",
  "code-text-binary",
  "scminput",
  "Log",
  "log",
  "bat",
  "clojure",
  "coffeescript",
  "jsonc",
  "json",
  "c",
  "cpp",
  "cuda-cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "dotenv",
  "ignore",
  "fsharp",
  "git-commit",
  "git-rebase",
  "go",
  "groovy",
  "handlebars",
  "hlsl",
  "html",
  "ini",
  "properties",
  "java",
  "javascriptreact",
  "javascript",
  "jsx-tags",
  "jsonl",
  "snippets",
  "julia",
  "juliamarkdown",
  "tex",
  "latex",
  "bibtex",
  "cpp_embedded_latex",
  "markdown_latex_combined",
  "less",
  "lua",
  "makefile",
  "markdown",
  "markdown-math",
  "wat",
  "objective-c",
  "objective-cpp",
  "perl",
  "raku",
  "php",
  "powershell",
  "prompt",
  "instructions",
  "chatagent",
  "jade",
  "python",
  "r",
  "razor",
  "restructuredtext",
  "ruby",
  "rust",
  "scss",
  "search-result",
  "shaderlab",
  "shellscript",
  "sql",
  "swift",
  "typescript",
  "typescriptreact",
  "vb",
  "xml",
  "xsl",
  "dockercompose",
  "yaml",
  "jinja",
  "pip-requirements",
  "toml",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred, { timeoutMs = 8000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (pred()) return true;
    } catch {}
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return false;
}

function memSnapshot() {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heap_total: m.heapTotal,
    heap_used: m.heapUsed,
    external: m.external,
    array_buffers: m.arrayBuffers ?? 0,
  };
}

function logMetrics(type, data) {
  if (!DEBUG_METRICS) return;
  try {
    console.log(JSON.stringify({ type, ts_ms: Date.now(), ...data }));
  } catch {}
}

function spanTrace(name, fn) {
  if (!SPAN_TRACE_ENABLE || _spanTraceRemaining <= 0) return fn();
  const start = Date.now();
  let ok = false;
  try {
    const out = fn();
    ok = true;
    return out;
  } finally {
    const dur = Date.now() - start;
    if (dur >= SPAN_TRACE_MIN_MS) {
      _spanTraceRemaining -= 1;
      try {
        console.log(
          JSON.stringify({
            type: "span",
            ts_ms: Date.now(),
            name,
            dur_ms: dur,
            ok,
            mem: memSnapshot(),
          })
        );
      } catch {}
    }
  }
}

async function spanTraceAsync(name, fn) {
  if (!SPAN_TRACE_ENABLE || _spanTraceRemaining <= 0) return await fn();
  const start = Date.now();
  try {
    const out = await fn();
    const dur = Date.now() - start;
    if (dur >= SPAN_TRACE_MIN_MS) {
      _spanTraceRemaining -= 1;
      try {
        console.log(JSON.stringify({ type: "span", ts_ms: Date.now(), name, dur_ms: dur, ok: true, mem: memSnapshot() }));
      } catch {}
    }
    return out;
  } catch (e) {
    const dur = Date.now() - start;
    if (dur >= SPAN_TRACE_MIN_MS) {
      _spanTraceRemaining -= 1;
      try {
        console.log(JSON.stringify({ type: "span", ts_ms: Date.now(), name, dur_ms: dur, ok: false, err: String(e?.message ?? e), mem: memSnapshot() }));
      } catch {}
    }
    throw e;
  }
}

function _shouldSkipSize(obj, maxItems) {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.length > maxItems;
  return Object.keys(obj).length > maxItems;
}

function _jsonSizeOrSkip(obj, maxItems) {
  if (!INIT_SIZE_PROFILE) return { skipped: true };
  if (_shouldSkipSize(obj, maxItems)) return { skipped: true, reason: "too_many_items" };
  try {
    const s = JSON.stringify(obj);
    return { size: s.length };
  } catch (e) {
    return { skipped: true, reason: "stringify_error" };
  }
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function writeVqlUnsigned(n) {
  let v = n >>> 0;
  const bytes = [];
  while (true) {
    let b = v & 0x7f;
    v = v >>> 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
    if (v === 0) break;
  }
  return Buffer.from(bytes);
}

function encodeMgmtValue(v) {
  // Subset used by VS Code IPC:
  // 0 undefined
  // 1 string (vql len + bytes)
  // 4 array (vql length + values)
  // 5 object (vql len + json bytes)
  // 6 int (vql)
  if (v === undefined || v === null) return Buffer.from([0]);
  if (typeof v === "string") {
    const s = Buffer.from(v, "utf8");
    return Buffer.concat([Buffer.from([1]), writeVqlUnsigned(s.length), s]);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Buffer.concat([Buffer.from([6]), writeVqlUnsigned(v | 0)]);
  }
  if (Array.isArray(v)) {
    const parts = [Buffer.from([4]), writeVqlUnsigned(v.length)];
    for (const x of v) parts.push(encodeMgmtValue(x));
    return Buffer.concat(parts);
  }
  if (typeof v === "object") {
    const raw = Buffer.from(JSON.stringify(v), "utf8");
    return Buffer.concat([Buffer.from([5]), writeVqlUnsigned(raw.length), raw]);
  }
  const raw = Buffer.from(JSON.stringify(v), "utf8");
  return Buffer.concat([Buffer.from([5]), writeVqlUnsigned(raw.length), raw]);
}

function encodeMgmtMessage(header, body) {
  return Buffer.concat([encodeMgmtValue(header), encodeMgmtValue(body)]);
}

function encodeExtRequestJsonArgs({ req, rpcId, method, args, cancellable }) {
  const t = cancellable ? 2 : 1;
  const methodB = Buffer.from(method, "utf8");
  const argsB = Buffer.from(JSON.stringify(args ?? []), "utf8");
  if (methodB.length > 255) throw new Error("method too long");
  return Buffer.concat([
    Buffer.from([t]),
    u32be(req),
    Buffer.from([rpcId & 0xff]),
    Buffer.from([methodB.length]),
    methodB,
    u32be(argsB.length),
    argsB,
  ]);
}

function encodeExtRequestMixedArgs({ req, rpcId, method, args, cancellable }) {
  const t = cancellable ? 4 : 3;
  const methodB = Buffer.from(method, "utf8");
  if (methodB.length > 255) throw new Error("method too long");
  const a = Array.isArray(args) ? args : [];
  const parts = [
    Buffer.from([t]),
    u32be(req),
    Buffer.from([rpcId & 0xff]),
    Buffer.from([methodB.length]),
    methodB,
    u32be(a.length),
  ];
  for (const v of a) {
    if (v === null || typeof v === "undefined") {
      parts.push(Buffer.from([4])); // null/undefined
      continue;
    }
    if (typeof v === "string") {
      const b = Buffer.from(v, "utf8");
      parts.push(Buffer.from([1]), u32be(b.length), b);
      continue;
    }
    // everything else: JSON
    const raw = Buffer.from(JSON.stringify(v), "utf8");
    parts.push(Buffer.from([2]), u32be(raw.length), raw);
  }
  return Buffer.concat(parts);
}

function encodeExtReplyOkEmpty(req) {
  return Buffer.concat([Buffer.from([7]), u32be(req)]);
}

function encodeExtAck(req) {
  return Buffer.concat([Buffer.from([5]), u32be(req)]);
}

function encodeExtReplyOkJson(req, result) {
  const jsonB = Buffer.from(JSON.stringify(result ?? null), "utf8");
  return Buffer.concat([Buffer.from([9]), u32be(req), u32be(jsonB.length), jsonB]);
}

function decodeExtHostRpc(payload) {
  if (!payload || payload.length < 5) return { kind: "ext", error: "short" };
  const msgType = payload[0];
  const req = payload.readUInt32BE(1);
  let off = 5;

  const readU8 = () => payload[off++];
  const readU32 = () => {
    const v = payload.readUInt32BE(off);
    off += 4;
    return v >>> 0;
  };
  const readBytes = (n) => {
    const b = payload.subarray(off, off + n);
    off += n;
    return b;
  };
  const readShortString = () => {
    const ln = readU8();
    return readBytes(ln).toString("utf8");
  };
  const readLongString = () => {
    const ln = readU32();
    return readBytes(ln).toString("utf8");
  };
  const skipLongString = () => {
    const ln = readU32();
    readBytes(ln);
    return ln >>> 0;
  };
  const readMixedArray = () => {
    const count = readU32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const argType = readU8();
      if (argType === 1) out.push(readLongString()); // string
      else if (argType === 2) out.push(JSON.parse(readLongString() || "null")); // object json
      else if (argType === 3) {
        const bufCount = readU32();
        const raw = readLongString();
        for (let j = 0; j < bufCount; j++) {
          const bln = readU32();
          readBytes(bln);
        }
        try {
          out.push({ __json_with_buffers__: JSON.parse(raw || "null"), buffers: bufCount });
        } catch {
          out.push({ __json_with_buffers_parse_error__: true, buffers: bufCount });
        }
      } else if (argType === 4) out.push(null);
      else out.push({ __unknown_arg_type__: argType });
    }
    return out;
  };
  const skipMixedArray = () => {
    const count = readU32();
    let totalJsonBytes = 0;
    let totalStringBytes = 0;
    let totalBuffers = 0;
    for (let i = 0; i < count; i++) {
      const argType = readU8();
      if (argType === 1) {
        const ln = readU32();
        readBytes(ln);
        totalStringBytes += ln;
        continue;
      }
      if (argType === 2) {
        const ln = readU32();
        readBytes(ln);
        totalJsonBytes += ln;
        continue;
      }
      if (argType === 3) {
        const bufCount = readU32();
        const ln = readU32();
        readBytes(ln);
        totalJsonBytes += ln;
        for (let j = 0; j < bufCount; j++) {
          const bln = readU32();
          readBytes(bln);
          totalBuffers += 1;
        }
        continue;
      }
      if (argType === 4) continue;
      // unknown: can't reliably skip, but do nothing (will likely fail later)
    }
    return { count, totalJsonBytes, totalStringBytes, totalBuffers };
  };

  try {
    if (msgType === 1 || msgType === 2) {
      const rpcId = readU8();
      const method = readShortString();
      if (!_shouldParseArgsForMethod(method)) {
        const argsRawLen = skipLongString();
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          argsRawLen,
          cancellable: msgType === 2,
          skippedArgsParse: true,
        };
      }
      const argsRawLen = readU32();
      if (MAX_JSON_BYTES > 0 && argsRawLen > MAX_JSON_BYTES) {
        readBytes(argsRawLen);
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          argsRawLen,
          cancellable: msgType === 2,
          skippedArgsParse: true,
          skipReason: "too_large",
        };
      }
      const argsRaw = readBytes(argsRawLen).toString("utf8");
      const args = argsRaw ? JSON.parse(argsRaw) : [];
      return { kind: "ext", type: msgType, req, rpcId, method, args, argsRawLen, cancellable: msgType === 2 };
    }
    if (msgType === 3 || msgType === 4) {
      const rpcId = readU8();
      const method = readShortString();
      if (!_shouldParseArgsForMethod(method)) {
        const meta = skipMixedArray();
        return {
          kind: "ext",
          type: msgType,
          req,
          rpcId,
          method,
          args: [],
          cancellable: msgType === 4,
          skippedArgsParse: true,
          argsMeta: { encoding: "mixed", ...meta },
        };
      }
      const args = readMixedArray();
      return { kind: "ext", type: msgType, req, rpcId, method, args, cancellable: msgType === 4 };
    }
    if (msgType === 9) {
      const resLen = readU32();
      if (MAX_JSON_BYTES > 0 && resLen > MAX_JSON_BYTES) {
        readBytes(resLen);
        return { kind: "ext", type: msgType, req, skippedResultParse: true, resultRawLen: resLen, skipReason: "too_large" };
      }
      const resRaw = readBytes(resLen).toString("utf8");
      return { kind: "ext", type: msgType, req, result: resRaw ? JSON.parse(resRaw) : null };
    }
    if (msgType === 11) {
      const errLen = readU32();
      if (MAX_JSON_BYTES > 0 && errLen > MAX_JSON_BYTES) {
        readBytes(errLen);
        return { kind: "ext", type: msgType, req, skippedErrorParse: true, errorRawLen: errLen, skipReason: "too_large" };
      }
      const errRaw = readBytes(errLen).toString("utf8");
      return { kind: "ext", type: msgType, req, error: errRaw ? JSON.parse(errRaw) : null };
    }
    return { kind: "ext", type: msgType, req };
  } catch (e) {
    return { kind: "ext", type: msgType, req, error: `decode_fail:${String(e?.message ?? e)}` };
  }
}

export class WorkbenchClient {
  constructor({ onEvent } = {}) {
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.mgmt = null; // { protocol }
    this.ext = null; // { protocol }
    this._mgmtIpc = null;
    this._connecting = false;
    this._pendingExt = new Map(); // req -> {resolve,reject}
    this._signService = createNoopSignService();
    this._debugExtReqSeen = 0;
    this._debugExtReplySeen = 0;
    this._debugMainThreadReplySeen = 0;
    this._nextExtReqId = 1;
    this._extHandshake = { readySeen: false, initSent: false, initialized: false };
    this._sentExtMeta = new Map(); // req -> {rpcId, method, ts_ms}
    this._sentExtMetaOrder = [];
    this._nextModelNumber = 1;
    this._useRemote = true;
    this._authority = DEFAULT_REMOTE_AUTHORITY;
    this._productVersion = null;
    this._metricsTimer = null;
    this._extMsgTrace = {
      enabled: EXT_MSG_TRACE,
      seen: 0,
      bytes: 0,
      maxBytes: 0,
      lastTs: 0,
    };
    this._providers = {
      hover: new Map(), // handle -> { handle, selector, label }
      documentSymbols: new Map(), // handle -> { handle, selector, label }
    };
    this.state = {
      connected: false,
      ready: false,
      docSymbolsProviderHandle: null,
      hoverProviderHandle: null,
    };

    if (DEBUG_METRICS) {
      try {
        this._metricsTimer = setInterval(() => {
          logMetrics("metrics/heartbeat", {
            mem: memSnapshot(),
            state: { ...this.state },
            ext_req_seen: this._debugExtReqSeen,
            ext_reply_seen: this._debugExtReplySeen,
            pending_ext: this._pendingExt?.size ?? 0,
            sent_ext_meta: this._sentExtMeta?.size ?? 0,
          });
        }, 1000);
        this._metricsTimer.unref?.();
      } catch {}
    }
  }

  async _loadProductVersionFromAppRoot(envData) {
    if (this._productVersion) return this._productVersion;
    try {
      const appRoot = envData?.appRoot;
      const appRootPath = (appRoot && typeof appRoot === "object") ? (appRoot.path ?? appRoot.fsPath ?? null) : null;
      if (!appRootPath) return null;
      const productPath = path.join(String(appRootPath), "product.json");
      const raw = await fs.readFile(productPath, "utf8");
      const obj = JSON.parse(raw);
      const v = (obj && typeof obj === "object") ? obj.version : null;
      if (typeof v === "string" && v.trim()) {
        this._productVersion = v.trim();
        return this._productVersion;
      }
    } catch {}
    return null;
  }

  _allocExtReqId() {
    const id = this._nextExtReqId >>> 0;
    this._nextExtReqId = (this._nextExtReqId + 1) >>> 0;
    return id === 0 ? this._allocExtReqId() : id;
  }

  _sendExt(rpcId, method, args, cancellable = false) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({ req, rpcId, method, args, cancellable });
    this.ext.protocol.send(VSBuffer.wrap(payload));
    this._sentExtMeta.set(req, { rpcId, method, ts_ms: Date.now() });
    this._sentExtMetaOrder.push(req);
    while (this._sentExtMetaOrder.length > 500) {
      const oldest = this._sentExtMetaOrder.shift();
      this._sentExtMeta.delete(oldest);
    }
    try {
      this.onEvent({ type: "ext/send", ts_ms: Date.now(), req, rpcId, method });
    } catch {}
    return req;
  }

  _sendExtMixed(rpcId, method, args, cancellable = false) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const req = this._allocExtReqId();
    const payload = encodeExtRequestMixedArgs({ req, rpcId, method, args, cancellable });
    this.ext.protocol.send(VSBuffer.wrap(payload));
    this._sentExtMeta.set(req, { rpcId, method, ts_ms: Date.now() });
    this._sentExtMetaOrder.push(req);
    while (this._sentExtMetaOrder.length > 500) {
      const oldest = this._sentExtMetaOrder.shift();
      this._sentExtMeta.delete(oldest);
    }
    try {
      this.onEvent({ type: "ext/send", ts_ms: Date.now(), req, rpcId, method, encoding: "mixed" });
    } catch {}
    return req;
  }

  status() {
    return { ...this.state };
  }

  async _discoverServerRootPath(httpBase, folder) {
    const url = new URL("/", httpBase);
    if (folder) url.searchParams.set("folder", folder);
    const resp = await fetch(url, { headers: { accept: "text/html", "accept-encoding": "identity" } });
    const text = await resp.text();
    const m = text.match(/(stable-[0-9a-f]{40})/);
    if (!m) return "/";
    return `/${m[1]}`;
  }

  _commitFromServerRootPath(serverRootPath) {
    const m = String(serverRootPath).match(/^\/stable-([0-9a-f]{40})$/);
    return m ? m[1] : null;
  }

  _buildExtensionsSnapshot(scannedExtensions) {
    const includeBuiltin = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase() === "1";
    const base = Array.isArray(scannedExtensions)
      ? scannedExtensions.filter((ext) => includeBuiltin || ext?.isBuiltin === false)
      : [];
    const all = EXT_EXCLUDE_IDS.length
      ? base.filter((ext) => {
          const ident = this._extensionIdentifierFrom(ext) ?? "";
          return !EXT_EXCLUDE_IDS.includes(String(ident));
        })
      : base;
    const activationEvents = {};
    const myExtensions = [];
    const seenMy = new Set();
    for (const ext of all) {
      const ident = this._extensionIdentifierFrom(ext);
      const key = ident ?? null;
      if (!key) continue;
      const ev = Array.isArray(ext?.activationEvents) ? ext.activationEvents : [];
      activationEvents[String(key)] = ev;
      const eligible = includeBuiltin || ext?.isBuiltin === false;
      if (ident && eligible) {
        const dedupeKey = String(ident).toLowerCase();
        if (!seenMy.has(dedupeKey)) {
          seenMy.add(dedupeKey);
          myExtensions.push(ident);
        }
      }
    }
    return { versionId: 1, allExtensions: all, activationEvents, myExtensions };
  }

  _sanitizeExtensionForInit(ext, authority) {
    if (!ext || typeof ext !== "object") return null;

    // Keep only the fields that ExtensionHost init actually needs (lean JSON-only object).
    // IMPORTANT: strip non-enumerable/symbol/buffer fields that might exist on objects coming
    // from the mgmt scan RPC (those can blow up memory even if JSON.stringify stays small).
    const identifier = this._extensionIdentifierFrom(ext);
    const manifest = (ext.packageJSON && typeof ext.packageJSON === "object") ? ext.packageJSON : ext;
    const name = manifest?.name;
    const publisher = manifest?.publisher;
    const version = manifest?.version;
    const engines = manifest?.engines;
    const main = typeof manifest?.main === "string" ? manifest.main : undefined;
    const browser = typeof manifest?.browser === "string" ? manifest.browser : undefined;
    const activationEvents = Array.isArray(manifest?.activationEvents) ? manifest.activationEvents : (Array.isArray(ext?.activationEvents) ? ext.activationEvents : []);

    // Location normalization: prefer explicit extensionLocation if present.
    const loc = ext.extensionLocation ?? ext.location ?? manifest?.extensionLocation ?? null;
    const locPath = (loc && typeof loc === "object") ? (loc.path ?? loc.fsPath ?? null) : null;
    const locScheme = (loc && typeof loc === "object") ? (loc.scheme ?? null) : null;
    const locAuthority = (loc && typeof loc === "object") ? (loc.authority ?? null) : null;

    let extensionLocation = null;
    if (authority) {
      const p = (locPath && typeof locPath === "string") ? locPath : null;
      if (p) {
        extensionLocation = { $mid: 1, scheme: "vscode-remote", authority, path: p, query: loc?.query, fragment: loc?.fragment };
      }
    } else if (loc && typeof loc === "object" && typeof locScheme === "string" && typeof locPath === "string") {
      extensionLocation = { $mid: 1, scheme: locScheme, authority: locAuthority ?? undefined, path: locPath, query: loc?.query, fragment: loc?.fragment };
    }

    const id = ext?.id || ext?.extensionId || (publisher && name ? `${publisher}.${name}` : null) || identifier;
    const targetPlatform = ext?.metadata?.targetPlatform || ext?.targetPlatform || "unknown";

    const includeContributes = String(process.env.TE2_EXT_INCLUDE_CONTRIB || "") === "1";
    const contributes = includeContributes ? (manifest?.contributes ?? undefined) : undefined;

    return {
      // core manifest identity
      name,
      publisher,
      version,
      engines,
      main,
      browser,
      activationEvents,
      contributes,
      // VS Code extension shape fields used by init data + scanner outputs
      id,
      identifier: {
        // Some code paths expect `{value,_lower}` while others expect `{id,uuid}`.
        value: String(id),
        _lower: String(id).toLowerCase(),
        id: String(id),
        uuid: ext?.identifier?.uuid ?? ext?.uuid ?? undefined,
      },
      uuid: ext?.identifier?.uuid ?? ext?.uuid ?? undefined,
      isBuiltin: Boolean(ext?.isBuiltin),
      isUserBuiltin: Boolean(ext?.isUserBuiltin),
      isUnderDevelopment: Boolean(ext?.isUnderDevelopment),
      publisherDisplayName: ext?.metadata?.publisherDisplayName ?? ext?.publisherDisplayName,
      targetPlatform,
      extensionLocation,
      preRelease: Boolean(ext?.metadata?.preRelease ?? ext?.preRelease),
      // keep a few optional fields sometimes used by activation logic
      extensionDependencies: Array.isArray(manifest?.extensionDependencies) ? manifest.extensionDependencies : undefined,
      extensionPack: Array.isArray(manifest?.extensionPack) ? manifest.extensionPack : undefined,
    };
  }

  async _scanExtensionsFromDisk(authority) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const jsonPath =
      process.env.TE2_EXTENSIONS_JSON ||
      (home ? path.join(home, ".config/code-server/extensions/extensions.json") : null);
    if (!jsonPath) throw new Error("No HOME for extensions.json");
    const raw = await fs.readFile(jsonPath, "utf8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    const out = [];
    let pkgCount = 0;
    let totalPkgBytes = 0;
    let maxPkgBytes = 0;
    let maxPkgPath = null;
    let totalActivationEvents = 0;
    let totalContribKeys = 0;
    for (const entry of entries) {
      try {
        const loc = entry?.location;
        const locPath = loc?.path ?? loc?.fsPath;
        if (!locPath) continue;
        const pkgPath = path.join(locPath, "package.json");
        const pkgRaw = await fs.readFile(pkgPath, "utf8");
        const pkgBytes = Buffer.byteLength(pkgRaw, "utf8");
        totalPkgBytes += pkgBytes;
        pkgCount += 1;
        if (pkgBytes > maxPkgBytes) {
          maxPkgBytes = pkgBytes;
          maxPkgPath = pkgPath;
        }
        const manifest = JSON.parse(pkgRaw);
        if (Array.isArray(manifest?.activationEvents)) {
          totalActivationEvents += manifest.activationEvents.length;
        }
        if (manifest?.contributes && typeof manifest.contributes === "object") {
          try {
            totalContribKeys += Object.keys(manifest.contributes).length;
          } catch {}
        }
        const rawExt = {
          ...manifest,
          id: entry?.identifier?.id || `${manifest.publisher}.${manifest.name}`,
          identifier: {
            ...(entry?.identifier && typeof entry.identifier === "object" ? entry.identifier : {}),
            // Some extension registry entries omit uuid under `identifier`; in practice it is present
            // under `metadata.id` (see extensions.json). VS Code internals expect `{id,uuid}`.
            uuid: entry?.identifier?.uuid ?? entry?.metadata?.id ?? undefined,
          },
          uuid: entry?.identifier?.uuid ?? entry?.metadata?.id ?? undefined,
          location: loc,
          extensionLocation: loc,
          metadata: entry?.metadata,
          targetPlatform: entry?.targetPlatform,
          isBuiltin: false,
          isUserBuiltin: false,
          isUnderDevelopment: false,
        };
        const sanitized = this._sanitizeExtensionForInit(rawExt, authority);
        if (sanitized) out.push(sanitized);
      } catch {
        // Skip malformed entries.
      }
    }
    logMetrics("metrics/extensions_scan", {
      count: pkgCount,
      total_pkg_bytes: totalPkgBytes,
      max_pkg_bytes: maxPkgBytes,
      max_pkg_path: maxPkgPath,
      total_activation_events: totalActivationEvents,
      total_contrib_keys: totalContribKeys,
      mem: memSnapshot(),
    });
    return out;
  }

  _extensionIdentifierFrom(ext) {
    const ident = ext?.identifier ?? null;
    if (typeof ident === "string") return ident;
    if (ident && typeof ident === "object") {
      if (typeof ident.value === "string") return ident.value;
      if (typeof ident.id === "string") return ident.id;
    }
    const id = ext?.id ?? ext?.extensionId ?? ext?.identifier?.value ?? ext?.identifier?.id ?? null;
    if (typeof id === "string" && id) return id;
    return null;
  }

  _workspaceFromFolder(folder, authority) {
    if (!folder) return null;
    const rootPath = String(folder);
    const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
    const id = crypto.createHash("sha1").update(rootPath).digest("hex").slice(0, 7);
    const configuration = null; // folder workspace (not .code-workspace)
    return { configuration, id, name, transient: false };
  }

  _uriForPath(pathStr, authority) {
    const p = String(pathStr);
    if (this._useRemote) {
      return {
        $mid: 1,
        fsPath: p,
        external: `vscode-remote://${authority}${p}`,
        path: p,
        scheme: "vscode-remote",
        authority,
      };
    }
    return {
      $mid: 1,
      fsPath: p,
      external: `file://${p}`,
      path: p,
      scheme: "file",
    };
  }

  _emptyConfigSection() {
    return { contents: {}, overrides: [], keys: [] };
  }

  _buildConfigurationInitData(folder, authority) {
    const empty = this._emptyConfigSection();

    // Force a deterministic Python LS path for headless mode.
    // `ms-python.python` can provide hover/symbols via Jedi without Pylance, but it requires:
    // - a valid interpreter, and
    // - a non-None language server selection (see atlas msg #674).
    const pythonPathCandidates = [
      String(process.env.TE2_PYTHON_PATH || ""),
      "/data/data/com.termux/files/usr/bin/python",
      "/data/data/com.termux/files/usr/bin/python3",
      "/usr/bin/python3",
      "/usr/bin/python",
    ].map((p) => p.trim()).filter(Boolean);
    let defaultInterpreterPath = "python";
    for (const p of pythonPathCandidates) {
      try {
        if (existsSync(p)) {
          defaultInterpreterPath = p;
          break;
        }
      } catch {}
    }

    const defaults = {
      contents: {
        python: {
          languageServer: "Jedi",
          defaultInterpreterPath,
        },
      },
      overrides: [],
      keys: ["python.languageServer", "python.defaultInterpreterPath"],
    };
    const userRemote = {
      contents: {
        python: {
          languageServer: "Jedi",
          defaultInterpreterPath,
        },
      },
      overrides: [],
      keys: ["python.languageServer", "python.defaultInterpreterPath"],
    };

    const data = {
      defaults,
      policy: empty,
      application: empty,
      userLocal: empty,
      userRemote,
      workspace: empty,
      folders: [],
      configurationScopes: [],
    };
    if (folder) {
      const rootPath = String(folder);
      const folderUri = this._uriForPath(rootPath, authority);
      data.folders = [[folderUri, empty]];
    }
    return data;
  }

  _buildExtHostInitData({ authority, commit, envData, scannedExtensions, folder, useRemote, productVersion }) {
    // Best-effort minimal IExtensionHostInitData, sufficient for remote Extension Host handshake.
    const nowIso = new Date().toISOString();
    const initData = {
      // Some extensions (e.g. ms-pyright.pyright) validate vscode.version and crash if it is "0".
      // Use real VS Code version when available from appRoot/product.json.
      version: (typeof productVersion === "string" && productVersion.trim()) ? productVersion.trim() : "0",
      quality: "stable",
      commit: commit ?? undefined,
      date: nowIso,
      parentPid: Number(envData?.pid ?? 0) || 0,
      environment: {
        isExtensionDevelopmentDebug: false,
        appRoot: envData?.appRoot ?? undefined,
        appName: "code-server",
        appHost: useRemote ? "web" : "node",
        appUriScheme: "code-oss",
        isExtensionTelemetryLoggingOnly: false,
        appLanguage: "en",
        extensionDevelopmentLocationURI: undefined,
        extensionTestsLocationURI: undefined,
        globalStorageHome: envData?.globalStorageHome,
        workspaceStorageHome: envData?.workspaceStorageHome,
        useHostProxy: Boolean(envData?.useHostProxy),
      },
      workspace: this._workspaceFromFolder(folder, authority),
      remote: { isRemote: !!useRemote, authority: useRemote ? authority : undefined, connectionData: null },
      consoleForward: { includeStack: false, logNative: false },
      extensions: this._buildExtensionsSnapshot(scannedExtensions),
      telemetryInfo: {
        sessionId: crypto.randomUUID(),
        machineId: crypto.randomUUID(),
        sqmId: crypto.randomUUID(),
        devDeviceId: crypto.randomUUID(),
        firstSessionDate: nowIso,
        msftInternal: false,
      },
      logLevel: 2, // Info
      loggers: [],
      logsLocation: envData?.extensionHostLogsPath ?? envData?.logsPath,
      autoStart: true,
      uiKind: useRemote ? 2 : 1, // Web vs Desktop/Node
    };
    const extSnap = initData.extensions ?? {};
    logMetrics("metrics/ext_init", {
      all_extensions: Array.isArray(extSnap.allExtensions) ? extSnap.allExtensions.length : 0,
      my_extensions: Array.isArray(extSnap.myExtensions) ? extSnap.myExtensions.length : 0,
      activation_events_keys: extSnap.activationEvents ? Object.keys(extSnap.activationEvents).length : 0,
      mem: memSnapshot(),
    });
    return initData;
  }

  async connect(params = {}) {
    if (this._connecting) throw new Error("already connecting");
    this._connecting = true;
    try {
      const proxyHttp = params.proxyHttp ?? DEFAULT_CODE_SERVER_HTTP;
      const token = params.token ?? "00000000000000000000";
      const folder = params.folder ?? null;
      const authority = params.authority ?? DEFAULT_REMOTE_AUTHORITY;
      const useRemote = params.useRemote ?? (String(process.env.TE2_USE_REMOTE || "1") === "1");
      const serverRootPath = params.serverRootPath ?? (await spanTraceAsync("connect.discoverServerRootPath", () => this._discoverServerRootPath(proxyHttp, folder)));
      const commit = params.commit ?? this._commitFromServerRootPath(serverRootPath);
      const workspaceTrusted = params.workspaceTrusted ?? true;

      this._useRemote = !!useRemote;
      this._authority = authority;

      const proxyUrl = new URL(proxyHttp);
      const wsSchema = proxyUrl.protocol === "https:" ? "wss" : "ws";
      const socketFactory = new NodeSocketFactory({ wsSchema, basePathname: proxyUrl.pathname });
      const connectTo = {
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
      };

      const mgmt = await spanTraceAsync("connect.remoteAgent.mgmt", () => connectToRemoteAgent({
        socketFactory,
        connectTo,
        serverRootPath,
        reconnectionToken: crypto.randomUUID(),
        connectionToken: token,
        commit,
        desiredConnectionType: ConnectionType.Management,
        args: undefined,
        signService: this._signService,
        timeoutMs: 15000,
        debugLabel: `renderer-Management-${crypto.randomUUID().slice(0, 8)}`,
      }));
      this.mgmt = { protocol: mgmt.protocol };

      // Bootstrap mgmt IPC using the same serialization as VS Code IPCClient.
      this._mgmtIpc?.dispose?.();
      this._mgmtIpc = new IpcPromiseClient(this.mgmt.protocol, { remoteAuthority: authority, clientId: "renderer" });
      await spanTraceAsync("connect.mgmtIpc.whenInitialized", () => this._mgmtIpc.whenInitialized(15000));
      let envData = null;
      try {
        if (String(process.env.TE2_SKIP_MGMT_ENV || "") !== "1") {
          envData = await spanTraceAsync("connect.mgmtIpc.getEnvironmentData", () =>
            this._mgmtIpc.call("remoteextensionsenvironment", "getEnvironmentData", { remoteAuthority: authority })
          );
        }
        this.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: true, pid: envData?.pid ?? null });
      } catch (e) {
        this.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }

      let scannedExtensions = [];
      try {
        if (String(process.env.TE2_SKIP_MGMT_SCAN || "") === "1") {
          scannedExtensions = [];
          this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: true, count: 0, source: "skipped" });
        } else {
          const source = String(process.env.TE2_EXTENSIONS_SOURCE || "scan").toLowerCase();
          if (source === "disk") {
            scannedExtensions = await spanTraceAsync("connect.scanExtensions.disk", () => this._scanExtensionsFromDisk(useRemote ? authority : null));
            this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: true, count: Array.isArray(scannedExtensions) ? scannedExtensions.length : null, source: "disk" });
          } else {
            // Mirror VS Code RemoteExtensionsScannerService.scanExtensions() argument order.
            scannedExtensions = await spanTraceAsync("connect.scanExtensions.rpc", () =>
              this._mgmtIpc.call("remoteExtensionsScanner", "scanExtensions", ["en", null, [], null, null])
            );
            const includeBuiltin = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase() === "1";
            if (Array.isArray(scannedExtensions)) {
              scannedExtensions = scannedExtensions.filter((ext) => includeBuiltin || ext?.isBuiltin === false);
            }
            this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: true, count: Array.isArray(scannedExtensions) ? scannedExtensions.length : null, source: "scan" });
          }
        }
      } catch (e) {
        this.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }
      // Always sanitize scanned extensions into a lean JSON-only shape to avoid retaining
      // huge non-enumerable/symbol/buffer fields from the mgmt scan RPC.
      try {
        if (String(process.env.TE2_DEBUG_SCAN_SHAPE || "") === "1" && Array.isArray(scannedExtensions)) {
          const sample = scannedExtensions.slice(0, 5).map((ext) => {
            const id = this._extensionIdentifierFrom(ext) ?? ext?.id ?? ext?.identifier?.id ?? null;
            const loc = ext?.extensionLocation ?? ext?.location ?? ext?.packageJSON?.extensionLocation ?? null;
            return {
              id,
              keys: ext && typeof ext === "object" ? Object.keys(ext).slice(0, 20) : [],
              loc: (loc && typeof loc === "object")
                ? { $mid: loc.$mid ?? null, scheme: loc.scheme ?? null, authority: loc.authority ?? null, path: loc.path ?? null, fsPath: loc.fsPath ?? null }
                : null,
            };
          });
          this.onEvent({ type: "mgmt/scanExtensions_shape", ts_ms: Date.now(), sample });
        }
        const authForLoc = useRemote ? authority : null;
        if (Array.isArray(scannedExtensions)) {
          scannedExtensions = scannedExtensions
            .map((ext) => this._sanitizeExtensionForInit(ext, authForLoc))
            .filter(Boolean);
        } else {
          scannedExtensions = [];
        }
      } catch {
        scannedExtensions = [];
      }
      try {
        if (String(process.env.TE2_SKIP_MGMT_SCAN || "") !== "1") {
          await spanTraceAsync("connect.whenExtensionsReady", () => this._mgmtIpc.call("remoteExtensionsScanner", "whenExtensionsReady", undefined));
          this.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: true });
        }
      } catch (e) {
        this.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: false, error: String(e?.message ?? e) });
      }

      const proxyUri = params.proxyUri ?? `http://${authority}/proxy/{{port}}/`;
      const extArgs = { language: "en", break: false, port: null, env: { VSCODE_PROXY_URI: proxyUri } };

      const workspaceRoot = params.workspaceFolder ?? params.folder ?? folder ?? null;
      const productVersion = await spanTraceAsync("connect.loadProductVersion", () => this._loadProductVersionFromAppRoot(envData));
      const extInitData = spanTrace("connect.buildExtHostInitData", () => this._buildExtHostInitData({
        authority: useRemote ? authority : null,
        commit,
        envData,
        scannedExtensions,
        folder: workspaceRoot,
        useRemote,
        productVersion,
      }));

      const ext = await spanTraceAsync("connect.remoteAgent.ext", () => connectToRemoteAgent({
        socketFactory,
        connectTo,
        serverRootPath,
        reconnectionToken: crypto.randomUUID(),
        connectionToken: token,
        commit,
        desiredConnectionType: ConnectionType.ExtensionHost,
        args: extArgs,
        signService: this._signService,
        timeoutMs: 15000,
        debugLabel: `renderer-ExtensionHost-${crypto.randomUUID().slice(0, 8)}`,
      }));
      this.ext = { protocol: ext.protocol };

      this.state.connected = true;
      this.state.ready = false;
      this.state.docSymbolsProviderHandle = null;
      this.state.hoverProviderHandle = null;
      this._nextExtReqId = 1;
      this._debugExtReqSeen = 0;
      this._extHandshake = { readySeen: false, initSent: false, initialized: false };

      const extHandshakeReady = new Promise((resolve, reject) => {
        const startMs = Date.now();
        const t = setTimeout(() => reject(new Error("ext host handshake timeout")), 60000);
        const d = this.ext.protocol.onMessage((payloadVsBuf) => {
          const b = payloadVsBuf?.buffer;
          if (!b || b.length !== 1) return;
          const v = b[0];
          if (v === 2) {
            this._extHandshake.readySeen = true;
            if (!this._extHandshake.initSent) {
              this._extHandshake.initSent = true;
              this.onEvent({ type: "ext/handshake_ready", ts_ms: Date.now(), after_ms: Date.now() - startMs });
              try {
                logMetrics("metrics/pre_ext_init_send", { mem: memSnapshot() });
                const initJson = spanTrace("connect.JSON.stringify(extInitData)", () => JSON.stringify(extInitData));
                if (INIT_SIZE_PROFILE) {
                  const extSnap = extInitData?.extensions ?? {};
                  logMetrics("metrics/ext_init_size", {
                    init_bytes: initJson.length,
                    env: _jsonSizeOrSkip(extInitData?.environment, INIT_SIZE_MAX_ITEMS),
                    workspace: _jsonSizeOrSkip(extInitData?.workspace, INIT_SIZE_MAX_ITEMS),
                    extensions: {
                      all_len: Array.isArray(extSnap?.allExtensions) ? extSnap.allExtensions.length : 0,
                      my_len: Array.isArray(extSnap?.myExtensions) ? extSnap.myExtensions.length : 0,
                      activation_keys: extSnap?.activationEvents ? Object.keys(extSnap.activationEvents).length : 0,
                      size: _jsonSizeOrSkip(extSnap, INIT_SIZE_MAX_ITEMS),
                    },
                  });
                }
                this.ext?.protocol.send(VSBuffer.fromString(initJson));
                this.onEvent({ type: "ext/handshake_init_sent", ts_ms: Date.now(), bytes: initJson.length });
              } catch (e) {
                clearTimeout(t);
                d.dispose?.();
                reject(e);
              }
            }
          } else if (v === 1) {
            this._extHandshake.initialized = true;
            clearTimeout(t);
            d.dispose?.();
            this.onEvent({ type: "ext/handshake_initialized", ts_ms: Date.now(), after_ms: Date.now() - startMs });
            resolve();
          } else if (v === 3) {
            // Terminate
          }
        });
      });

      this.ext.protocol.onMessage((payloadVsBuf) => {
        // Extension Host handshake messages are single-byte payloads (Ready/Initialized/Terminate).
        const b0 = payloadVsBuf?.buffer;
        if (b0 && b0.length === 1) {
          // handled by extHandshakeReady listener (kept separate to keep logic simple)
          return;
        }
        if (!this._extHandshake.initialized) {
          // Ignore any non-handshake payloads until extension host is initialized.
          return;
        }

        if (this._extMsgTrace.enabled && this._extMsgTrace.seen < EXT_MSG_TRACE_MAX) {
          const ln = b0?.length ?? 0;
          this._extMsgTrace.seen += 1;
          this._extMsgTrace.bytes += ln;
          if (ln > this._extMsgTrace.maxBytes) this._extMsgTrace.maxBytes = ln;
          if (EXT_MSG_TRACE_EVERY > 0 && (this._extMsgTrace.seen % EXT_MSG_TRACE_EVERY) === 0) {
            try {
              console.log(
                JSON.stringify({
                  type: "ext/msg_trace",
                  ts_ms: Date.now(),
                  seen: this._extMsgTrace.seen,
                  total_bytes: this._extMsgTrace.bytes,
                  max_bytes: this._extMsgTrace.maxBytes,
                  last_len: ln,
                  mem: memSnapshot(),
                })
              );
            } catch {}
          }
        }
        const msg = decodeExtHostRpc(payloadVsBuf.buffer);
        if (msg.kind !== "ext") return;
        if (this._extMsgTrace.enabled && msg?.error && this._extMsgTrace.seen < EXT_MSG_TRACE_MAX) {
          try {
            console.log(JSON.stringify({ type: "ext/msg_decode_error", ts_ms: Date.now(), error: msg.error, req: msg.req ?? null, msgType: msg.type ?? null }));
          } catch {}
        }

        // server->client request
        if (msg.type === 1 || msg.type === 2 || msg.type === 3 || msg.type === 4) {
          if (this._extMsgTrace.enabled && this._extMsgTrace.seen < EXT_MSG_TRACE_MAX) {
            // Log only the metadata; avoid args blobs.
            const meta = { type: "ext/request_meta", ts_ms: Date.now(), req: msg.req, rpcId: msg.rpcId, method: msg.method, encoding: (msg.type === 3 || msg.type === 4) ? "mixed" : "json" };
            if (typeof msg.argsRawLen === "number") meta.argsRawLen = msg.argsRawLen;
            if (msg.argsMeta && typeof msg.argsMeta === "object") meta.argsMeta = msg.argsMeta;
            if (msg.skipReason) meta.skipReason = msg.skipReason;
            try { console.log(JSON.stringify(meta)); } catch {}
          }
          if (this._debugExtReqSeen < 200) {
            this._debugExtReqSeen++;
            const ev = { type: "ext/request", ts_ms: Date.now(), req: msg.req, rpcId: msg.rpcId, method: msg.method };
            const logArgsMethods = new Set([
              "$registerLogger",
              "$checkExists",
              "$onWillActivateExtension",
              "$onDidActivateExtension",
              "$onExtensionActivationError",
              "$publicLog2",
              "$initializeExtensionStorage",
              "$registerDocumentSymbolProvider",
              "$registerHoverProvider",
            ]);
            if (logArgsMethods.has(msg.method)) {
              ev.args = msg.args;
            }
            this.onEvent(ev);
          }

          // RPCProtocol expects an immediate ACK for every request.
          try {
            this.ext?.protocol.send(VSBuffer.wrap(encodeExtAck(msg.req)));
          } catch {}

          // Learn provider handles.
          if (msg.method === "$registerDocumentSymbolProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const label = (typeof msg.args[2] === "string") ? msg.args[2] : null;
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              try {
                this._providers.documentSymbols.set(handle, { handle, selector, label });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language === "python") {
                  this.state.docSymbolsProviderHandle = handle;
                  this.state.ready = true;
                  this.onEvent({ type: "provider/documentSymbols", ts_ms: Date.now(), handle, language: "python" });
                  break;
                }
              }
            }
          }
          if (msg.method === "$registerHoverProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const label = (typeof msg.args[2] === "string") ? msg.args[2] : null;
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              try {
                this._providers.hover.set(handle, { handle, selector, label });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language === "python") {
                  this.state.hoverProviderHandle = handle;
                  this.state.ready = true;
                  this.onEvent({ type: "provider/hover", ts_ms: Date.now(), handle, language: "python" });
                  break;
                }
              }
            }
          }

          // Diagnostics.
          if (msg.method === "$changeMany") {
            const argsSummary = Array.isArray(msg.args) ? `args.length=${msg.args.length}` : `args=${typeof msg.args}`;
            const pairs = Array.isArray(msg.args) && Array.isArray(msg.args[1]) ? msg.args[1] : [];
            const markerCounts = pairs.map(p => Array.isArray(p) && Array.isArray(p[1]) ? p[1].length : '?');
            console.log(`[wb_client] $changeMany owner=${msg.args?.[0]} pairs=${pairs.length} markerCounts=[${markerCounts.join(',')}]`);
            if (pairs.length > 0 && Array.isArray(pairs[0]) && pairs[0].length >= 2) {
              const sampleMarkers = Array.isArray(pairs[0][1]) ? pairs[0][1].slice(0, 1) : [];
              if (sampleMarkers.length) console.log(`[wb_client] $changeMany sample marker keys:`, Object.keys(sampleMarkers[0]));
            }
            this.onEvent({ type: "diagnostics/changeMany", ts_ms: Date.now(), args: msg.args });
          }

          // Reply to required calls with correct result shape (based on browser trace).
          if (REPLY_DROP_METHODS.has(msg.method)) {
            this.onEvent({ type: "ext/reply_drop", ts_ms: Date.now(), req: msg.req, method: msg.method });
            return;
          }
          let replyPayload;
          if (REPLY_EMPTY_METHODS.has(msg.method)) {
            replyPayload = encodeExtReplyOkEmpty(msg.req);
          } else if (REPLY_NULL_METHODS.has(msg.method)) {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else if (msg.method === "$getInitialState") {
            replyPayload = encodeExtReplyOkJson(msg.req, { isFocused: true, isActive: true });
          } else if (msg.method === "$checkExists") {
            replyPayload = encodeExtReplyOkJson(msg.req, false);
          } else if (msg.method === "$requestWorkspaceTrust") {
            replyPayload = encodeExtReplyOkJson(msg.req, true);
            try {
              this._sendExt(106, "$onDidGrantWorkspaceTrust", [], false);
            } catch {}
          } else if (msg.method === "$getTools") {
            // The real workbench returns a large list (built-in + extension tools). Empty array is acceptable for our TE2 use-cases.
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$initializeExtensionStorage") {
            // Real workbench returns a JSON string blob of persisted storage keys/values.
            replyPayload = encodeExtReplyOkJson(msg.req, "{}");
          } else if (msg.method === "$startFileSearch") {
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$resolveProxy") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else if (msg.method === "$getPassword") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else {
            replyPayload = encodeExtReplyOkEmpty(msg.req);
          }
          try {
            this.ext?.protocol.send(VSBuffer.wrap(replyPayload));
            if (this._debugMainThreadReplySeen < 80) {
              this._debugMainThreadReplySeen++;
              this.onEvent({
                type: "ext/reply_to_ext",
                ts_ms: Date.now(),
                req: msg.req,
                method: msg.method,
                replyType: replyPayload?.[0] ?? null,
              });
            }
          } catch {}
          return;
        }

        // replies to our requests
        if (msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10 || msg.type === 11 || msg.type === 12) {
          const meta = this._sentExtMeta.get(msg.req);
          if (meta && this._debugExtReplySeen < 50) {
            this._debugExtReplySeen++;
            this._sentExtMeta.delete(msg.req);
            this.onEvent({
              type: "ext/reply",
              ts_ms: Date.now(),
              req: msg.req,
              to: { rpcId: meta.rpcId, method: meta.method },
              replyType: msg.type,
              ok: msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10,
              hasResult: Object.prototype.hasOwnProperty.call(msg, "result"),
              hasError: Object.prototype.hasOwnProperty.call(msg, "error") && msg.error != null,
              error: msg.type === 11 ? msg.error : null,
            });
          }
          const pending = this._pendingExt.get(msg.req);
          if (pending) {
            this._pendingExt.delete(msg.req);
            pending.resolve(msg);
          }
        }
      });

      // Wait for the real Extension Host handshake (Ready -> init JSON -> Initialized).
      await extHandshakeReady;

      // Minimal ExtHost bootstrap (enough to get language providers registered).
      const configInit = spanTrace("connect.buildConfigurationInitData", () => this._buildConfigurationInitData(workspaceRoot, useRemote ? authority : null));
      this._sendExt(80, "$initializeConfiguration", [configInit], false);
      try {
        // In a real workbench session, configuration is then synced via `$acceptConfigurationChanged`.
        // Some extensions (including ms-python.python) appear to rely on this to observe settings.
        this._sendExt(80, "$acceptConfigurationChanged", [configInit, { keys: ["python.languageServer", "python.defaultInterpreterPath"], overrides: [] }], false);
      } catch {}

      // Mirror the browser workbench bootstrap sequence that appears to gate provider registration
      // (e.g. ms-python/python doesn't register hover/symbol providers until these arrive).
      //
      // Based on Go decoder trace: `$acceptProviderInfos`, `$setWordDefinitions`, `$setVisibleChannel`,
      // `$acceptStaticEntries`, `$acceptEditorTabModel`, `$activateByEvent("onLanguage")`, then `$initializeWorkspace`.
      try {
        const providerInfos = [
          // uri.scheme -> capabilities bitmask observed in trace
          ["vscode-log", 1026],
          ["vscode-userdata", 1026],
          ["file", 1042],
          ["tmp", 1026],
          ["vscode-remote", 517150],
          ["http", 3074],
          ["https", 3074],
          ["vscode", 2050],
          ["trustedDomains", 2],
          ["vscode-local-history", 2050],
          ["vscode-chat-response-resource", 19474],
          ["mcp-resource", 19474],
          ["chat-editing-notebook-snapshot-model", 18434],
        ];
        for (const [scheme, caps] of providerInfos) {
          this._sendExt(91, "$acceptProviderInfos", [{ $mid: 1, path: "/dummy", scheme }, caps], false);
        }
      } catch {}
      try {
        const regexSource = "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\$\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)";
        const defs = BOOTSTRAP_LANGUAGE_IDS.map((languageId) => ({ languageId, regexSource, regexFlags: "g" }));
        this._sendExt(94, "$setWordDefinitions", [defs], false);
      } catch {}
      try {
        this._sendExt(94, "$acceptInlineCompletionsUnificationState", [{ codeUnification: false, modelUnification: false, extensionUnification: false, expAssignments: [] }], false);
      } catch {}
      // Provide language ids early so onLanguage:* activation works like in a real workbench.
      this._sendExt(93, "$acceptLanguageIds", [BOOTSTRAP_LANGUAGE_IDS], false);
      try {
        this._sendExt(122, "$setVisibleChannel", [null], false);
      } catch {}
      try {
        this._sendExt(97, "$acceptStaticEntries", [[]], false);
      } catch {}
      try {
        // Mirror trace: workbench clears active editor before restoring tabs/editors.
        this._sendExt(84, "$acceptDocumentsAndEditorsDelta", [{ newActiveEditor: null }], false);
      } catch {}
      try {
        this._sendExt(113, "$acceptEditorTabModel", [[{ groupId: 0, isActive: true, viewColumn: 0, tabs: [] }]], false);
      } catch {}
      try {
        this._sendExt(99, "$activateByEvent", ["onLanguage", 0], false);
      } catch {}
      if (workspaceRoot) {
        const rootPath = String(workspaceRoot);
        const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
        const wsId = crypto.createHash("sha1").update(rootPath).digest("hex").slice(0, 7);
        const folderUri = this._uriForPath(rootPath, authority);
        const workspace = {
          isUntitled: false,
          folders: [{ uri: folderUri, name, index: 0 }],
          id: wsId,
          name,
          transient: false,
        };
        this._sendExt(106, "$initializeWorkspace", [workspace, workspaceTrusted], false);
        if (workspaceTrusted) {
          this._sendExt(106, "$onDidGrantWorkspaceTrust", [], false);
        }
      }

      return { ok: true, proxyHttp, serverRootPath, commit, authority };
    } finally {
      this._connecting = false;
    }
  }

  async openFile(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const path = String(params.path ?? "");
    const languageId = String(params.languageId ?? "python");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const text = await spanTraceAsync("openFile.fs.readFile", () => fs.readFile(path, "utf8"));
    const lines = spanTrace("openFile.text.splitLines", () => text.split(/\r?\n/));
    let maxLineLen = 0;
    for (const line of lines) {
      if (line.length > maxLineLen) maxLineLen = line.length;
    }
    logMetrics("metrics/open_file", {
      path,
      text_bytes: Buffer.byteLength(text, "utf8"),
      lines: lines.length,
      max_line_len: maxLineLen,
      mem: memSnapshot(),
    });
    const uriObj = spanTrace("openFile.uriForPath", () => this._uriForPath(path, authority));

    const modelN = this._nextModelNumber++;
    const editorId = `vs.editor.ICodeEditor:${modelN},$model${modelN}`;
    const visibleEndLineNumber = Math.min(lines.length || 1, 31);
    const visibleEndColumn = Math.max(1, Math.min((lines[visibleEndLineNumber - 1] ?? "").length + 1, 1000));

    // Mirror the trace: tab model first (preview tab), then delta with addedDocuments,
    // then delta with addedEditors + newActiveEditor.
    const tabId = `0~default-workbench.editors.files.fileEditorInput-${uriObj.external} `;
    const tab = {
      id: tabId,
      label: path.split("/").filter(Boolean).slice(-1)[0] || path,
      editorId: "default",
      input: { kind: 1, uri: uriObj },
      isPinned: false,
      isPreview: true,
      isActive: true,
      isDirty: false,
    };
    const tabModel = [
      {
        groupId: 0,
        isActive: true,
        viewColumn: 0,
        tabs: [tab],
      },
    ];
    spanTrace("openFile.send.tabModel", () => this._sendExt(113, "$acceptEditorTabModel", [tabModel], false));

    const docDelta = spanTrace("openFile.buildDelta.addedDocuments", () => ({
      // Mirror workbench behavior: opening a file is not dirty by default.
      addedDocuments: [{ uri: uriObj, versionId: 1, lines, EOL: "\n", languageId, isDirty: false, encoding: "utf8" }],
    }));
    const reqDocs = spanTrace("openFile.send.delta.addedDocuments", () => this._sendExt(84, "$acceptDocumentsAndEditorsDelta", [docDelta], false));
    // Allow GC to collect the large `lines` array after JSON encoding.
    try {
      if (docDelta?.addedDocuments?.[0]) docDelta.addedDocuments[0].lines = null;
    } catch {}

    const editorDelta = spanTrace("openFile.buildDelta.addedEditors", () => ({
      newActiveEditor: editorId,
      addedEditors: [
        {
          id: editorId,
          documentUri: uriObj,
          options: { insertSpaces: true, tabSize: 4, indentSize: 4, originalIndentSize: "tabSize", cursorStyle: 1, lineNumbers: 1 },
          selections: [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
              selectionStartLineNumber: 1,
              selectionStartColumn: 1,
              positionLineNumber: 1,
              positionColumn: 1,
            },
          ],
          visibleRanges: [{ startLineNumber: 1, startColumn: 1, endLineNumber: visibleEndLineNumber, endColumn: visibleEndColumn }],
          editorPosition: 0,
        },
      ],
    }));
    spanTrace("openFile.send.delta.addedEditors", () => this._sendExt(84, "$acceptDocumentsAndEditorsDelta", [editorDelta], false));

    spanTrace("openFile.send.editorState", () => {
      this._sendExt(88, "$acceptEditorDiffInformation", [editorId, []], false);
      this._sendExt(
        88,
        "$acceptEditorPropertiesChanged",
        [
          editorId,
          {
            options: null,
            selections: {
              selections: [
                {
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: 1,
                  endColumn: 1,
                  selectionStartLineNumber: 1,
                  selectionStartColumn: 1,
                  positionLineNumber: 1,
                  positionColumn: 1,
                },
              ],
              source: "mouse",
            },
            visibleRanges: null,
          },
        ],
        false
      );
      // Editor position metadata (seen in the real workbench trace).
      this._sendExt(88, "$acceptEditorPositionData", [{ [editorId]: 0 }], false);
      this._sendExt(85, "$acceptDirtyStateChanged", [uriObj, false], false);
    });
    // Trigger activation for deterministic provider registration.
    // In the workbench trace this is sent as a normal JSON-args request.
    spanTrace("openFile.send.activateByEvent", () => this._sendExt(99, "$activateByEvent", [`onLanguage:${languageId}`, 0], false));
    return { ok: true, req: reqDocs };
  }

  async documentSymbols(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const timeoutMs = Number(params.timeoutMs ?? 8000);
    let providerHandle = params.providerHandle ?? this.state.docSymbolsProviderHandle;
    if (typeof providerHandle !== "number") {
      await waitFor(() => typeof this.state.docSymbolsProviderHandle === "number", { timeoutMs, intervalMs: 50 });
      providerHandle = params.providerHandle ?? this.state.docSymbolsProviderHandle;
    }
    if (typeof providerHandle !== "number") {
      return { ok: false, error: "no document symbols provider handle learned yet" };
    }

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const token = { isCancellationRequested: false };
    const payload = encodeExtRequestJsonArgs({ req, rpcId: 94, method: "$provideDocumentSymbols", args: [providerHandle, uriObj, token], cancellable: false });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for symbols reply"));
        }
      }, 15000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;
    if (rep.type === 9) return { ok: true, result: rep.result };
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }

  async hover(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const lineNumber = Number(params.lineNumber ?? 1);
    const column = Number(params.column ?? 1);
    const timeoutMs = Number(params.timeoutMs ?? 8000);
    let providerHandle = params.providerHandle ?? this.state.hoverProviderHandle;
    if (typeof providerHandle !== "number") {
      await waitFor(() => typeof this.state.hoverProviderHandle === "number", { timeoutMs, intervalMs: 50 });
      providerHandle = params.providerHandle ?? this.state.hoverProviderHandle;
    }
    if (typeof providerHandle !== "number") return { ok: false, error: "no hover provider handle learned yet" };

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const token = { isCancellationRequested: false };
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideHover",
      args: [providerHandle, uriObj, { lineNumber, column }, {}, token],
      cancellable: false,
    });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for hover reply"));
        }
      }, 15000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;
    if (rep.type === 9) return { ok: true, result: rep.result };
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }

  disconnect() {
    try {
      for (const [req, pending] of this._pendingExt.entries()) {
        try {
          pending?.reject?.(new Error("disconnected"));
        } catch {}
      }
    } catch {}
    try {
      this._pendingExt?.clear?.();
    } catch {}

    try {
      this._mgmtIpc?.dispose?.();
    } catch {}
    this._mgmtIpc = null;

    try {
      this.mgmt?.protocol?.dispose?.();
    } catch {}
    try {
      this.ext?.protocol?.dispose?.();
    } catch {}
    this.mgmt = null;
    this.ext = null;

    this.state.connected = false;
    this.state.ready = false;
    this.state.docSymbolsProviderHandle = null;
    this.state.hoverProviderHandle = null;
    this._extHandshake = { readySeen: false, initSent: false, initialized: false };
    this._connecting = false;
  }

  providers() {
    const toList = (m) => {
      try {
        return Array.from(m.values());
      } catch {
        return [];
      }
    };
    return {
      hover: toList(this._providers.hover),
      documentSymbols: toList(this._providers.documentSymbols),
    };
  }
}
