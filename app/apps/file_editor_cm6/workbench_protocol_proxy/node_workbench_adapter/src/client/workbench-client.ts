import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  DO NOT HARDCODE CONFIGURATION VALUES IN THIS FILE.                   ║
// ║  All extension / editor settings belong in User/settings.json         ║
// ║  (managed by the extension registry gate or the Custom Settings       ║
// ║  UI).  The adapter reads that file and relays it to the extension     ║
// ║  host.  No agent may add hardcoded config overrides here without      ║
// ║  the user's explicit, expressed permission.                           ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import { VSBuffer } from "../../vscode_oss_runtime/base/common/buffer.mjs";
import { NodeSocketFactory } from "../../vscode_oss_runtime/platform/remote/browser/browserSocketFactory.mjs";
import { ConnectionType, connectToRemoteAgent, createNoopSignService } from "../../vscode_oss_runtime/platform/remote/common/remoteAgentConnection.mjs";
import { IpcPromiseClient } from "../../vscode_oss_runtime/base/parts/ipc/common/ipc.mjs";
import {
  decodeExtHostRpc,
  encodeExtRequestJsonArgs,
  encodeExtRequestMixedArgs,
  isTerminalExtReply,
} from "../protocol/wire-encoding.mjs";
import type { DecodedExtHostRpc } from "../protocol/wire-encoding";
import { loadRpcIds } from "../protocol/rpc-ids.mjs";
import { PendingExtRequestOwner } from "../protocol/pending-requests.mjs";
import {
  handleExtHostReply,
  handleExtHostRequest,
} from "../protocol/ext-host-dispatch.mjs";
import {
  buildConfigurationInitData,
  buildSettingsSchema,
  extractExtensionConfigDefaults,
  getVirtualVscodeContent,
  readVirtualVscodeUriBuffer,
  statVirtualVscodeUri,
} from "./configuration.mjs";
import {
  connectManagementSession,
  discoverServerRootPath as discoverWorkbenchServerRootPath,
  commitFromServerRootPath as commitFromWorkbenchServerRootPath,
  loadProductVersionFromAppRoot as loadWorkbenchProductVersion,
} from "./management.mjs";
import {
  connectExtensionHostSession,
} from "./extension-host.mjs";
import {
  fsPathFromUri as fsPathFromLocalUri,
  provideTextDocumentContent as provideLocalTextDocumentContent,
  readLocalUriBuffer as readLocalDocumentBuffer,
  statLocalUri as statLocalDocumentUri,
  statPayloadFromFsStats as buildFsStatPayload,
  tryOpenDocument as openLocalDocument,
  uriForPath as buildUriForPath,
  uriObjToStringSafe as stringifyUriSafe,
} from "./document-content.mjs";
import {
  createCompletionRuntime,
  createConfigurationRuntime,
  createDocumentContentRuntime,
  createDocumentFeatureRuntime,
  createExtensionCatalogRuntime,
  createExtensionHostRuntime,
  createExtHostDispatchRuntime,
  createInlayHintsRuntime,
  createInlineCompletionRuntime,
  createManagementRuntime,
  createSemanticTokensRuntime,
  createTransportRuntime,
  createWorkspaceLifecycleRuntime,
} from "./runtime-adapters.mjs";
import type { RuntimeBuilderState } from "./runtime-adapters";
import {
  allocExtReqId,
  createExtPending,
  disconnectSession,
  sendExt,
  sendExtAwaitTerminalReply,
  sendExtMixed,
  sendExtPending,
  trackExtSent,
} from "./transport-session.mjs";
import type { TransportPendingOptions, TransportRuntime } from "./transport-session";
import type { ConfigurationRuntime, RawExtensionConfigDefaults } from "./configuration";
import type { DocumentContentRuntime, LocalFsStatsLike } from "./document-content";
import type { ExtensionHostRuntime } from "./extension-host";
import type { ManagementRuntime } from "./management";
import type { DidChangeOptions, LifecycleRuntime } from "../workspace/lifecycle";
import type { ExtHostInitOptions } from "../extensions/catalog";
import type { ProviderKind } from "../extensions/provider-registry";
import {
  buildExtensionsSnapshot,
  buildExtHostInitData,
  buildLanguageCatalog,
  extensionIdentifierFrom,
  sanitizeExtensionForInit,
  scanExtensionsFromDisk,
  workspaceFromFolder,
} from "../extensions/catalog.mjs";
import { ProviderRegistry } from "../extensions/provider-registry.mjs";
import {
  inflateCompletionItems,
  provideCompletions,
  provideCompletionSingle,
} from "../extensions/intelligence/completions.mjs";
import {
  provideInlayHints,
  releaseInlayHints,
  resolveInlayHint,
} from "../extensions/intelligence/inlay-hints.mjs";
import {
  freeInlineCompletions,
  handleInlineCompletionDidShow,
  provideInlineCompletions,
} from "../extensions/intelligence/inline-completions.mjs";
import {
  provideHover,
  provideHoverSingle,
} from "../extensions/intelligence/hover.mjs";
import {
  getSemanticTokensLegend as loadSemanticTokensLegend,
  parseSemanticTokensDto,
  parseSemanticTokensReply,
  provideSemanticTokens,
  provideSemanticTokensRange,
  provideSemanticTokensSingle,
} from "../extensions/intelligence/semantic-tokens.mjs";
import {
  provideDocumentSymbols,
  provideDocumentSymbolsSingle,
  provideFoldingRanges,
  provideFoldingRangesSingle,
} from "../extensions/intelligence/structure.mjs";
import {
  didChange as applyDidChange,
  openFile as openWorkbenchFile,
  resubscribeWatcher as resubscribeWorkbenchWatcher,
  setupFileWatcher as setupWorkbenchWatcher,
  switchWorkspace as switchWorkbenchWorkspace,
} from "../workspace/lifecycle.mjs";

type WorkbenchEventSink = (payload: Record<string, unknown>) => void;
type MgmtIpcLike = NonNullable<ManagementRuntime["refs"]["mgmtIpc"]>;
type MgmtSessionLike = ManagementRuntime["refs"]["mgmt"];
type ExtSessionLike = ExtensionHostRuntime["refs"]["ext"];
type WatchSubscriptionLike = LifecycleRuntime["watcher"]["fsWatcherSub"];
type ExtHandshakeState = ExtensionHostRuntime["refs"]["extHandshake"];
type ExtTraceState = ExtensionHostRuntime["refs"]["extMsgTrace"];

function _hts() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`; }
const DEFAULT_CODE_SERVER_SOCKET_PATH = String(process.env.TE2_CODE_SERVER_SOCKET ?? "").trim() || null;
const DEFAULT_CODE_SERVER_HTTP = process.env.TE2_CODE_SERVER_HTTP ?? "http://localhost";
const DEFAULT_REMOTE_AUTHORITY = process.env.TE2_REMOTE_AUTHORITY ?? "localhost";
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
const PARSE_ARGS_ONLY_METHODS = new Set<string>([
  // Provider registration + minimal main-thread contract methods.
  "$registerHoverProvider",
  "$registerDocumentSymbolProvider",
  "$registerCompletionsProvider",
  "$registerInlayHintsProvider",
  "$registerInlineCompletionsSupport",
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

  // File system + content provider methods (need parsed URIs).
  "$readFile",
  "$stat",
  "$tryOpenDocument",
  "$registerTextDocumentContentProvider",
]);
for (const s of String(process.env.TE2_PARSE_ARGS_ONLY_METHODS || "").split(",")) {
  const v = s.trim();
  if (v) PARSE_ARGS_ONLY_METHODS.add(v);
}

const SKIP_ARGS_PARSE_METHODS = new Set<string>();
for (const s of String(process.env.TE2_SKIP_ARGS_PARSE_METHODS || "").split(",")) {
  const v = s.trim();
  if (v) SKIP_ARGS_PARSE_METHODS.add(v);
}

function _shouldParseArgsForMethod(method: string): boolean {
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

const _loadedRpcIds = loadRpcIds({
  env: process.env,
  homeDir: process.env.HOME || "",
  readText: (filePath) => readFileSync(filePath, "utf8"),
  joinPath: path.join,
  log: (message) => console.log(message),
});
const _rpcIds = _loadedRpcIds.ids;
const _rpcConfigSource = _loadedRpcIds.source;

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  pred: () => boolean,
  { timeoutMs = 8000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
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

function _coerceOptionalGeneration(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function memSnapshot(): Record<string, number> {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heap_total: m.heapTotal,
    heap_used: m.heapUsed,
    external: m.external,
    array_buffers: m.arrayBuffers ?? 0,
  };
}

function logMetrics(type: string, data: Record<string, unknown>): void {
  if (!DEBUG_METRICS) return;
  try {
    console.log(JSON.stringify({ type, ts_ms: Date.now(), ...data }));
  } catch {}
}

function spanTrace<T>(name: string, fn: () => T): T {
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

async function spanTraceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
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
        console.log(JSON.stringify({ type: "span", ts_ms: Date.now(), name, dur_ms: dur, ok: false, err: e instanceof Error ? e.message : String(e), mem: memSnapshot() }));
      } catch {}
    }
    throw e;
  }
}

function _shouldSkipSize(obj: unknown, maxItems: number): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.length > maxItems;
  return Object.keys(obj).length > maxItems;
}

function _jsonSizeOrSkip(obj: unknown, maxItems: number): Record<string, unknown> {
  if (!INIT_SIZE_PROFILE) return { skipped: true };
  if (_shouldSkipSize(obj, maxItems)) return { skipped: true, reason: "too_many_items" };
  try {
    const s = JSON.stringify(obj);
    return { size: s.length };
  } catch (e) {
    return { skipped: true, reason: "stringify_error" };
  }
}


const _EXT_TO_LANG: Record<string, string> = {
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
function _languageIdFromPath(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const base = String(filePath).split("/").pop() || "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return _EXT_TO_LANG[base.slice(dot).toLowerCase()] || "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const WORKSPACE_CONTAINS_MAX_ENTRIES = 25000;
const WORKSPACE_CONTAINS_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "node_modules",
  "target",
  "build",
  "dist",
]);

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field ? field : null;
}

function workspaceFolderPath(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const uri = isRecord(value.uri) ? value.uri : value;
  return stringField(uri, "fsPath") || stringField(uri, "path");
}

function workspaceContainsPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/"));
}

function hasGlobMagic(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function escapeRegExpChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? "";
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExpChar(char);
  }
  source += "$";
  return new RegExp(source);
}

function maxDepthForGlob(pattern: string): number {
  if (pattern.includes("**")) return 12;
  return Math.max(1, pattern.split("/").length);
}

async function workspaceGlobExists(root: string, pattern: string): Promise<boolean> {
  const regex = globPatternToRegExp(pattern);
  const maxDepth = maxDepthForGlob(pattern);
  let visited = 0;

  async function walk(dir: string, relParent: string, depth: number): Promise<boolean> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > WORKSPACE_CONTAINS_MAX_ENTRIES) return false;
      const rel = relParent ? `${relParent}/${entry.name}` : entry.name;
      if (regex.test(rel)) return true;
      if (!entry.isDirectory()) continue;
      if (WORKSPACE_CONTAINS_SKIP_DIRS.has(entry.name)) continue;
      if (pattern.includes("**") || depth + 1 < maxDepth) {
        if (await walk(path.join(dir, entry.name), rel, depth + 1)) return true;
      }
    }
    return false;
  }

  return walk(root, "", 0);
}

async function workspacePatternExists(root: string, pattern: string): Promise<boolean> {
  if (!pattern) return false;
  if (!hasGlobMagic(pattern)) return existsSync(path.join(root, pattern));
  return workspaceGlobExists(root, pattern);
}

function externalUriString(uriObj: unknown): string | null {
  if (!isRecord(uriObj)) return null;
  return typeof uriObj.external === "string" ? uriObj.external : null;
}

function isTransportMgmtProtocol(value: unknown): value is NonNullable<TransportRuntime["refs"]["mgmtProtocol"]> {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function isWatchSubscription(value: unknown): value is NonNullable<WatchSubscriptionLike> {
  if (!isRecord(value)) return false;
  return typeof value["event"] === "function";
}

export class WorkbenchClient {
  onEvent: WorkbenchEventSink;
  mgmt: MgmtSessionLike;
  ext: ExtSessionLike;
  _mgmtIpc: MgmtIpcLike | null;
  _fsWatcherSub: WatchSubscriptionLike;
  _connecting: boolean;
  _extRequests: PendingExtRequestOwner;
  _signService: unknown;
  _debugExtReqSeen: number;
  _debugExtReplySeen: number;
  _debugMainThreadReplySeen: number;
  _extHandshake: ExtHandshakeState;
  _nextModelNumber: number;
  _activeEditorId: string | null;
  _activeUriObj: unknown;
  _activeTab: unknown;
  _backgroundDocuments: Set<string>;
  _docVersions: Map<string, number>;
  _docLineCount: Map<string, number>;
  _docCharCount: Map<string, number>;
  _docLastLineLength: Map<string, number>;
  _docOpenGeneration: Map<string, number | string | null>;
  _extensions: unknown[];
  _providerRegistry: ProviderRegistry;
  _useRemote: boolean;
  _authority: string;
  _productVersion: string | null;
  _rawExtensionConfigs: RawExtensionConfigDefaults | null;
  _metricsTimer: NodeJS.Timeout | null;
  _extMsgTrace: ExtTraceState;
  _extMsgCount: number;
  _languageCatalogCache: Record<string, unknown> | null;
  state: RuntimeBuilderState;

  constructor({ onEvent }: { onEvent?: WorkbenchEventSink } = {}) {
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.mgmt = null; // { protocol }
    this.ext = null; // { protocol }
    this._mgmtIpc = null;
    this._fsWatcherSub = null; // IPC event subscription for remoteFilesystem fileChange
    this._connecting = false;
    this._extRequests = new PendingExtRequestOwner();
    this._signService = createNoopSignService();
    this._debugExtReqSeen = 0;
    this._debugExtReplySeen = 0;
    this._debugMainThreadReplySeen = 0;
    this._extHandshake = { readySeen: false, initSent: false, initialized: false };
    this._nextModelNumber = 1;
    this._activeEditorId = null;   // track current editor for close-before-open
    this._activeUriObj = null;     // track current URI object for close-before-open
    this._backgroundDocuments = new Set(); // uri string -> addedDocuments sent without active editor churn
    this._docVersions = new Map(); // path -> versionId for didChange tracking
    this._docLineCount = new Map(); // path -> line count for didChange range
    this._docCharCount = new Map(); // path -> char count for didChange rangeLength
    this._docLastLineLength = new Map(); // path -> length of last line (for valid endColumn)
    this._docOpenGeneration = new Map(); // path -> generation token from open_file flow
    this._extensions = []; // sanitized extensions (populated after connect)
    this._providerRegistry = new ProviderRegistry();
    this._useRemote = true;
    this._authority = DEFAULT_REMOTE_AUTHORITY;
    this._productVersion = null;
    this._rawExtensionConfigs = null;
    this._metricsTimer = null;
    this._extMsgTrace = {
      enabled: EXT_MSG_TRACE,
      seen: 0,
      bytes: 0,
      maxBytes: 0,
      lastTs: 0,
    };
    this._extMsgCount = 0;
    this._languageCatalogCache = null;
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
            pending_ext: this._extRequests?.pendingSize ?? 0,
            sent_ext_meta: this._extRequests?.sentMetaSize ?? 0,
          });
        }, 1000);
        this._metricsTimer.unref?.();
      } catch {}
    }
  }

  async _loadProductVersionFromAppRoot(envData: unknown): Promise<string | null> {
    const thisOwner = this;
    return loadWorkbenchProductVersion({
      refs: {
        get productVersion() { return thisOwner._productVersion; },
        set productVersion(value) { thisOwner._productVersion = value; },
      },
      readTextFile: (filePath: string) => fs.readFile(filePath, "utf8"),
      joinPath: (...parts: string[]) => path.join(...parts),
      log: (...args: unknown[]) => console.log(...args),
    }, envData);
  }

  _allocExtReqId(): number {
    return allocExtReqId(this._transportRuntime());
  }

  _trackExtSent(req: number, rpcId: number, method: string): void {
    return trackExtSent(this._transportRuntime(), req, rpcId, method);
  }

  _createExtPending(req: number, options: { timeoutMs: number; timeoutMessage: string; timeoutResult?: unknown; accept?: (message: Record<string, unknown>) => boolean }): Promise<unknown> {
    return createExtPending(this._transportRuntime(), req, options);
  }

  _sendExt(rpcId: number, method: string, args: unknown[], cancellable = false): number {
    return sendExt(this._transportRuntime(), rpcId, method, args, cancellable);
  }

  _sendExtPending(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable = false,
    pendingOptions: TransportPendingOptions = {},
    eventExtra: Record<string, unknown> = {},
  ): { req: number; promise: Promise<unknown> } {
    return sendExtPending(this._transportRuntime(), rpcId, method, args, cancellable, pendingOptions, eventExtra);
  }

  _isTerminalExtReply(msg: unknown): boolean {
    return isTerminalExtReply(msg) && msg.type !== 12;
  }

  _sendExtAwaitTerminalReply(rpcId: number, method: string, args: unknown[], cancellable = false, timeoutMs = 3000): { req: number; promise: Promise<unknown> } {
    return sendExtAwaitTerminalReply(this._transportRuntime(), rpcId, method, args, cancellable, timeoutMs);
  }

  _completionRuntime() {
    return createCompletionRuntime({
      extProtocol: this.ext?.protocol ?? null,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      languageIdFromPath: (filePath) => _languageIdFromPath(filePath),
      didChange: (params, opts) => this.didChange(params, opts),
      findAllProviderHandles: (kind, languageId) => this._findAllProviderHandles(kind, languageId),
      waitFor: (condition, options) => waitFor(condition, options),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) => this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      log: (message) => console.log(message),
      warn: (message, detail) => console.warn(message, detail),
    });
  }

  _inlineCompletionRuntime() {
    return createInlineCompletionRuntime({
      extProtocol: this.ext?.protocol ?? null,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      languageIdFromPath: (filePath) => _languageIdFromPath(filePath),
      didChange: (params, opts) => this.didChange(params, opts),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) => this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      sendExtAwaitTerminalReply: (rpcId, method, args, cancellable, timeoutMs) => this._sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs),
      log: (message) => console.log(message),
      warn: (message, detail) => console.warn(message, detail),
    });
  }

  _inlayHintsRuntime() {
    return createInlayHintsRuntime({
      extProtocol: this.ext?.protocol ?? null,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      languageIdFromPath: (filePath) => _languageIdFromPath(filePath),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) => this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      sendExtAwaitTerminalReply: (rpcId, method, args, cancellable, timeoutMs) => this._sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs),
      log: (message) => console.log(message),
      warn: (message, detail) => console.warn(message, detail),
    });
  }

  _semanticTokensRuntime() {
    return createSemanticTokensRuntime({
      extProtocol: this.ext?.protocol ?? null,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      languageIdFromPath: (filePath) => _languageIdFromPath(filePath),
      didChange: (params, opts) => this.didChange(params, opts),
      findAllProviderHandles: (kind, languageId) => this._findAllProviderHandles(kind, languageId),
      findSemanticRangeHandles: (languageId) => this._providerRegistry.findSemanticRangeHandles(languageId),
      waitFor: (condition, options) => waitFor(condition, options),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) => this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      getProvider: (kind, handle) => this._providerRegistry.getProvider(kind, handle),
      log: (message) => console.log(message),
      warn: (message) => console.warn(message),
      timeLabel: () => _hts(),
    });
  }

  _documentFeatureRuntime() {
    return createDocumentFeatureRuntime({
      extProtocol: this.ext?.protocol ?? null,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      languageIdFromPath: (filePath) => _languageIdFromPath(filePath),
      getDocumentVersion: (path) => this._docVersions.get(path) ?? null,
      getOpenGeneration: (path) => this._docOpenGeneration.get(path),
      // Provider calls are consumers of the active-document lifecycle, not owners.
      // Let openFile()/didChange() remain the only state writers for activePath/Uri.
      updateActiveDocument: () => {},
      selectorGroupsSummary: (kind) => this._providerRegistry.selectorGroupsSummary(kind),
      findAllProviderHandles: (kind, languageId) => this._findAllProviderHandles(kind, languageId),
      waitFor: (condition, options) => waitFor(condition, options),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) => this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      documentSymbolsRpcId: 94,
      foldingRangesRpcId: _rpcIds.ExtHostLanguageFeatures,
      hoverRpcId: 94,
      log: (...args) => console.log(...args),
    });
  }

  _workspaceLifecycleRuntime() {
    return createWorkspaceLifecycleRuntime({
      extProtocol: this.ext?.protocol ?? null,
      state: this.state,
      activeEditorId: this._activeEditorId,
      setActiveEditorId: (value) => { this._activeEditorId = value; },
      activeUriObj: this._activeUriObj,
      setActiveUriObj: (value) => { this._activeUriObj = value; },
      activeTab: this._activeTab,
      setActiveTab: (value) => { this._activeTab = value; },
      nextModelNumber: this._nextModelNumber,
      setNextModelNumber: (value) => { this._nextModelNumber = value; },
      docVersions: this._docVersions,
      docLineCount: this._docLineCount,
      docCharCount: this._docCharCount,
      docLastLineLength: this._docLastLineLength,
      docOpenGeneration: this._docOpenGeneration,
      mgmtIpc: this._mgmtIpc,
      setMgmtIpc: (value) => { this._mgmtIpc = value === null ? null : this._mgmtIpc; },
      fsWatcherSub: this._fsWatcherSub,
      setFsWatcherSub: (value) => { this._fsWatcherSub = value; },
      useRemote: this._useRemote,
      authority: String(this._authority ?? DEFAULT_REMOTE_AUTHORITY),
      extRpcIds: {
        ExtHostDocumentsAndEditors: _rpcIds.ExtHostDocumentsAndEditors,
        ExtHostDocuments: _rpcIds.ExtHostDocuments,
        ExtHostEditors: _rpcIds.ExtHostEditors,
        ExtHostEditorTabs: _rpcIds.ExtHostEditorTabs,
        ExtHostExtensionService: _rpcIds.ExtHostExtensionService,
        ExtHostWorkspace: _rpcIds.ExtHostWorkspace,
      },
      readTextFile: (path) => fs.readFile(path, "utf8"),
      uriForPath: (path, authority) => this._uriForPath(path, authority),
      uriToString: (uri) => this._uriObjToStringSafe(uri),
      languageIdFromPath: (path) => _languageIdFromPath(path),
      sendExt: (rpcId, method, args, cancellable = false) => this._sendExt(rpcId, method, args, cancellable),
      sendExtAwaitTerminalReply: (rpcId, method, args, cancellable = false, timeoutMs = 3000) =>
        this._sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs),
      spanTrace: (name, fn) => spanTrace(name, fn),
      spanTraceAsync: (name, fn) => spanTraceAsync(name, fn),
      logMetrics: (type, data) => logMetrics(type, data),
      onEvent: (payload) => this.onEvent(payload),
      sha1Short: (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 7),
      randomUuid: () => crypto.randomUUID(),
      log: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    });
  }

  _transportRuntime() {
    return createTransportRuntime({
      requestOwner: this._extRequests,
      extProtocol: this.ext?.protocol ?? null,
      mgmtProtocol: isTransportMgmtProtocol(this.mgmt?.protocol) ? this.mgmt.protocol : null,
      mgmtIpc: this._mgmtIpc,
      fsWatcherSub: this._fsWatcherSub,
      state: this.state,
      encodeJsonRequest: (input) => encodeExtRequestJsonArgs(input),
      encodeMixedRequest: (input) => encodeExtRequestMixedArgs(input),
      wrapPayload: (payload) => VSBuffer.wrap(payload),
      onEvent: (payload) => this.onEvent(payload),
      nowMs: () => Date.now(),
      setFsWatcherSub: (value) => { this._fsWatcherSub = isWatchSubscription(value) ? value : null; },
      setMgmtIpc: (value) => { this._mgmtIpc = value === null ? null : this._mgmtIpc; },
      setMgmtProtocol: (value) => { this.mgmt = value ? { protocol: value } : null; },
      setExtProtocol: (value) => { this.ext = value ? { protocol: value as NonNullable<ExtSessionLike>["protocol"] } : null; },
      resetHandshake: () => { this._extHandshake = { readySeen: false, initSent: false, initialized: false }; },
      resetConnecting: () => { this._connecting = false; },
      clearLanguageCatalogCache: () => { this._languageCatalogCache = null; },
    });
  }

  _documentContentRuntime() {
    return createDocumentContentRuntime({
      extProtocol: this.ext?.protocol ?? null,
      useRemote: this._useRemote,
      authority: this._authority,
      defaultRemoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      extHostDocumentContentProvidersRpcId: _rpcIds.ExtHostDocumentContentProviders,
      extHostDocumentsAndEditorsRpcId: _rpcIds.ExtHostDocumentsAndEditors,
      backgroundDocuments: this._backgroundDocuments,
      readTextFile: (path) => fs.readFile(path, "utf8"),
      readBinaryFile: (path) => fs.readFile(path),
      statPath: (path) => fs.lstat(path),
      languageIdFromPath: (path) => _languageIdFromPath(path),
      sendExt: (rpcId, method, args, cancellable = false) => this._sendExt(rpcId, method, args, cancellable),
      sendExtPending: (rpcId, method, args, cancellable, pendingOptions) =>
        this._sendExtPending(rpcId, method, args, cancellable, pendingOptions),
      log: (...args) => console.log(...args),
    });
  }

  _sendExtMixed(rpcId: number, method: string, args: unknown[], cancellable = false): number {
    return sendExtMixed(this._transportRuntime(), rpcId, method, args, cancellable);
  }

  status() {
    return { ...this.state };
  }

  getExtensions() {
    return this._extensions;
  }

  _extensionCatalogRuntime() {
    return createExtensionCatalogRuntime({
      env: process.env,
      extensions: this._extensions,
      productVersion: this._productVersion,
      rawExtensionConfigs: this._rawExtensionConfigs,
      readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
      joinPath: (...parts) => path.join(...parts),
      readTextFileSync: (filePath) => readFileSync(filePath, "utf8"),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      randomUuid: () => crypto.randomUUID(),
      sha1Short: (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 7),
      logMetrics: (type, data) => logMetrics(type, { ...data, mem: memSnapshot() }),
      log: (...args) => console.log(...args),
    });
  }

  _configurationRuntime() {
    return createConfigurationRuntime({
      env: process.env,
      extensions: this._extensions,
      productVersion: this._productVersion,
      rawExtensionConfigs: this._rawExtensionConfigs ?? null,
      readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
      joinPath: (...parts) => path.join(...parts),
      readTextFileSync: (filePath) => readFileSync(filePath, "utf8"),
      uriForPath: (filePath, authority) => this._uriForPath(filePath, authority),
      randomUuid: () => crypto.randomUUID(),
      sha1Short: (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 7),
      logMetrics: (type, data) => logMetrics(type, { ...data, mem: memSnapshot() }),
      log: (...args) => console.log(...args),
    });
  }

  _managementRuntime() {
    return createManagementRuntime({
      env: process.env,
      mgmt: this.mgmt,
      setMgmt: (value) => { this.mgmt = value; },
      mgmtIpc: this._mgmtIpc,
      setMgmtIpc: (value) => { this._mgmtIpc = value; },
      useRemote: this._useRemote,
      setUseRemote: (value) => { this._useRemote = value; },
      authority: this._authority,
      setAuthority: (value) => { this._authority = value; },
      productVersion: this._productVersion,
      setProductVersion: (value) => { this._productVersion = value; },
      rawExtensionConfigs: this._rawExtensionConfigs,
      setRawExtensionConfigs: (value) => { this._rawExtensionConfigs = value; },
      extensions: this._extensions,
      setExtensions: (value) => { this._extensions = value; },
      state: this.state,
      defaults: {
        codeServerHttp: DEFAULT_CODE_SERVER_HTTP,
        codeServerSocketPath: DEFAULT_CODE_SERVER_SOCKET_PATH,
        remoteAuthority: DEFAULT_REMOTE_AUTHORITY,
      },
      signService: this._signService,
      connectionTypes: {
        Management: ConnectionType.Management,
      },
      createSocketFactory: (options) => new NodeSocketFactory(options),
      connectRemoteAgent: (options) => connectToRemoteAgent(options),
      createMgmtIpc: (protocol, authority) => new IpcPromiseClient(protocol, { remoteAuthority: authority, clientId: "renderer" }),
      randomUuid: () => crypto.randomUUID(),
      spanTraceAsync: (name, fn) => spanTraceAsync(name, fn),
      discoverServerRootPath: (httpBase, folder, socketPath) => this._discoverServerRootPath(httpBase, folder, socketPath),
      commitFromServerRootPath: (serverRootPath) => this._commitFromServerRootPath(serverRootPath),
      scanExtensionsFromDisk: (authority) => this._scanExtensionsFromDisk(authority),
      extractExtensionConfigDefaults: (scannedExtensions) => this._extractExtensionConfigDefaults(scannedExtensions),
      sanitizeExtensionForInit: (ext, authority) => this._sanitizeExtensionForInit(ext, authority),
      extensionIdentifierFrom: (ext) => this._extensionIdentifierFrom(ext),
      loadProductVersionFromAppRoot: (envData) => this._loadProductVersionFromAppRoot(envData),
      buildExtHostInitData: (options) => this._buildExtHostInitData(options),
      setupFileWatcher: (workspaceRoot) => this._setupFileWatcher(workspaceRoot),
      onEvent: (payload) => this.onEvent(payload),
      log: (...args) => console.log(...args),
    });
  }

  _extensionHostRuntime() {
    return createExtensionHostRuntime({
      state: this.state,
      ext: this.ext,
      setExt: (value) => { this.ext = value; },
      signService: this._signService,
      connectionTypes: {
        ExtensionHost: ConnectionType.ExtensionHost,
        ExtHostConfiguration: _rpcIds.ExtHostConfiguration,
        ExtHostFileSystemInfo: _rpcIds.ExtHostFileSystemInfo,
        ExtHostLanguageFeatures: _rpcIds.ExtHostLanguageFeatures,
        ExtHostLanguages: _rpcIds.ExtHostLanguages,
        ExtHostOutputService: _rpcIds.ExtHostOutputService,
        ExtHostStatusBar: _rpcIds.ExtHostStatusBar,
        ExtHostDocumentsAndEditors: _rpcIds.ExtHostDocumentsAndEditors,
        ExtHostEditorTabs: _rpcIds.ExtHostEditorTabs,
        ExtHostExtensionService: _rpcIds.ExtHostExtensionService,
        ExtHostWorkspace: _rpcIds.ExtHostWorkspace,
      },
      bootstrapLanguageIds: BOOTSTRAP_LANGUAGE_IDS,
      rpcConfigSource: _rpcConfigSource,
      extMsgTraceEvery: EXT_MSG_TRACE_EVERY,
      extMsgTraceMax: EXT_MSG_TRACE_MAX,
      initSizeProfile: INIT_SIZE_PROFILE,
      initSizeMaxItems: INIT_SIZE_MAX_ITEMS,
      extHandshake: this._extHandshake,
      setExtHandshake: (value) => { this._extHandshake = value; },
      extMsgTrace: this._extMsgTrace,
      setExtMsgTrace: (value) => { this._extMsgTrace = value; },
      extMsgCount: this._extMsgCount ?? 0,
      setExtMsgCount: (value) => { this._extMsgCount = value; },
      debugExtReqSeen: this._debugExtReqSeen,
      setDebugExtReqSeen: (value) => { this._debugExtReqSeen = value; },
      connectRemoteAgent: (options) => connectToRemoteAgent(options),
      randomUuid: () => crypto.randomUUID(),
      spanTrace: (name, fn) => spanTrace(name, fn),
      spanTraceAsync: (name, fn) => spanTraceAsync(name, fn),
      logMetrics: (type, data) => logMetrics(type, data),
      memSnapshot: () => memSnapshot(),
      jsonSizeOrSkip: (value, maxItems) => _jsonSizeOrSkip(value, maxItems),
      onEvent: (payload) => this.onEvent(payload),
      sendExtInitText: (text) => { this.ext?.protocol.send(VSBuffer.fromString(text)); },
      decodeExtMessage: (payload) => decodeExtHostRpc(payload, {
        shouldParseArgsForMethod: _shouldParseArgsForMethod,
        maxJsonBytes: MAX_JSON_BYTES,
        log: (message) => console.log(message),
      }),
      handleDecodedExtMessage: (message) => {
        if (message.type === 1 || message.type === 2 || message.type === 3 || message.type === 4) {
          handleExtHostRequest(this._extHostDispatchRuntime(), message);
          return;
        }
        if (message.type === 7 || message.type === 8 || message.type === 9 || message.type === 10 || message.type === 11 || message.type === 12) {
          handleExtHostReply(this._extHostDispatchRuntime(), message);
        }
      },
      buildConfigurationInitData: (folder, authority) => this._buildConfigurationInitData(folder, authority),
      sendExt: (rpcId, method, args, cancellable = false) => this._sendExt(rpcId, method, args, cancellable),
      uriForPath: (path, authority) => this._uriForPath(path, authority),
      sha1Short: (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 7),
      resetExtRequestIds: () => this._extRequests.resetReqIds(),
      log: (...args) => console.log(...args),
    });
  }

  _extHostDispatchRuntime() {
    return createExtHostDispatchRuntime({
      state: this.state,
      providerRegistry: this._providerRegistry,
      requestOwner: this._extRequests,
      replyDropMethods: REPLY_DROP_METHODS,
      replyEmptyMethods: REPLY_EMPTY_METHODS,
      replyNullMethods: REPLY_NULL_METHODS,
      mainThreadOutputServiceRpcId: _rpcIds.MainThreadOutputService,
      extHostWorkspaceRpcId: _rpcIds.ExtHostWorkspace,
      debugExtReqSeen: this._debugExtReqSeen,
      setDebugExtReqSeen: (value) => { this._debugExtReqSeen = value; },
      debugExtReplySeen: this._debugExtReplySeen,
      setDebugExtReplySeen: (value) => { this._debugExtReplySeen = value; },
      debugMainThreadReplySeen: this._debugMainThreadReplySeen,
      setDebugMainThreadReplySeen: (value) => { this._debugMainThreadReplySeen = value; },
      onEvent: (payload) => this.onEvent(payload),
      sendPayload: (payload) => {
        try {
          this.ext?.protocol.send(VSBuffer.wrap(payload));
        } catch {}
      },
      sendExt: (rpcId, method, args, cancellable = false) => this._sendExt(rpcId, method, args, cancellable),
      checkWorkspaceExists: (folders, includes) => this._checkWorkspaceExists(folders, includes),
      tryOpenDocument: (uri, options) => this._tryOpenDocument(uri, isRecord(options) ? options : {}),
      provideTextDocumentContent: (handle, uri) => this._provideTextDocumentContent(handle, uri),
      readVirtualVscodeUriBuffer: (uri) => this._readVirtualVscodeUriBuffer(uri),
      statVirtualVscodeUri: (uri) => this._statVirtualVscodeUri(uri),
      fsPathFromUri: (uri) => this._fsPathFromUri(uri),
      readLocalUriBuffer: (uri) => this._readLocalUriBuffer(uri),
      statLocalUri: (uri) => this._statLocalUri(uri),
      uriObjToStringSafe: (uri) => this._uriObjToStringSafe(uri),
      log: (...args) => console.log(...args),
    });
  }

  async _checkWorkspaceExists(folders: unknown, includes: unknown): Promise<boolean> {
    const roots = Array.isArray(folders)
      ? folders.map((folder) => workspaceFolderPath(folder)).filter((folder): folder is string => !!folder)
      : [];
    const patterns = workspaceContainsPatterns(includes);
    if (!roots.length || !patterns.length) {
      console.log(`[workspaceContains] $checkExists skip roots=${roots.length} patterns=${patterns.length}`);
      return false;
    }

    for (const root of roots) {
      for (const pattern of patterns) {
        if (await workspacePatternExists(root, pattern)) {
          console.log(`[workspaceContains] $checkExists match root=${root} pattern=${pattern}`);
          return true;
        }
      }
    }

    console.log(`[workspaceContains] $checkExists miss roots=${JSON.stringify(roots)} patterns=${JSON.stringify(patterns)}`);
    return false;
  }

  /**
   * Ask the ext host to provide content for a virtual document URI.
   * @param {number} handle - The content provider handle (from $registerTextDocumentContentProvider).
   * @param {object} uri - The URI object to resolve.
   * @returns {Promise<string|null>} The document content or null.
   */
  async _provideTextDocumentContent(handle: number, uri: unknown): Promise<string | null> {
    return provideLocalTextDocumentContent(this._documentContentRuntime(), handle, uri);
  }

  async _discoverServerRootPath(httpBase: string, folder: string | null, socketPath: string | null): Promise<string> {
    return discoverWorkbenchServerRootPath(httpBase, folder, socketPath);
  }

  _commitFromServerRootPath(serverRootPath: string): string | null {
    return commitFromWorkbenchServerRootPath(serverRootPath);
  }

  _buildExtensionsSnapshot(scannedExtensions: unknown[]): Record<string, unknown> {
    return buildExtensionsSnapshot(scannedExtensions, {
      env: process.env,
      excludeIds: EXT_EXCLUDE_IDS,
      log: (...args) => console.log(...args),
    });
  }

  _sanitizeExtensionForInit(ext: unknown, authority: string | null): Record<string, unknown> | null {
    return sanitizeExtensionForInit(ext, authority, process.env);
  }

  async _scanExtensionsFromDisk(authority: string | null): Promise<Record<string, unknown>[]> {
    return scanExtensionsFromDisk(this._extensionCatalogRuntime(), authority);
  }

  _extensionIdentifierFrom(ext: unknown): string | null {
    return extensionIdentifierFrom(ext);
  }

  _workspaceFromFolder(folder: string | null, authority: string | null): Record<string, unknown> | null {
    void authority;
    return workspaceFromFolder(this._extensionCatalogRuntime(), folder);
  }

  _uriForPath(pathStr: string, authority: string | null = this._authority): Record<string, unknown> {
    return buildUriForPath(this._useRemote, pathStr, authority ?? DEFAULT_REMOTE_AUTHORITY);
  }

  _uriObjToStringSafe(uri: unknown): string {
    return stringifyUriSafe(uri);
  }

  _fsPathFromUri(uri: unknown): string | null {
    return fsPathFromLocalUri(uri);
  }

  _statPayloadFromFsStats(st: LocalFsStatsLike): Record<string, unknown> {
    return buildFsStatPayload(st);
  }

  async _readLocalUriBuffer(uri: unknown): Promise<Uint8Array> {
    return readLocalDocumentBuffer(this._documentContentRuntime(), uri);
  }

  async _statLocalUri(uri: unknown): Promise<Record<string, unknown>> {
    return statLocalDocumentUri(this._documentContentRuntime(), uri);
  }

  async _tryOpenDocument(uri: unknown, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return openLocalDocument(this._documentContentRuntime(), uri, options);
  }

  _buildSettingsSchema(kind: string): Record<string, unknown> | null {
    return buildSettingsSchema(this._configurationRuntime(), kind);
  }

  _getVirtualVscodeContent(uri: unknown): string | null {
    return getVirtualVscodeContent(this._configurationRuntime(), uri);
  }

  _readVirtualVscodeUriBuffer(uri: unknown): Uint8Array | null {
    return readVirtualVscodeUriBuffer(this._configurationRuntime(), uri);
  }

  _statVirtualVscodeUri(uri: unknown): Record<string, unknown> | null {
    return statVirtualVscodeUri(this._configurationRuntime(), uri);
  }

  _extractExtensionConfigDefaults(scannedExtensions: unknown[]): RawExtensionConfigDefaults {
    return extractExtensionConfigDefaults(scannedExtensions, (...args) => console.log(...args));
  }

  _buildConfigurationInitData(folder: string | null, authority: string | null): Record<string, unknown> {
    return buildConfigurationInitData(this._configurationRuntime(), folder, authority);
  }

  _buildExtHostInitData({ authority, commit, envData, scannedExtensions, folder, useRemote, productVersion }: ExtHostInitOptions): Record<string, unknown> {
    return buildExtHostInitData(this._extensionCatalogRuntime(), {
      authority,
      commit,
      envData,
      scannedExtensions,
      folder,
      useRemote,
      productVersion,
    });
  }

  async connect(params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this._connecting) throw new Error("already connecting");
    this._connecting = true;
    try {
      const management = await connectManagementSession(this._managementRuntime(), params);
      return await connectExtensionHostSession(this._extensionHostRuntime(), management);
    } finally {
      this._connecting = false;
    }
  }

  async openFile(params: unknown = {}): Promise<Record<string, unknown>> {
    return openWorkbenchFile(this._workspaceLifecycleRuntime(), params);
  }

  /**
   * Push a full-text buffer update to the extension host for live diagnostics.
   * Uses $acceptModelChanged on ExtHostDocuments with isFlush:true.
   */
  didChange(params: unknown = {}, opts: DidChangeOptions = {}): Record<string, unknown> | Promise<Record<string, unknown>> {
    return applyDidChange(this._workspaceLifecycleRuntime(), params, opts);
  }

  async documentSymbols(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideDocumentSymbols(this._documentFeatureRuntime(), params);
  }

  async foldingRanges(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideFoldingRanges(this._documentFeatureRuntime(), params);
  }

  /** Single-provider symbols path (for pinned handle callers). */
  async _symbolsSingle(providerHandle: number, path: string, authority: string, languageId: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return provideDocumentSymbolsSingle(this._documentFeatureRuntime(), {
      providerHandle,
      path,
      authority,
      languageId,
      timeoutMs: 15000,
      _retried: !!params?._retried,
    });
  }

  async _foldingRangesSingle(
    providerHandle: number,
    path: string,
    authority: string,
    languageId: string,
    context: Record<string, unknown>,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return provideFoldingRangesSingle(this._documentFeatureRuntime(), {
      providerHandle,
      path,
      authority,
      languageId,
      context,
      timeoutMs: 15000,
      _retried: !!params?._retried,
    });
  }

  async hover(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideHover(this._documentFeatureRuntime(), params);
  }

  async _hoverSingle(providerHandle: number, path: string, lineNumber: number, column: number, authority: string, languageId: string): Promise<Record<string, unknown>> {
    void languageId;
    return provideHoverSingle(this._documentFeatureRuntime(), {
      providerHandle,
      path,
      lineNumber,
      column,
      authority,
    });
  }

  // ─── Completions ────────────────────────────────────────────────────
  async completions(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideCompletions(this._completionRuntime(), params);
  }

  async inlayHints(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideInlayHints(this._inlayHintsRuntime(), params);
  }

  async resolveInlayHint(params: unknown = {}): Promise<Record<string, unknown>> {
    return resolveInlayHint(this._inlayHintsRuntime(), params);
  }

  async releaseInlayHints(params: unknown = {}): Promise<Record<string, unknown>> {
    return releaseInlayHints(this._inlayHintsRuntime(), params);
  }

  async inlineCompletions(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideInlineCompletions(this._inlineCompletionRuntime(), params);
  }

  async freeInlineCompletions(params: unknown = {}): Promise<Record<string, unknown>> {
    return freeInlineCompletions(this._inlineCompletionRuntime(), params);
  }

  async handleInlineCompletionDidShow(params: unknown = {}): Promise<Record<string, unknown>> {
    return handleInlineCompletionDidShow(this._inlineCompletionRuntime(), params);
  }

  /** Single-provider completions path (for pinned handle callers). */
  async _completionsSingle(
    providerHandle: number,
    path: string,
    authority: string,
    lineNumber: number,
    column: number,
    triggerKind: number,
    triggerCharacter: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return provideCompletionSingle(this._completionRuntime(), {
      providerHandle,
      path,
      authority,
      lineNumber,
      column,
      triggerKind,
      triggerCharacter,
      timeoutMs,
    });
  }

  /** Inflate ISuggestResultDto minified fields to readable Monaco-compatible format. */
  _inflateCompletionItems(dto: unknown): Record<string, unknown>[] {
    return inflateCompletionItems(dto, (message) => console.log(message));
  }

  // ─── Semantic Tokens ────────────────────────────────────────────────
  async semanticTokens(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideSemanticTokens(this._semanticTokensRuntime(), params);
  }

  /** Single-provider semantic tokens path (for pinned handle callers). */
  async _semanticTokensSingle(
    providerHandle: number,
    path: string,
    authority: string,
    languageId: string,
    previousResultId: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    void languageId;
    return provideSemanticTokensSingle(this._semanticTokensRuntime(), {
      providerHandle,
      path,
      authority,
      previousResultId,
      timeoutMs,
    });
  }

  /** Parse a semantic tokens reply (type 7/8/9) into a structured result. Returns null on unrecognized. */
  _parseSemanticTokensReply(rep: unknown, legend: unknown): unknown {
    return parseSemanticTokensReply(rep, legend, (message) => console.log(message), (message) => console.warn(message));
  }

  // ─── Semantic Tokens Range ──────────────────────────────────────────
  async semanticTokensRange(params: unknown = {}): Promise<Record<string, unknown>> {
    return provideSemanticTokensRange(this._semanticTokensRuntime(), params);
  }

  _parseSemanticTokensDto(dto: unknown): unknown {
    return parseSemanticTokensDto(dto);
  }

  /** Get the semantic tokens legend for a language (tries all providers). */
  async getSemanticTokensLegend(languageId: string): Promise<unknown> {
    return loadSemanticTokensLegend(this._semanticTokensRuntime(), languageId);
  }

  // ─── Workspace Root Detection & Switching ────────────────────────────

  /**
   * Switch the ExtHost workspace to a new folder root.
   * Sends $acceptWorkspaceData so extensions (basedpyright, etc.) re-scope
   * their analysis to the new project.  Also re-subscribes the file watcher.
   */
  async _switchWorkspace(newFolder: string): Promise<void> {
    return switchWorkbenchWorkspace(this._workspaceLifecycleRuntime(), newFolder);
  }

  // ─── File Watcher IPC ────────────────────────────────────────────────
  async _setupFileWatcher(workspaceRoot: string | null): Promise<void> {
    return setupWorkbenchWatcher(this._workspaceLifecycleRuntime(), workspaceRoot);
  }

  async resubscribeWatcher(): Promise<void> {
    return resubscribeWorkbenchWatcher(this._workspaceLifecycleRuntime());
  }

  disconnect(): void {
    return disconnectSession(this._transportRuntime());
  }

  async languageCatalog(): Promise<Record<string, unknown>> {
    if (this._languageCatalogCache) return this._languageCatalogCache;
    if (!Array.isArray(this._extensions) || this._extensions.length === 0) {
      try {
        await waitFor(() => Array.isArray(this._extensions) && this._extensions.length > 0, { timeoutMs: 5000, intervalMs: 50 });
      } catch {}
    }
    this._languageCatalogCache = await buildLanguageCatalog(this._extensionCatalogRuntime(), this._extensions);
    return this._languageCatalogCache;
  }

  providers(): Record<string, unknown> {
    return this._providerRegistry.snapshot();
  }

  /** Find provider handle matching a languageId by scanning selector arrays. */
  _findProviderHandle(type: ProviderKind, languageId: string): number | null {
    try {
      return this._providerRegistry.findProviderHandle(type, languageId);
    } catch {
      return null;
    }
  }

  _findAllProviderHandles(type: ProviderKind, languageId: string): number[] {
    try {
      return this._providerRegistry.findAllProviderHandles(type, languageId);
    } catch {
      return [];
    }
  }

  /**
   * Replay cached provider registrations and session state via onEvent.
   * Called when a new frontend connects to an already-running adapter so it
   * receives the same events it would have seen during initial ext host boot.
   */
  resync(): Record<string, unknown> {
    const { replayed, events } = this._providerRegistry.buildResyncEvents();
    for (const event of events) {
      this.onEvent({ ...event, ts_ms: Date.now() });
    }
    console.error(`[resync] replayed providers: cmp=${replayed.completions} inlay=${replayed.inlayHints} inline=${replayed.inlineCompletions} semTok=${replayed.semanticTokens} folding=${replayed.foldingRanges}`);
    return { ok: true, ts_ms: Date.now(), replayed };
  }
}
