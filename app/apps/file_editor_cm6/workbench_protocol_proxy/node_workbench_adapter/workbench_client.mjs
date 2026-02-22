import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  DO NOT HARDCODE CONFIGURATION VALUES IN THIS FILE.                 ║
// ║  All extension / editor settings belong in User/settings.json       ║
// ║  (managed by the extension registry gate or the Custom Settings     ║
// ║  UI).  The adapter reads that file and relays it to the extension   ║
// ║  host.  No agent may add hardcoded config overrides here without    ║
// ║  the user's explicit, expressed permission.                         ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import { VSBuffer } from "./vscode_oss_runtime/base/common/buffer.mjs";
import { NodeSocketFactory } from "./vscode_oss_runtime/platform/remote/browser/browserSocketFactory.mjs";
import { ConnectionType, connectToRemoteAgent, createNoopSignService } from "./vscode_oss_runtime/platform/remote/common/remoteAgentConnection.mjs";
import { IpcPromiseClient } from "./vscode_oss_runtime/base/parts/ipc/common/ipc.mjs";

function _hts() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`; }
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
  "$registerDocumentSemanticTokensProvider",
  "$registerDocumentRangeSemanticTokensProvider",
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
  "$ensureActivation",
  "$onWillActivateExtension",
  "$onDidActivateExtension",
  "$onExtensionActivationError",
  "$onUnexpectedError",
  "$logExtensionHostMessage",
  "$onExtensionRuntimeError",
  "$register",

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

// ── RPC nid config ───────────────────────────────────────────────────
// Hardcoded fallback nids (current as of code-server 4.109.2 / VS Code 1.109.2).
// If te2_rpc_config.json exists, values are overridden from it.
const _RPC_DEFAULTS = {
  MainThreadOutputService: 29,
  ExtHostConfiguration: 80,
  ExtHostDocumentsAndEditors: 84,
  ExtHostDocuments: 85,
  ExtHostEditors: 88,
  ExtHostFileSystemInfo: 91,
  ExtHostLanguages: 93,
  ExtHostLanguageFeatures: 94,
  ExtHostStatusBar: 97,
  ExtHostExtensionService: 99,
  ExtHostWorkspace: 106,
  ExtHostEditorTabs: 113,
  ExtHostOutputService: 122,
};
const _rpcIds = { ..._RPC_DEFAULTS };
let _rpcConfigSource = "hardcoded-defaults";
{
  const rpcConfigPath = process.env.TE2_RPC_CONFIG_PATH ||
    path.join(process.env.HOME || "", ".config/code-server/te2_rpc_config.json");
  try {
    const raw = readFileSync(rpcConfigPath, "utf8");
    const cfg = JSON.parse(raw);
    if (cfg.nids && typeof cfg.nids === "object") {
      let applied = 0;
      for (const name of Object.keys(_RPC_DEFAULTS)) {
        if (typeof cfg.nids[name] === "number") {
          _rpcIds[name] = cfg.nids[name];
          applied++;
        }
      }
      _rpcConfigSource = `rpc-config.json (code-server ${cfg.code_server_version || "?"}, ${applied}/${Object.keys(_RPC_DEFAULTS).length} applied)`;
      console.log(`[rpc-config] loaded from ${rpcConfigPath} — ${_rpcConfigSource}`);
    } else {
      console.log(`[rpc-config] ${rpcConfigPath} present but missing nids object, using defaults`);
    }
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.log(`[rpc-config] no config file at ${rpcConfigPath}, using hardcoded defaults`);
    } else {
      console.log(`[rpc-config] failed to load ${rpcConfigPath}: ${err?.message || err}, using hardcoded defaults`);
    }
  }
}
// ── end RPC nid config ───────────────────────────────────────────────

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

const _EXT_TO_LANG = {
  ".py": "python", ".pyi": "python", ".pyw": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".json": "json", ".jsonc": "jsonc", ".json5": "json5",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "scss", ".less": "less",
  ".md": "markdown", ".markdown": "markdown",
  ".yaml": "yaml", ".yml": "yaml",
  ".xml": "xml", ".svg": "xml",
  ".sh": "shellscript", ".bash": "shellscript", ".zsh": "shellscript",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".cxx": "cpp", ".cc": "cpp", ".hpp": "cpp",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".r": "r", ".R": "r",
  ".sql": "sql",
  ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin",
  ".toml": "toml",
  ".ini": "ini", ".cfg": "ini",
  ".dockerfile": "dockerfile",
  ".bat": "bat", ".cmd": "bat",
  ".ps1": "powershell",
  ".vue": "vue",
};
function _languageIdFromPath(filePath) {
  if (!filePath) return "";
  const base = String(filePath).split("/").pop() || "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return _EXT_TO_LANG[base.slice(dot).toLowerCase()] || "";
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
    if (ln > 10000000) {
      console.log(`[ipc_decode] WARNING readLongString len=${ln} off=${off} payloadLen=${payload.length}`);
    }
    return readBytes(ln).toString("utf8");
  };
  const skipLongString = () => {
    const ln = readU32();
    readBytes(ln);
    return ln >>> 0;
  };
  const readMixedArray = () => {
    const count = readU8(); // VS Code uses readUInt8 for mixed arg count
    if (count > 250) {
      console.log(`[ipc_decode] WARNING readMixedArray count=${count} off=${off} payloadLen=${payload.length}`);
      return [{ __mixed_array_too_large__: true, count }];
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const argType = readU8();
      if (argType === 1) {
        // ArgType.String — VS Code JSON.parse's these in deserializeRequestMixedArgs
        const raw = readLongString();
        try { out.push(JSON.parse(raw)); } catch { out.push(raw); }
      }
      else if (argType === 2) {
        // ArgType.VSBuffer — raw binary, read as buffer (len-prefixed)
        const bln = readU32();
        out.push(readBytes(bln));
      }
      else if (argType === 3) {
        // ArgType.SerializedObjectWithBuffers — JSON string + N VSBuffers
        const bufCount = readU32();
        const raw = readLongString();
        const buffers = [];
        for (let j = 0; j < bufCount; j++) {
          const bln = readU32();
          buffers.push(readBytes(bln));
        }
        try {
          out.push(JSON.parse(raw || "null"));
        } catch {
          out.push({ __json_with_buffers_parse_error__: true, buffers: bufCount });
        }
      } else if (argType === 4) out.push(null);
      else out.push({ __unknown_arg_type__: argType });
    }
    return out;
  };
  const skipMixedArray = () => {
    const count = readU8(); // VS Code uses readUInt8 for mixed arg count
    if (count > 250) {
      console.log(`[ipc_decode] WARNING skipMixedArray count=${count} (bailing) off=${off} payloadLen=${payload.length}`);
      return { count, totalJsonBytes: 0, totalStringBytes: 0, totalBuffers: 0, skipped: true };
    }
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
    if (msgType === 8) {
      // ReplyOKVSBuffer — raw buffer reply (used by semantic tokens, etc.)
      // Wire: [4 bytes bufLen BE] [bufLen bytes raw data]
      const bufLen = readU32();
      const rawBuf = readBytes(bufLen);
      return { kind: "ext", type: msgType, req, buffer: rawBuf };
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
    if (msgType === 10) {
      // Reply OK with mixed args (JSON + embedded buffers).
      // Used by semantic tokens and other responses containing VSBuffer.
      const resArgs = readMixedArray();
      const jsonPart = resArgs.length > 0 ? resArgs[0] : null;
      const buffers = [];
      for (let i = 0; i < resArgs.length; i++) {
        if (resArgs[i] && resArgs[i].__json_with_buffers__) {
          buffers.push(resArgs[i]);
        }
      }
      return { kind: "ext", type: msgType, req, result: jsonPart, mixedArgs: resArgs, buffers };
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
    this._fsWatcherSub = null; // IPC event subscription for remoteFilesystem fileChange
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
    this._activeEditorId = null;   // track current editor for close-before-open
    this._activeUriObj = null;     // track current URI object for close-before-open
    this._docVersions = new Map(); // path -> versionId for didChange tracking
    this._docLineCount = new Map(); // path -> line count for didChange range
    this._docCharCount = new Map(); // path -> char count for didChange rangeLength
    this._docLastLineLength = new Map(); // path -> length of last line (for valid endColumn)
    this._docOpenGeneration = new Map(); // path -> generation token from open_file flow
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
      completions: new Map(), // handle -> { handle, selector, supportsResolve }
      semanticTokens: new Map(), // handle -> { handle, selector, legend, eventHandle }
    };
    this.state = {
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
    const raw = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase().trim();
    const includeBuiltin = !(raw === "0" || raw === "false" || raw === "no");
    const base = Array.isArray(scannedExtensions)
      ? scannedExtensions.filter((ext) => includeBuiltin || ext?.isBuiltin === false)
      : [];
    const afterExclude = EXT_EXCLUDE_IDS.length
      ? base.filter((ext) => {
          const ident = this._extensionIdentifierFrom(ext) ?? "";
          return !EXT_EXCLUDE_IDS.includes(String(ident));
        })
      : base;
    // Filter builtins to only language-feature extensions (grammars, language configs,
    // language-features, themes) and always keep user extensions.
    // Extensions like git-base, emmet, npm, etc. try filesystem/process ops that hang.
    const all = afterExclude.filter((ext) => {
      if (ext?.isBuiltin === false) return true; // always keep user extensions
      const ident = String(this._extensionIdentifierFrom(ext) ?? "").toLowerCase();
      // Keep: language grammars (vscode.python, vscode.javascript, vscode.typescript, etc.)
      // Keep: language features (vscode.typescript-language-features, vscode.css-language-features, etc.)
      // Keep: themes (vscode.theme-*, GitHub.github-vscode-theme, etc.)
      // Keep: configuration-editing (provides json schema completions)
      if (ident.endsWith("-language-features")) return true;
      if (ident.startsWith("vscode.theme-")) return true;
      if (ident === "vscode.configuration-editing") return true;
      // Language grammar/config extensions contribute grammars/languages but not activationEvents
      const manifest = ext?.packageJSON ?? ext;
      const contributes = manifest?.contributes;
      if (contributes && (contributes.grammars || contributes.languages)) {
        // Has grammar/language contributions — keep unless it also has problematic activation
        const ae = Array.isArray(ext?.activationEvents) ? ext.activationEvents : [];
        const hasStarActivation = ae.includes("*");
        const hasOnLanguage = ae.some(e => typeof e === "string" && e.startsWith("onLanguage"));
        // Grammar-only extensions (no activation events or only onLanguage) are safe
        if (ae.length === 0 || (!hasStarActivation && hasOnLanguage) || ae.every(e => e.startsWith?.("onLanguage"))) return true;
      }
      // Theme-only extensions
      if (contributes && contributes.themes && !contributes.commands) return true;
      // Non-builtin fallthrough — already handled above
      return false;
    });
    console.log(`[extensions] snapshot: ${base.length} scanned → ${afterExclude.length} after exclude → ${all.length} after language filter`);
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

  /**
   * Extract configuration defaults from raw scanned extensions BEFORE sanitization
   * strips the contributes data. Returns { contents, keys }.
   */
  _extractExtensionConfigDefaults(scannedExtensions) {
    const allContents = {};
    const allKeys = [];
    try {
      const exts = Array.isArray(scannedExtensions) ? scannedExtensions : [];
      for (const ext of exts) {
        const manifest = ext?.packageJSON ?? ext;
        let configs = manifest?.contributes?.configuration;
        if (!configs) continue;
        if (!Array.isArray(configs)) configs = [configs];
        for (const cfg of configs) {
          const props = cfg?.properties;
          if (!props || typeof props !== "object") continue;
          for (const [fullKey, schema] of Object.entries(props)) {
            if (!fullKey || typeof fullKey !== "string") continue;
            if (!Object.prototype.hasOwnProperty.call(schema, "default")) continue;
            const dotIdx = fullKey.indexOf(".");
            if (dotIdx <= 0) continue;
            const section = fullKey.substring(0, dotIdx);
            const prop = fullKey.substring(dotIdx + 1);
            if (!allContents[section]) allContents[section] = {};
            const parts = prop.split(".");
            let target = allContents[section];
            for (let i = 0; i < parts.length - 1; i++) {
              if (!target[parts[i]] || typeof target[parts[i]] !== "object") target[parts[i]] = {};
              target = target[parts[i]];
            }
            target[parts[parts.length - 1]] = schema.default;
            allKeys.push(fullKey);
          }
        }
      }
    } catch (e) {
      console.log(`[config] error scanning extension defaults: ${e?.message ?? e}`);
    }
    console.log(`[config] extracted ${allKeys.length} default keys from ${Array.isArray(scannedExtensions) ? scannedExtensions.length : 0} extensions`);
    return { contents: allContents, keys: allKeys };
  }

  _buildConfigurationInitData(folder, authority) {
    const empty = this._emptyConfigSection();

    // Use pre-extracted extension config defaults (extracted before sanitization).
    const extracted = this._rawExtensionConfigs || { contents: {}, keys: [] };
    const defaults = { contents: { ...extracted.contents }, overrides: [], keys: [...extracted.keys] };

    // ── Read User/settings.json and populate userRemote ──────────────
    // code-server runs in remote mode, so extensions see userRemote as the
    // effective user-level config.  All settings are managed externally via
    // the extension registry gate or the Custom Settings UI — nothing is
    // hardcoded here (see banner at top of file).
    const userRemoteContents = {};
    const userRemoteKeys = [];

    const userRemoteOverrides = [];

    const home = process.env.HOME || process.env.USERPROFILE || "";
    const settingsPath = process.env.TE2_USER_SETTINGS_PATH ||
      (home ? path.join(home, ".config/code-server/User/settings.json") : "");
    if (settingsPath) {
      try {
        const raw = readFileSync(settingsPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [flatKey, value] of Object.entries(parsed)) {
            // Language-scoped overrides like "[python]" → IOverrides format
            if (flatKey.startsWith("[") && flatKey.endsWith("]")) {
              if (value && typeof value === "object" && !Array.isArray(value)) {
                const lang = flatKey.slice(1, -1);
                const oKeys = Object.keys(value);
                const oContents = {};
                for (const [oKey, oVal] of Object.entries(value)) {
                  const oDotIdx = oKey.indexOf(".");
                  if (oDotIdx > 0) {
                    const oSec = oKey.substring(0, oDotIdx);
                    const oProp = oKey.substring(oDotIdx + 1);
                    if (!oContents[oSec]) oContents[oSec] = {};
                    const oParts = oProp.split(".");
                    let oTarget = oContents[oSec];
                    for (let j = 0; j < oParts.length - 1; j++) {
                      if (!oTarget[oParts[j]] || typeof oTarget[oParts[j]] !== "object") oTarget[oParts[j]] = {};
                      oTarget = oTarget[oParts[j]];
                    }
                    oTarget[oParts[oParts.length - 1]] = oVal;
                  } else {
                    oContents[oKey] = oVal;
                  }
                }
                userRemoteOverrides.push({ identifiers: [lang], keys: oKeys, contents: oContents });
              }
              continue;
            }
            const dotIdx = flatKey.indexOf(".");
            if (dotIdx <= 0) continue;
            const section = flatKey.substring(0, dotIdx);
            const prop = flatKey.substring(dotIdx + 1);
            if (!userRemoteContents[section]) userRemoteContents[section] = {};
            const parts = prop.split(".");
            let target = userRemoteContents[section];
            for (let i = 0; i < parts.length - 1; i++) {
              if (!target[parts[i]] || typeof target[parts[i]] !== "object") target[parts[i]] = {};
              target = target[parts[i]];
            }
            target[parts[parts.length - 1]] = value;
            if (!userRemoteKeys.includes(flatKey)) userRemoteKeys.push(flatKey);
          }
          console.log(`[config] loaded ${userRemoteKeys.length} user settings from ${settingsPath}`);
        }
      } catch (e) {
        console.log(`[config] could not read user settings (${settingsPath}): ${e?.message ?? e}`);
      }
    }

    const userRemote = {
      contents: userRemoteContents,
      overrides: userRemoteOverrides,
      keys: userRemoteKeys,
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
      this.state.mgmtConnected = true;

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
            const raw = String(process.env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase().trim();
            const includeBuiltin = !(raw === "0" || raw === "false" || raw === "no");
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
      // BUT first, extract configuration defaults while contributes data is still available.
      this._rawExtensionConfigs = this._extractExtensionConfigDefaults(scannedExtensions);
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
      // Log loaded extensions to stdout
      try {
        const extIds = (scannedExtensions || []).map((ext) => this._extensionIdentifierFrom(ext) ?? "?").sort();
        const builtinCount = (scannedExtensions || []).filter((ext) => ext?.isBuiltin === true).length;
        const userCount = extIds.length - builtinCount;
        console.log(`[extensions] loaded ${extIds.length} extensions (${builtinCount} builtin, ${userCount} user): ${extIds.join(", ")}`);
      } catch {}
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

      // Subscribe to file watcher events via the remoteFilesystem IPC channel.
      await this._setupFileWatcher(workspaceRoot);

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
      this.state.extConnected = true;
      this.state.useRemote = !!useRemote;
      this.state.authority = authority ?? null;
      this.state.serverRootPath = serverRootPath ?? null;
      this.state.commit = commit ?? null;
      this.state.workspaceFolder = workspaceRoot ?? null;
      this.state.activePath = null;
      this.state.activeUri = null;
      this.state.activeLanguageId = null;
      this.state.lastOpenTs = null;
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
              console.log(`[ext_handshake] READY after ${Date.now() - startMs}ms`);
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
                console.log(`[ext_handshake] INIT_SENT bytes=${initJson.length} extensions=${extInitData?.extensions?.allExtensions?.length ?? '?'}`);
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
            console.log(`[ext_handshake] INITIALIZED after ${Date.now() - startMs}ms`);
            resolve();
          } else if (v === 3) {
            // Terminate
            console.log(`[ext_handshake] TERMINATE received — ext host shutting down`);
          }
        });
      });

      this._extMsgCount = 0;
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
        this._extMsgCount++;
        if (this._extMsgCount <= 500) {
          const mem = process.memoryUsage();
          console.log(`[ext_msg] #${this._extMsgCount} len=${b0?.length ?? 0} heapUsed=${(mem.heapUsed/1048576).toFixed(1)}MB`);
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
        // Pre-decode: log raw header bytes for messages near the crash zone
        if (this._extMsgCount >= 100 && this._extMsgCount <= 120) {
          const raw = payloadVsBuf.buffer;
          const hex = Buffer.from(raw.slice(0, Math.min(32, raw.length))).toString('hex');
          console.log(`[ext_msg_raw] #${this._extMsgCount} len=${raw.length} first32hex=${hex}`);
        }
        const msg = decodeExtHostRpc(payloadVsBuf.buffer);
        if (this._extMsgCount <= 500) {
          // Peek at raw message type before full decode log
          const rawType = payloadVsBuf.buffer?.[0];
          const rawReq = payloadVsBuf.buffer?.length >= 5 ? payloadVsBuf.buffer.readUInt32BE(1) : -1;
          console.log(`[ext_msg] #${this._extMsgCount} kind=${msg.kind} type=${msg.type} rpcId=${msg.rpcId ?? '-'} method=${msg.method ?? '-'} req=${msg.req ?? '-'} rawType=${rawType}`);
        }
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
              "$onUnexpectedError",
              "$logExtensionHostMessage",
              "$onExtensionRuntimeError",
              "$register",
            ]);
            if (logArgsMethods.has(msg.method)) {
              ev.args = msg.args;
            }
            this.onEvent(ev);
          }
          // Log activation lifecycle to stdout
          if (msg.method === "$onWillActivateExtension" || msg.method === "$onDidActivateExtension" || msg.method === "$onExtensionActivationError") {
            const raw0 = msg.args?.[0];
            const extId = raw0?.value?.id ?? raw0?.id ?? raw0?.identifier?.id ?? (typeof raw0 === 'string' ? raw0 : JSON.stringify(raw0)?.slice(0, 200));
            console.log(`[ext_activation] ${msg.method} extId=${extId}`);
          }
          if (msg.method === "$ensureActivation") {
            console.log(`[ext_activation] $ensureActivation args=${JSON.stringify(msg.args ?? [])}`);
          }
          if (msg.method === "$initializeExtensionStorage") {
            console.log(`[ext_activation] $initializeExtensionStorage args=${JSON.stringify(msg.args ?? []).slice(0, 200)}`);
          }
          if (msg.method === "$onUnexpectedError") {
            console.log(`[ext_error] $onUnexpectedError args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
          }
          if (msg.method === "$logExtensionHostMessage") {
            console.log(`[ext_log] $logExtensionHostMessage args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
          }
          if (msg.method === "$register") {
            console.log(`[ext_register] $register rpcId=${msg.rpcId} args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
          }
          if (msg.method === "$onExtensionRuntimeError") {
            console.log(`[ext_error] $onExtensionRuntimeError args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
          }

          // RPCProtocol expects an immediate ACK for every request.
          try {
            this.ext?.protocol.send(VSBuffer.wrap(encodeExtAck(msg.req)));
          } catch {}
          // Replies are sent below (after provider-learning and diagnostics) in
          // the comprehensive reply block starting with REPLY_DROP_METHODS.

          // Learn provider handles.
          if (msg.method && msg.method.startsWith("$register") && msg.method.endsWith("Provider")) {
            console.log(`[providers] ${msg.method} handle=${msg.args?.[0]} selector=${JSON.stringify(msg.args?.[1])?.slice(0,300)}`);
          }
          if (msg.method === "$registerDocumentSymbolProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const label = (typeof msg.args[2] === "string") ? msg.args[2] : null;
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              try {
                this._providers.documentSymbols.set(handle, { handle, selector, label });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language) {
                  this.state.ready = true;
                  this.onEvent({ type: "provider/documentSymbols", ts_ms: Date.now(), handle, language: s.language });
                  break;
                }
              }
            }
          }
          if (msg.method === "$registerHoverProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const label = (typeof msg.args[2] === "string") ? msg.args[2] : null;
            console.log(`[providers] $registerHoverProvider handle=${handle} selector=${JSON.stringify(selector)?.slice(0,200)} isArr=${Array.isArray(selector)} isFinite=${Number.isFinite(handle)}`);
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              try {
                this._providers.hover.set(handle, { handle, selector, label });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language) {
                  this.state.ready = true;
                  this.onEvent({ type: "provider/hover", ts_ms: Date.now(), handle, language: s.language });
                  break;
                }
              }
              console.log(`[providers] hover map size=${this._providers.hover.size} languages=[${Array.from(this._providers.hover.values()).map(e => e.selector?.map(s => s?.language).filter(Boolean)).flat().join(',')}]`);
            }
          }
          if (msg.method === "$registerCompletionsProvider" && Array.isArray(msg.args) && msg.args.length >= 2) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const supportsResolve = !!msg.args[3];
            if (Number.isFinite(handle) && Array.isArray(selector)) {
              try {
                this._providers.completions.set(handle, { handle, selector, supportsResolve });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language) {
                  this.onEvent({ type: "provider/completions", ts_ms: Date.now(), handle, language: s.language });
                  break;
                }
              }
              console.log(`[providers] completions map size=${this._providers.completions.size} languages=[${Array.from(this._providers.completions.values()).map(e => e.selector?.map(s => s?.language).filter(Boolean)).flat().join(',')}]`);
            }
          }
          if (msg.method === "$registerDocumentSemanticTokensProvider" && Array.isArray(msg.args) && msg.args.length >= 3) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const legend = msg.args[2];
            const eventHandle = msg.args[3] ?? null;
            if (Number.isFinite(handle) && Array.isArray(selector) && legend) {
              try {
                this._providers.semanticTokens.set(handle, { handle, selector, legend, eventHandle });
              } catch {}
              for (const s of selector) {
                if (s && typeof s === "object" && s.language) {
                  this.onEvent({ type: "provider/semanticTokens", ts_ms: Date.now(), handle, language: s.language, legend });
                }
              }
              console.log(`[providers] semanticTokens map size=${this._providers.semanticTokens.size} languages=[${Array.from(this._providers.semanticTokens.values()).map(e => e.selector?.map(s => s?.language).filter(Boolean)).flat().join(',')}] legendTypes=${legend?.tokenTypes?.length ?? 0} legendMods=${legend?.tokenModifiers?.length ?? 0}`);
            }
          }
          if ((msg.method === "$registerDocumentRangeSemanticTokensProvider") && Array.isArray(msg.args) && msg.args.length >= 3) {
            const handle = Number(msg.args[0]);
            const selector = msg.args[1];
            const legend = msg.args[2];
            console.log(`[providers] range check: handle=${handle} isFinite=${Number.isFinite(handle)} isArrSelector=${Array.isArray(selector)} legendTruthy=${!!legend} legendType=${typeof legend} legendKeys=${legend ? Object.keys(legend).join(',') : 'N/A'}`);
            if (Number.isFinite(handle) && Array.isArray(selector) && legend) {
              try {
                this._providers.semanticTokens.set(handle, { handle, selector, legend, eventHandle: null, range: true });
                for (const s of selector) {
                  if (s && typeof s === "object" && s.language) {
                    this.onEvent({ type: "provider/semanticTokens", ts_ms: Date.now(), handle, language: s.language, legend, range: true });
                  }
                }
                console.log(`[providers] semanticTokensRange map size=${this._providers.semanticTokens.size} languages=[${Array.from(this._providers.semanticTokens.values()).map(e => e.selector?.map(s => s?.language).filter(Boolean)).flat().join(',')}] legendTypes=${legend?.tokenTypes?.length ?? 0} legendMods=${legend?.tokenModifiers?.length ?? 0}`);
              } catch (ex) {
                console.log(`[providers] semanticTokensRange EXCEPTION: ${ex?.message ?? ex}`);
              }
            }
          }

          // Diagnostics.
          if (msg.method === "$changeMany") {
            const argsSummary = Array.isArray(msg.args) ? `args.length=${msg.args.length}` : `args=${typeof msg.args}`;
            const pairs = Array.isArray(msg.args) && Array.isArray(msg.args[1]) ? msg.args[1] : [];
            const markerCounts = pairs.map(p => Array.isArray(p) && Array.isArray(p[1]) ? p[1].length : '?');
            console.log(`[wb_client] ts=${Date.now()} $changeMany owner=${msg.args?.[0]} pairs=${pairs.length} markerCounts=[${markerCounts.join(',')}]`);
            // If decoding produced a non-array markers payload, print the pair shape to debug.
            // Keep this bounded: only log the first pair and only when it's suspicious.
            try {
              if (markerCounts.includes('?') && pairs.length > 0 && Array.isArray(pairs[0])) {
                const u0 = pairs[0][0];
                const m0 = pairs[0][1];
                const uKeys = (u0 && typeof u0 === "object") ? Object.keys(u0).slice(0, 12) : [];
                const mKeys = (m0 && typeof m0 === "object") ? Object.keys(m0).slice(0, 12) : [];
                let mPreview = "";
                try {
                  if (m0 && typeof m0 === "object") mPreview = JSON.stringify(m0).slice(0, 240);
                } catch {}
                let uPath = "";
                try {
                  if (u0 && typeof u0 === "object") uPath = String(u0.path || u0.fsPath || "");
                } catch {}
                console.log(
                  `[wb_client] ts=${Date.now()} $changeMany suspicious pair0 uriType=${typeof u0} uriPath=${uPath} uriKeys=${JSON.stringify(uKeys)} ` +
                  `markersType=${Array.isArray(m0) ? "array" : typeof m0} markersKeys=${JSON.stringify(mKeys)} markersPreview=${mPreview}`
                );
              }
            } catch {}
            if (pairs.length > 0 && Array.isArray(pairs[0]) && pairs[0].length >= 2) {
              const sampleMarkers = Array.isArray(pairs[0][1]) ? pairs[0][1].slice(0, 1) : [];
              if (sampleMarkers.length) console.log(`[wb_client] ts=${Date.now()} $changeMany sample marker keys:`, Object.keys(sampleMarkers[0]));
              // Full dump of first 3 diagnostics for severity inspection
              const allMarkers = Array.isArray(pairs[0][1]) ? pairs[0][1] : [];
              const dump = allMarkers.slice(0, 3).map(m => ({
                severity: m.severity, code: m.code, source: m.source, message: String(m.message ?? '').slice(0, 120),
                startLineNumber: m.startLineNumber, startColumn: m.startColumn,
                endLineNumber: m.endLineNumber, endColumn: m.endColumn,
                tags: m.tags, relatedInformation: m.relatedInformation?.length ?? 0
              }));
              console.log(`[diagnostics_dump] total=${allMarkers.length} first3=` + JSON.stringify(dump));
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
              this._sendExt(_rpcIds.ExtHostWorkspace, "$onDidGrantWorkspaceTrust", [], false);
            } catch {}
          } else if (msg.method === "$getTools") {
            // The real workbench returns a large list (built-in + extension tools). Empty array is acceptable for our TE2 use-cases.
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$initializeExtensionStorage") {
            // Real workbench returns a JSON-encoded string. ExtHostStorage.safeParseValue()
            // calls JSON.parse() on the deserialized result. We send the string "{}" so:
            //   wire: JSON.stringify("{}") → "\"{}\""
            //   ext host RPC deserialize: JSON.parse("\"{}\"") → "{}" (string)
            //   safeParseValue: JSON.parse("{}") → {} (empty object) ✓
            replyPayload = encodeExtReplyOkJson(msg.req, "{}");
          } else if (msg.method === "$startFileSearch") {
            replyPayload = encodeExtReplyOkJson(msg.req, []);
          } else if (msg.method === "$resolveProxy") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else if (msg.method === "$getPassword") {
            replyPayload = encodeExtReplyOkJson(msg.req, null);
          } else if (msg.method === "$executeCommand") {
            replyPayload = encodeExtReplyOkEmpty(msg.req);
          } else if (msg.method === "$register" && msg.rpcId === _rpcIds.MainThreadOutputService) {
            // MainThreadOutputService.$register returns Promise<string> (channel ID).
            // Clangd blocks waiting for this. Return a synthetic channel ID.
            const channelId = `te2-output-${msg.req}`;
            console.log(`[ext_reply] $register (OutputService) req=${msg.req} → channelId=${channelId}`);
            replyPayload = encodeExtReplyOkJson(msg.req, channelId);
          } else {
            replyPayload = encodeExtReplyOkEmpty(msg.req);
          }
          try {
            this.ext?.protocol.send(VSBuffer.wrap(replyPayload));
            if (this._debugMainThreadReplySeen < 80) {
              this._debugMainThreadReplySeen++;
              const replyHex = Buffer.from(replyPayload.slice(0, Math.min(64, replyPayload.length))).toString('hex');
              console.log(`[ext_reply_sent] req=${msg.req} method=${msg.method} type=${replyPayload?.[0]} len=${replyPayload?.length} hex=${replyHex}`);
              this.onEvent({
                type: "ext/reply_to_ext",
                ts_ms: Date.now(),
                req: msg.req,
                method: msg.method,
                replyType: replyPayload?.[0] ?? null,
              });
            }
          } catch (replyErr) {
            console.log(`[ext_reply_ERROR] req=${msg.req} method=${msg.method} err=${replyErr?.message ?? replyErr}`);
          }
          return;
        }

        // replies to our requests
        if (msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10 || msg.type === 11 || msg.type === 12) {
          if (msg.type === 11 || msg.type === 12) {
            const errMeta = this._sentExtMeta.get(msg.req);
            console.log(`${_hts()} [ext_reply_ERROR] req=${msg.req} type=${msg.type} method=${errMeta?.method ?? "?"} error=${JSON.stringify(msg.error)?.slice(0, 500)}`);
          }
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

      console.log(`[rpc-config] source: ${_rpcConfigSource}`);

      // Minimal ExtHost bootstrap (enough to get language providers registered).
      const configInit = spanTrace("connect.buildConfigurationInitData", () => this._buildConfigurationInitData(workspaceRoot, useRemote ? authority : null));
      this._sendExt(_rpcIds.ExtHostConfiguration, "$initializeConfiguration", [configInit], false);
      try {
        // In a real workbench session, configuration is then synced via `$acceptConfigurationChanged`.
        // Some extensions (including ms-python.python) appear to rely on this to observe settings.
        const allChangedKeys = [...new Set([...configInit.defaults.keys, ...configInit.userRemote.keys])];
        this._sendExt(_rpcIds.ExtHostConfiguration, "$acceptConfigurationChanged", [configInit, { keys: allChangedKeys, overrides: [] }], false);
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
          this._sendExt(_rpcIds.ExtHostFileSystemInfo, "$acceptProviderInfos", [{ $mid: 1, path: "/dummy", scheme }, caps], false);
        }
      } catch {}
      try {
        const regexSource = "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\$\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)";
        const defs = BOOTSTRAP_LANGUAGE_IDS.map((languageId) => ({ languageId, regexSource, regexFlags: "g" }));
        this._sendExt(_rpcIds.ExtHostLanguageFeatures, "$setWordDefinitions", [defs], false);
      } catch {}
      try {
        this._sendExt(_rpcIds.ExtHostLanguageFeatures, "$acceptInlineCompletionsUnificationState", [{ codeUnification: false, modelUnification: false, extensionUnification: false, expAssignments: [] }], false);
      } catch {}
      // Provide language ids early so onLanguage:* activation works like in a real workbench.
      this._sendExt(_rpcIds.ExtHostLanguages, "$acceptLanguageIds", [BOOTSTRAP_LANGUAGE_IDS], false);
      try {
        this._sendExt(_rpcIds.ExtHostOutputService, "$setVisibleChannel", [null], false);
      } catch {}
      try {
        this._sendExt(_rpcIds.ExtHostStatusBar, "$acceptStaticEntries", [[]], false);
      } catch {}
      try {
        // Mirror trace: workbench clears active editor before restoring tabs/editors.
        this._sendExt(_rpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [{ newActiveEditor: null }], false);
      } catch {}
      try {
        this._sendExt(_rpcIds.ExtHostEditorTabs, "$acceptEditorTabModel", [[{ groupId: 0, isActive: true, viewColumn: 0, tabs: [] }]], false);
      } catch {}
      try {
        this._sendExt(_rpcIds.ExtHostExtensionService, "$activateByEvent", ["onLanguage", 0], false);
      } catch {}
      // NOTE: removed $activateByEvent("*") — it activates non-language extensions
      // (emmet, git-base, etc.) that try filesystem ops our adapter can't handle,
      // causing the ext host to hang. Language extensions activate via onLanguage:xxx.
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
        this._sendExt(_rpcIds.ExtHostWorkspace, "$initializeWorkspace", [workspace, workspaceTrusted], false);
        if (workspaceTrusted) {
          this._sendExt(_rpcIds.ExtHostWorkspace, "$onDidGrantWorkspaceTrust", [], false);
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
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const forceRefresh = params.forceRefresh === true;
    const generation = Number.isFinite(Number(params.generation)) ? Number(params.generation) : null;
    const prevEditorId = this._activeEditorId;
    const prevUriObj = this._activeUriObj;
    const prevTab = this._activeTab;
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
    try {
      this.state.activePath = path;
      this.state.activeUri = uriObj?.external ?? uriObjToString(uriObj);
      this.state.activeLanguageId = languageId ?? null;
      this.state.lastOpenTs = Date.now();
    } catch {}

		    // When switching files, treat the previous document as removed and the new one as added in
		    // the same *sequence* as the real code-server workbench frontend:
		    //   tabModel → removedDocuments → addedDocuments → addedEditors(+newActiveEditor)
		    // NOTE: The trace does NOT send `removedEditors` here; sending it with the wrong editor id
		    // can break subsequent diagnostics.
		    const prevAbs = (prevUriObj?.fsPath ?? prevUriObj?.path) ? String(prevUriObj?.fsPath ?? prevUriObj?.path) : "";
		    // Same-file reopen (e.g. page reload): skip remove+re-add to keep the ext host model
		    // stable. Clangd clears diagnostics on document close, so removing then re-adding the
		    // same file causes a markers=0 flash and ContentChangedError on symbols.
		    // Instead, reuse the existing model and push a full-content $didChange.
		    const isSameFileReopen = !!(prevUriObj && prevAbs && prevAbs === path);
		    const shouldClosePrev = !!(
		      prevUriObj &&
		      prevAbs &&
		      !isSameFileReopen &&
		      (forceRefresh || prevAbs !== path)
		    );

	    const modelN = this._nextModelNumber++;
	    // Match code-server trace format: constant ICodeEditor:2, variable $modelN.
	    const editorId = `vs.editor.ICodeEditor:2,$model${modelN}`;
    const visibleEndLineNumber = Math.min(lines.length || 1, 31);
    const visibleEndColumn = Math.max(1, Math.min((lines[visibleEndLineNumber - 1] ?? "").length + 1, 1000));

    // Mirror the trace: tab operations first, then tab model, then document/editor delta.
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
    const tabInactive = { ...tab, isActive: false };
    const tabActive = { ...tab, isActive: true };
    const tabModel = [
      {
        groupId: 0,
        isActive: true,
        viewColumn: 0,
        tabs: [tab],
      },
	    ];

    // The workbench emits a small tab lifecycle stream before the tab model:
    // - First open: kind 0 (add inactive) then kind 2 (activate)
    // - Switch: kind 1 (close/replace old) then kind 0 (add inactive) then kind 2 (activate)
    try {
      if (shouldClosePrev && prevTab) {
        spanTrace("openFile.send.tabOp.closePrev", () =>
          this._sendExt(_rpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: prevTab, kind: 1 }], false)
        );
        console.log(`[openFile] ts=${Date.now()} tabOp kind=1 closePrev tab=${String(prevTab?.label || "")}`);
      }
    } catch {}
    try {
      spanTrace("openFile.send.tabOp.addInactive", () =>
        this._sendExt(_rpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: tabInactive, kind: 0 }], false)
      );
      console.log(`[openFile] ts=${Date.now()} tabOp kind=0 addInactive tab=${String(tabInactive?.label || "")}`);
    } catch {}
    try {
      spanTrace("openFile.send.tabOp.activate", () =>
        this._sendExt(_rpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: tabActive, kind: 2 }], false)
      );
      console.log(`[openFile] ts=${Date.now()} tabOp kind=2 activate tab=${String(tabActive?.label || "")}`);
    } catch {}

    spanTrace("openFile.send.tabModel", () => this._sendExt(_rpcIds.ExtHostEditorTabs, "$acceptEditorTabModel", [tabModel], false));
    try {
      const prevPath = (prevUriObj && typeof prevUriObj === "object") ? String(prevUriObj.fsPath || prevUriObj.path || "") : "";
      console.log(`[openFile] ts=${Date.now()} path=${path} lang=${languageId} editorId=${editorId} forceRefresh=${forceRefresh ? 1 : 0} shouldClosePrev=${shouldClosePrev} prevEditorId=${prevEditorId || ""} prevPath=${prevPath}`);
    } catch {}

	    // Close the previous document first (mirror trace).
	    if (shouldClosePrev) {
	      try {
	        spanTrace("openFile.send.delta.removedDocuments", () =>
	          this._sendExt(_rpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [{ removedDocuments: [prevUriObj] }], false)
	        );
        try {
          const prevPath = (prevUriObj && typeof prevUriObj === "object") ? String(prevUriObj.fsPath || prevUriObj.path || "") : "";
          console.log(`[openFile] ts=${Date.now()} removedDocuments=[${prevPath}]`);
        } catch {
          console.log(`[openFile] ts=${Date.now()} removedDocuments=[?]`);
        }
      } catch {}
    }

    if (isSameFileReopen) {
      // Same file reopen (page reload): push full content via $didChange to keep model stable.
      // This avoids clangd clearing diagnostics on document close+reopen.
      const prevVersion = this._docVersions.get(path) || 1;
      const newVersion = prevVersion + 1;
      const prevLineCount = this._docLineCount.get(path) || 1;
      const prevCharCount = this._docCharCount.get(path) || 0;
      const prevLastLineLen = this._docLastLineLength.get(path) ?? 10000;
      console.log(`[openFile] ts=${Date.now()} same-file reopen, sending $didChange instead of remove+add (v${prevVersion}→v${newVersion})`);
      this._sendExt(_rpcIds.ExtHostDocuments, "$acceptModelChanged", [
        uriObj,
        {
          changes: [{
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: prevLineCount, endColumn: prevLastLineLen + 1 },
            rangeOffset: 0,
            rangeLength: prevCharCount,
            text,
          }],
          eol: "\n",
          versionId: newVersion,
          isUndoing: false,
          isRedoing: false,
          isFlush: true,
        },
        false,
      ], false);
      this._docVersions.set(path, newVersion);
      this._docLineCount.set(path, lines.length);
      this._docCharCount.set(path, text.length);
      this._docLastLineLength.set(path, lines[lines.length - 1].length);
      this._docOpenGeneration.set(path, generation);
      // Keep the same editor and tab — just update state references.
      this._activeEditorId = prevEditorId;
      this._activeUriObj = uriObj;
      this._activeTab = prevTab;
      return { ok: true, req: null };
    }

    // Added document (with full line payload).
    const docDelta = spanTrace("openFile.buildDelta.addedDocuments", () => ({
      addedDocuments: [{ uri: uriObj, versionId: 1, lines, EOL: "\n", languageId, isDirty: false, encoding: "utf8" }],
    }));
    spanTrace("openFile.send.delta.addedDocuments", () => this._sendExt(_rpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [docDelta], false));
    try { console.log(`[openFile] ts=${Date.now()} addedDocuments=[${path}] lineCount=${lines.length}`); } catch {}
    this._docVersions.set(path, 1); // reset version tracking for didChange
    this._docLineCount.set(path, lines.length);
    this._docCharCount.set(path, text.length);
    this._docLastLineLength.set(path, lines[lines.length - 1].length);
    this._docOpenGeneration.set(path, generation);
    // Allow GC to collect the large `lines` array after JSON encoding.
    try {
      if (docDelta?.addedDocuments?.[0]) docDelta.addedDocuments[0].lines = null;
    } catch {}

	    // Added editor + activate it (newActiveEditor included on this delta in the trace).
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
    const reqDocs = spanTrace("openFile.send.delta.addedEditors", () => this._sendExt(_rpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [editorDelta], false));
    try { console.log(`[openFile] ts=${Date.now()} addedEditors=[${editorId}] newActiveEditor=${editorId}`); } catch {}

    spanTrace("openFile.send.editorState", () => {
      this._sendExt(_rpcIds.ExtHostEditors, "$acceptEditorDiffInformation", [editorId, []], false);
	      this._sendExt(
        _rpcIds.ExtHostEditors,
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
      this._sendExt(_rpcIds.ExtHostEditors, "$acceptEditorPositionData", [{ [editorId]: 0 }], false);
      this._sendExt(_rpcIds.ExtHostDocuments, "$acceptDirtyStateChanged", [uriObj, false], false);
    });
    // Trigger activation for deterministic provider registration.
    // In the workbench trace this is sent as a normal JSON-args request.
    spanTrace("openFile.send.activateByEvent", () => this._sendExt(_rpcIds.ExtHostExtensionService, "$activateByEvent", [`onLanguage:${languageId}`, 0], false));
    this._activeEditorId = editorId;
    this._activeUriObj = uriObj;
    this._activeTab = tabActive;
    return { ok: true, req: reqDocs };
  }

  /**
   * Push a full-text buffer update to the extension host for live diagnostics.
   * Uses $acceptModelChanged on ExtHostDocuments with isFlush:true.
   */
  didChange(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const path = String(params.path ?? "");
    const text = String(params.text ?? "");
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const generation = Number.isFinite(Number(params.generation)) ? Number(params.generation) : null;

    if (!this._docVersions.has(path) || !this._docLineCount.has(path) || !this._docCharCount.has(path)) {
      console.warn(`[didChange] drop path=${path} reason=document_not_open`);
      return { ok: false, error: "document_not_open" };
    }

    const openGeneration = this._docOpenGeneration.get(path);
    if (generation !== null && openGeneration !== undefined && openGeneration !== null && openGeneration !== generation) {
      console.warn(`[didChange] drop path=${path} reason=stale_generation openGen=${openGeneration} gotGen=${generation}`);
      return { ok: false, error: "stale_generation", openGeneration };
    }

    // Monotonically increasing versionId per document
    const prevVersion = this._docVersions.get(path) ?? 1;
    const nextVersion = prevVersion + 1;
    this._docVersions.set(path, nextVersion);

    const uriObj = this._uriForPath(path, authority);

    // ISerializedModelContentChangedEvent — full content replacement.
    // The mirror model does _acceptDeleteRange(range) then _acceptInsertText(start, text),
    // so the range MUST span the entire existing document to delete it first.
    const prevLines = this._docLineCount.get(path) ?? 1;
    // Fall back to 10000 if never tracked (file opened before this tracking existed).
    // The mirror model clamps internally; clangd rejects INT32_MAX but tolerates reasonable values.
    const prevLastLineLen = this._docLastLineLength.get(path) ?? 10000;
    const newLines = text.split(/\r?\n/);
    this._docLineCount.set(path, newLines.length);
    this._docLastLineLength.set(path, newLines[newLines.length - 1].length);

    const event = {
      changes: [{
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: prevLines, endColumn: prevLastLineLen + 1 },
        rangeOffset: 0,
        rangeLength: this._docCharCount.get(path) ?? 0,
        text,
      }],
      eol: "\n",
      versionId: nextVersion,
      isUndoing: false,
      isRedoing: false,
      isFlush: true,
      isEolChange: false,
    };

    // rpcId ExtHostDocuments, $acceptModelChanged(uri, event, isDirty)
    this._sendExt(_rpcIds.ExtHostDocuments, "$acceptModelChanged", [uriObj, event, true], false);
    this._docCharCount.set(path, text.length);
    console.log(`[didChange] ts=${Date.now()} path=${path} ver=${nextVersion} bytes=${text.length} prevLines=${prevLines} prevLastLineLen=${prevLastLineLen} newLines=${newLines.length}`);
    return { ok: true, versionId: nextVersion };
  }

  async documentSymbols(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const timeoutMs = Number(params.timeoutMs ?? 8000);
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const generation = Number.isFinite(Number(params.generation)) ? Number(params.generation) : null;

    if (!this._docVersions.has(path)) {
      return { ok: false, error: "document_not_open" };
    }
    const openGeneration = this._docOpenGeneration.get(path);
    if (generation !== null && openGeneration !== undefined && openGeneration !== null && openGeneration !== generation) {
      return { ok: false, error: "stale_generation", openGeneration };
    }

    console.log(`[symbols] request path=${path} lang=${languageId} registeredProviders=${[...this._providers.documentSymbols.values()].map(e => JSON.stringify(e.selector.map(s => s.language))).join(", ")}`);

    let providerHandle = params.providerHandle ?? this._findProviderHandle("documentSymbols", languageId);
    if (typeof providerHandle !== "number") {
      console.log(`[symbols] no provider yet for '${languageId}', waiting up to ${timeoutMs}ms...`);
      await waitFor(() => this._findProviderHandle("documentSymbols", languageId) != null, { timeoutMs, intervalMs: 50 });
      providerHandle = params.providerHandle ?? this._findProviderHandle("documentSymbols", languageId);
    }
    if (typeof providerHandle !== "number") {
      console.log(`[symbols] STILL no provider for '${languageId}' after timeout`);
      return { ok: false, error: `no document symbols provider for language '${languageId}'` };
    }
    console.log(`[symbols] using providerHandle=${providerHandle} for '${languageId}'`);

    const uriObj = this._uriForPath(path, authority);
    try {
      this.state.activePath = path;
      this.state.activeUri = uriObj?.external ?? uriObjToString(uriObj);
      this.state.activeLanguageId = languageFromPath(path) ?? null;
      this.state.lastOpenTs = Date.now();
    } catch {}

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({ req, rpcId: 94, method: "$provideDocumentSymbols", args: [providerHandle, uriObj], cancellable: true });

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
    const symCount = (rep.type === 9 && Array.isArray(rep.result)) ? rep.result.length : 'n/a';
    console.log(`[symbols] response path=${path} lang=${languageId} type=${rep.type} count=${symCount}`);
    if (rep.type === 9) return { ok: true, result: rep.result };
    if (rep.type === 11) {
      console.log(`[symbols] error reply:`, rep.error);
      // ContentChangedError — document was re-opened; retry once after a short delay.
      if (!params._retried) {
        console.log(`[symbols] retrying after 800ms...`);
        await new Promise(r => setTimeout(r, 800));
        return this.symbols({ ...params, _retried: true });
      }
      return { ok: false, error: rep.error };
    }
    return { ok: false, error: rep };
  }

  async hover(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const lineNumber = Number(params.lineNumber ?? 1);
    const column = Number(params.column ?? 1);
    const timeoutMs = Number(params.timeoutMs ?? 8000);
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    console.log(`[hover] path=${path} languageId=${languageId} hoverMapSize=${this._providers.hover.size} immediate=${this._findProviderHandle("hover", languageId)}`);

    let providerHandle = params.providerHandle ?? this._findProviderHandle("hover", languageId);
    if (typeof providerHandle !== "number") {
      await waitFor(() => this._findProviderHandle("hover", languageId) != null, { timeoutMs, intervalMs: 50 });
      providerHandle = params.providerHandle ?? this._findProviderHandle("hover", languageId);
    }
    if (typeof providerHandle !== "number") return { ok: false, error: `no hover provider for language '${languageId}'` };

    const uriObj = this._uriForPath(path, authority);
    try {
      this.state.activePath = path;
      this.state.activeUri = uriObj?.external ?? uriObjToString(uriObj);
      this.state.activeLanguageId = languageFromPath(path) ?? null;
      this.state.lastOpenTs = Date.now();
    } catch {}

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideHover",
      args: [providerHandle, uriObj, { lineNumber, column }, undefined],
      cancellable: true,
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

  // ─── Completions ────────────────────────────────────────────────────
  async completions(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const lineNumber = Number(params.lineNumber ?? 1);
    const column = Number(params.column ?? 1);
    const timeoutMs = Number(params.timeoutMs ?? 10000);
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const triggerKind = Number(params.triggerKind ?? 0); // 0=Invoke, 1=TriggerCharacter, 2=TriggerForIncompleteCompletions
    const triggerCharacter = params.triggerCharacter ?? undefined;

    console.log(`[completions] path=${path} lang=${languageId} line=${lineNumber} col=${column} trigger=${triggerKind}`);

    // Pre-flight: sync document content so the ext host has the latest text.
    // The frontend's didChange may still be in-flight via Socket.IO when the
    // completion request arrives, causing the ext host to compute completions
    // against stale content (wrong ranges, wrong context).
    if (params.text != null && path) {
      try {
        this.didChange({ path, text: String(params.text), languageId, authority });
      } catch (e) {
        console.warn(`[completions] pre-flight didChange failed`, e.message);
      }
    }

    let providerHandle = params.providerHandle ?? this._findProviderHandle("completions", languageId);
    if (typeof providerHandle !== "number") {
      await waitFor(() => this._findProviderHandle("completions", languageId) != null, { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 });
      providerHandle = params.providerHandle ?? this._findProviderHandle("completions", languageId);
    }
    if (typeof providerHandle !== "number") return { ok: false, error: `no completions provider for language '${languageId}'` };

    const uriObj = this._uriForPath(path, authority);

    const context = { triggerKind };
    if (triggerCharacter != null) context.triggerCharacter = triggerCharacter;

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideCompletionItems",
      args: [providerHandle, uriObj, { lineNumber, column }, context],
      cancellable: true,
    });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for completions reply"));
        }
      }, timeoutMs + 5000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;

    if (rep.type === 9) {
      const raw = rep.result;
      if (!raw) return { ok: true, result: { items: [], isIncomplete: false } };
      const items = this._inflateCompletionItems(raw);
      const isIncomplete = !!raw.c;
      const cacheId = raw.x;
      return { ok: true, result: { items, isIncomplete, cacheId } };
    }
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }

  /** Inflate ISuggestResultDto minified fields to readable Monaco-compatible format. */
  _inflateCompletionItems(dto) {
    const completions = dto.b;
    if (!Array.isArray(completions)) return [];
    const defaultRanges = dto.a;
    console.log(`[completions] _inflate defaultRanges(dto.a)=${JSON.stringify(defaultRanges)} completions.length=${completions.length}`);
    if (completions.length > 0) {
      const c0 = completions[0];
      console.log(`[completions] _inflate item[0] a=${JSON.stringify(c0?.a)} j=${JSON.stringify(c0?.j)} f=${JSON.stringify(c0?.f)}`);
    }
    const items = [];
    for (const c of completions) {
      if (!c) continue;
      const item = {
        label: c.a ?? "",
        kind: c.b ?? 0,
        detail: c.c ?? undefined,
        documentation: c.d ?? undefined,
        sortText: c.e ?? undefined,
        filterText: c.f ?? undefined,
        preselect: c.g ?? undefined,
        insertText: c.h ?? (typeof c.a === "string" ? c.a : c.a?.label ?? ""),
        insertTextRules: c.i ?? undefined,
        range: c.j ?? defaultRanges ?? undefined,
        commitCharacters: c.k ?? undefined,
        additionalTextEdits: c.l ?? undefined,
        tags: c.m ?? undefined,
      };
      // Command is split across n/o/p
      if (c.n || c.o) {
        item.command = {
          $ident: c.n ?? undefined,
          id: c.o ?? "",
          arguments: c.p ?? undefined,
        };
      }
      items.push(item);
    }
    return items;
  }

  // ─── Semantic Tokens ────────────────────────────────────────────────
  async semanticTokens(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const timeoutMs = Number(params.timeoutMs ?? 10000);
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const previousResultId = params.previousResultId ?? "0";

    console.log(`[semanticTokens] path=${path} lang=${languageId} prevResultId=${previousResultId}`);

    let providerHandle = params.providerHandle ?? this._findProviderHandle("semanticTokens", languageId);
    if (typeof providerHandle !== "number") {
      await waitFor(() => this._findProviderHandle("semanticTokens", languageId) != null, { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 });
      providerHandle = params.providerHandle ?? this._findProviderHandle("semanticTokens", languageId);
    }
    if (typeof providerHandle !== "number") return { ok: false, error: `no semanticTokens provider for language '${languageId}'` };

    // Also retrieve the legend for this provider (needed by frontend)
    const providerEntry = this._providers.semanticTokens.get(providerHandle);
    const legend = providerEntry?.legend ?? null;

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideDocumentSemanticTokens",
      args: [providerHandle, uriObj, previousResultId],
      cancellable: true,
    });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for semanticTokens reply"));
        }
      }, timeoutMs + 5000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;

    // ★★★ SEMANTIC TOKENS RESPONSE ★★★
    const _stBufLen = rep.buffer ? rep.buffer.byteLength : 0;
    console.log(`★★★ [SEMANTIC_TOKENS_REPLY] type=${rep.type} req=${rep.req} bufBytes=${_stBufLen} hasResult=${!!rep.result} hasError=${!!rep.error} path=${path}`);

    // Type 8: ReplyOKVSBuffer — encodeSemanticTokensDto() encoded buffer
    // Format: [id:u32][type:u32(1=full,2=delta)][...payload] (little-endian)
    if (rep.type === 8 && rep.buffer) {
      const buf = rep.buffer;
      // Copy to aligned buffer to avoid RangeError on unaligned byteOffset
      const aligned = new Uint8Array(buf.byteLength);
      aligned.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      const src = new Uint32Array(aligned.buffer, 0, aligned.byteLength >>> 2);
      if (src.length < 2) return { ok: true, result: { type: "full", resultId: "", data: [], legend } };

      let offset = 0;
      const dtoId = src[offset++];
      const dtoType = src[offset++]; // 1 = full, 2 = delta

      if (dtoType === 1) {
        // Full: [dataLen:u32][...data:u32×dataLen]
        const dataLen = src[offset++];
        const data = Array.from(src.subarray(offset, offset + dataLen));
        console.log(`★★★ [SEMANTIC_TOKENS_DTO] full id=${dtoId} dataLen=${dataLen} tokens=${dataLen / 5}`);
        if (dataLen >= 5) {
          console.log(`★★★ [SEMANTIC_TOKENS_DATA] first tokens: [${data.slice(0, 20).join(', ')}]`);
        }
        return { ok: true, result: { type: "full", resultId: String(dtoId), data, legend } };
      }

      if (dtoType === 2) {
        // Delta: [deltaCount:u32][per delta: start:u32, deleteCount:u32, dataLen:u32, ...data:u32×dataLen]
        const deltaCount = src[offset++];
        const edits = [];
        for (let i = 0; i < deltaCount; i++) {
          const start = src[offset++];
          const deleteCount = src[offset++];
          const dataLen = src[offset++];
          let data;
          if (dataLen > 0) {
            data = Array.from(src.subarray(offset, offset + dataLen));
            offset += dataLen;
          }
          edits.push({ start, deleteCount, data });
        }
        console.log(`★★★ [SEMANTIC_TOKENS_DTO] delta id=${dtoId} edits=${edits.length}`);
        return { ok: true, result: { type: "delta", resultId: String(dtoId), edits, legend } };
      }

      // Unknown DTO type — log and return empty
      console.warn(`★★★ [SEMANTIC_TOKENS_DTO] unknown dtoType=${dtoType} id=${dtoId}`);
      return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
    }
    // Type 7: ReplyOKEmpty — no tokens available
    if (rep.type === 7) {
      return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
    }
    // Type 9: ReplyOKJSON — null means no tokens, or JSON DTO for delta/full
    if (rep.type === 9) {
      const raw = rep.result;
      if (!raw) return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
      const decoded = this._parseSemanticTokensDto(raw);
      decoded.legend = legend;
      return { ok: true, result: decoded };
    }
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }

  // ─── Semantic Tokens Range ──────────────────────────────────────────
  async semanticTokensRange(params = {}) {
    if (!this.ext?.protocol) throw new Error("not connected");
    const authority = String(params.authority ?? this._authority ?? DEFAULT_REMOTE_AUTHORITY);
    const path = String(params.path ?? "");
    const timeoutMs = Number(params.timeoutMs ?? 10000);
    const languageId = String(params.languageId || "") || _languageIdFromPath(path) || "plaintext";
    const range = params.range; // { startLineNumber, startColumn, endLineNumber, endColumn }

    if (!range) return { ok: false, error: "range is required for semanticTokensRange" };

    console.log(`${_hts()} [semanticTokensRange] path=${path} lang=${languageId} range=${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`);

    // Find a range provider specifically (range: true flag)
    let providerHandle = null;
    for (const entry of this._providers.semanticTokens.values()) {
      if (!entry.range) continue;
      if (!Array.isArray(entry.selector)) continue;
      for (const s of entry.selector) {
        if (s && typeof s === "object" && s.language === languageId) {
          providerHandle = entry.handle;
          break;
        }
      }
      if (providerHandle != null) break;
    }
    if (typeof providerHandle !== "number") {
      await waitFor(() => {
        for (const entry of this._providers.semanticTokens.values()) {
          if (!entry.range) continue;
          if (!Array.isArray(entry.selector)) continue;
          for (const s of entry.selector) {
            if (s && typeof s === "object" && s.language === languageId) return true;
          }
        }
        return false;
      }, { timeoutMs: Math.min(timeoutMs, 5000), intervalMs: 50 });
      for (const entry of this._providers.semanticTokens.values()) {
        if (!entry.range) continue;
        if (!Array.isArray(entry.selector)) continue;
        for (const s of entry.selector) {
          if (s && typeof s === "object" && s.language === languageId) {
            providerHandle = entry.handle;
            break;
          }
        }
        if (providerHandle != null) break;
      }
    }
    if (typeof providerHandle !== "number") return { ok: false, error: `no semanticTokensRange provider for language '${languageId}'` };

    const providerEntry = this._providers.semanticTokens.get(providerHandle);
    const legend = providerEntry?.legend ?? null;

    const uriObj = this._uriForPath(path, authority);

    const req = this._allocExtReqId();
    const payload = encodeExtRequestJsonArgs({
      req,
      rpcId: 94,
      method: "$provideDocumentRangeSemanticTokens",
      args: [providerHandle, uriObj, range],
      cancellable: true,
    });

    const fut = new Promise((resolve, reject) => {
      this._pendingExt.set(req, { resolve, reject });
      setTimeout(() => {
        if (this._pendingExt.has(req)) {
          this._pendingExt.delete(req);
          reject(new Error("timed out waiting for semanticTokensRange reply"));
        }
      }, timeoutMs + 5000);
    });

    this.ext.protocol.send(VSBuffer.wrap(payload));
    const rep = await fut;

    console.log(`${_hts()} ★★★ [SEMANTIC_TOKENS_RANGE_REPLY] type=${rep.type} req=${rep.req} bufBytes=${rep.buffer ? rep.buffer.byteLength : 0} path=${path} error=${rep.type === 11 ? JSON.stringify(rep.error)?.slice(0, 500) : "none"}`);

    // Type 8: DTO-encoded buffer (same format as full, but always type=full for range)
    if (rep.type === 8 && rep.buffer) {
      const buf = rep.buffer;
      // Copy to aligned buffer to avoid RangeError on unaligned byteOffset
      const aligned = new Uint8Array(buf.byteLength);
      aligned.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      const src = new Uint32Array(aligned.buffer, 0, aligned.byteLength >>> 2);
      if (src.length < 2) return { ok: true, result: { type: "full", resultId: "", data: [], legend } };

      let offset = 0;
      const dtoId = src[offset++];
      const dtoType = src[offset++];

      if (dtoType === 1) {
        const dataLen = src[offset++];
        const data = Array.from(src.subarray(offset, offset + dataLen));
        console.log(`★★★ [SEMANTIC_TOKENS_RANGE_DTO] full id=${dtoId} dataLen=${dataLen} tokens=${dataLen / 5}`);
        return { ok: true, result: { type: "full", resultId: String(dtoId), data, legend } };
      }
      return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
    }
    if (rep.type === 7) return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
    if (rep.type === 9) {
      const raw = rep.result;
      if (!raw) return { ok: true, result: { type: "full", resultId: "", data: [], legend } };
      const decoded = this._parseSemanticTokensDto(raw);
      decoded.legend = legend;
      return { ok: true, result: decoded };
    }
    if (rep.type === 11) return { ok: false, error: rep.error };
    return { ok: false, error: rep };
  }
  _parseSemanticTokensDto(dto) {
    const resultId = String(dto.id ?? dto.resultId ?? "");

    // Check if this is a full or delta response
    // Full: { id, type: 1, data: number[] }
    // Delta: { id, type: 2, deltas: [{ start, deleteCount, data?: number[] }] }
    if (dto.type === 2 || dto.edits || dto.deltas) {
      const edits = dto.deltas || dto.edits || [];
      return {
        type: "delta",
        resultId,
        edits: edits.map(e => ({
          start: e.start ?? 0,
          deleteCount: e.deleteCount ?? 0,
          data: e.data ? Array.from(e.data) : undefined,
        })),
      };
    }

    // Full response
    let data = dto.data;
    if (data && ArrayBuffer.isView(data)) {
      data = Array.from(new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4));
    } else if (Array.isArray(data)) {
      // Already a number array, keep as-is
    } else {
      data = [];
    }

    return {
      type: "full",
      resultId,
      data,
    };
  }

  /** Get the semantic tokens legend for a language (needed by frontend for provider registration). */
  async getSemanticTokensLegend(languageId) {
    let handle = this._findProviderHandle("semanticTokens", languageId);
    if (typeof handle !== "number") {
      // Provider may not have registered yet — wait briefly
      await waitFor(() => this._findProviderHandle("semanticTokens", languageId) != null, { timeoutMs: 8000, intervalMs: 100 });
      handle = this._findProviderHandle("semanticTokens", languageId);
    }
    if (typeof handle !== "number") return null;
    const entry = this._providers.semanticTokens.get(handle);
    return entry?.legend ?? null;
  }

  // ─── File Watcher IPC ────────────────────────────────────────────────
  async _setupFileWatcher(workspaceRoot) {
    if (!this._mgmtIpc) {
      console.log(`[watcher] no _mgmtIpc, skipping watcher setup`);
      return;
    }
    try {
      this._fsWatcherSub?.dispose?.();
      this._fsWatcherSub = null;
      const sessionId = crypto.randomUUID();
      console.log(`[watcher] setting up IPC listen on remoteFilesystem/fileChange sessionId=${sessionId}`);
      const sub = this._mgmtIpc.listen("remoteFilesystem", "fileChange", [sessionId]);
      console.log(`[watcher] listen() called, subscription created`);
      sub.event((changes) => {
        console.log(`[watcher] EVENT FIRED: ${JSON.stringify(changes)?.slice(0, 500)}`);
        if (Array.isArray(changes) && changes.length > 0) {
          const mapped = changes.map(c => ({
            type: c.type,
            path: c.resource?.path ?? c.resource?.fsPath ?? String(c.resource ?? ""),
          }));
          console.log(`[watcher] forwarding ${mapped.length} changes via onEvent`);
          this.onEvent({ type: "watcher/fileChanges", ts_ms: Date.now(), changes: mapped });
        } else if (typeof changes === "string" && changes.includes("ENOSPC")) {
          console.log(`[watcher] ENOSPC detected, forwarding watcher/enospc`);
          this.onEvent({ type: "watcher/enospc", ts_ms: Date.now(), message: changes });
        } else {
          console.log(`[watcher] EVENT received but not array or empty: type=${typeof changes} isArr=${Array.isArray(changes)}`);
        }
      });
      this._fsWatcherSub = sub;
      if (workspaceRoot) {
        const watchId = 1;
        const authority = this._useRemote ? this._authority : null;
        const rootUri = this._uriForPath(String(workspaceRoot), authority);
        console.log(`[watcher] calling watch() sessionId=${sessionId} watchId=${watchId} uri=${JSON.stringify(rootUri)}`);
        await this._mgmtIpc.call("remoteFilesystem", "watch", [sessionId, watchId, rootUri, { recursive: true, excludes: [] }]);
        this.onEvent({ type: "watcher/subscribed", ts_ms: Date.now(), root: String(workspaceRoot) });
        console.log(`[watcher] watch() call returned OK — subscribed to ${workspaceRoot}`);
      } else {
        console.log(`[watcher] no workspaceRoot, skipping watch() call`);
      }
    } catch (e) {
      this.onEvent({ type: "watcher/subscribe_error", ts_ms: Date.now(), error: String(e?.message ?? e) });
      console.log(`[watcher] subscribe error: ${e?.stack ?? e?.message ?? e}`);
    }
  }

  async resubscribeWatcher() {
    const root = this.state.workspaceFolder;
    console.log(`[watcher] resubscribeWatcher called, root=${root}`);
    await this._setupFileWatcher(root);
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
      this._fsWatcherSub?.dispose?.();
    } catch {}
    this._fsWatcherSub = null;

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
    this.state.mgmtConnected = false;
    this.state.extConnected = false;
    this.state.activePath = null;
    this.state.activeUri = null;
    this.state.activeLanguageId = null;
    this.state.lastOpenTs = null;
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
      completions: toList(this._providers.completions),
      semanticTokens: toList(this._providers.semanticTokens),
    };
  }

  /** Find provider handle matching a languageId by scanning selector arrays. */
  _findProviderHandle(type, languageId) {
    const map = this._providers[type];
    if (!map || !languageId) return null;
    for (const entry of map.values()) {
      if (!Array.isArray(entry.selector)) continue;
      for (const s of entry.selector) {
        if (s && typeof s === "object" && s.language === languageId) return entry.handle;
      }
    }
    return null;
  }

  /**
   * Replay cached provider registrations and session state via onEvent.
   * Called when a new frontend connects to an already-running adapter so it
   * receives the same events it would have seen during initial ext host boot.
   */
  resync() {
    const replayed = { semanticTokens: 0, hover: 0, completions: 0, documentSymbols: 0 };
    // Replay semantic token provider registrations
    for (const entry of this._providers.semanticTokens.values()) {
      const language = entry.selector?.[0]?.language ?? null;
      if (!language || !entry.legend) continue;
      this.onEvent({
        type: "provider/semanticTokens",
        ts_ms: Date.now(),
        handle: entry.handle,
        language,
        legend: entry.legend,
        range: !!entry.range,
        resync: true,
      });
      replayed.semanticTokens++;
    }
    console.error(`[resync] replayed providers: semTok=${replayed.semanticTokens}`);
    return { ok: true, ts_ms: Date.now(), replayed };
  }
}
