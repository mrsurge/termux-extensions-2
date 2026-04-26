import type { DecodedExtHostRpc } from "../protocol/wire-encoding";

export type DecodedExtMessage = DecodedExtHostRpc;

export interface ExtensionHostBootstrapState {
  connected: boolean;
  ready: boolean;
  extConnected: boolean;
  useRemote: boolean | null;
  authority: string | null;
  serverRootPath: string | null;
  commit: string | null;
  workspaceFolder: string | null;
  activePath: string | null;
  activeUri: string | null;
  activeLanguageId: string | null;
  lastOpenTs: number | null;
  docSymbolsProviderHandle: number | null;
  hoverProviderHandle: number | null;
}

export interface ExtensionHostHandshakeState {
  readySeen: boolean;
  initSent: boolean;
  initialized: boolean;
}

export interface ExtensionHostTraceState {
  enabled: boolean;
  seen: number;
  bytes: number;
  maxBytes: number;
  lastTs: number;
}

export interface ExtensionHostRefs {
  ext: { protocol: { send: (payload: unknown) => void; onMessage: (listener: (payload: { buffer?: Uint8Array & { readUInt32BE?: (offset: number) => number } }) => void) => { dispose?: () => void } } } | null;
  extHandshake: ExtensionHostHandshakeState;
  extMsgTrace: ExtensionHostTraceState;
  extMsgCount: number;
  debugExtReqSeen: number;
}

export interface ExtensionHostConnectContext {
  proxyHttp: string;
  authority: string;
  useRemote: boolean;
  token: string;
  connectTo: { host: string; port: number };
  socketFactory: unknown;
  serverRootPath: string;
  commit: string | null;
  workspaceRoot: string | null;
  workspaceTrusted: boolean;
  extArgs: { language: string; break: boolean; port: null; env: { VSCODE_PROXY_URI: string } };
  extInitData: unknown;
}

export interface ExtensionHostRuntime {
  state: ExtensionHostBootstrapState;
  refs: ExtensionHostRefs;
  signService: unknown;
  connectionTypes: {
    ExtensionHost: unknown;
    ExtHostConfiguration: number;
    ExtHostFileSystemInfo: number;
    ExtHostLanguageFeatures: number;
    ExtHostLanguages: number;
    ExtHostOutputService: number;
    ExtHostStatusBar: number;
    ExtHostDocumentsAndEditors: number;
    ExtHostEditorTabs: number;
    ExtHostExtensionService: number;
    ExtHostWorkspace: number;
  };
  bootstrapLanguageIds: string[];
  rpcConfigSource: string;
  extMsgTraceEvery: number;
  extMsgTraceMax: number;
  initSizeProfile: boolean;
  initSizeMaxItems: number;
  connectRemoteAgent: (options: Record<string, unknown>) => Promise<{ protocol: { send: (payload: unknown) => void; onMessage: (listener: (payload: { buffer?: Uint8Array & { readUInt32BE?: (offset: number) => number } }) => void) => { dispose?: () => void } } }>;
  randomUuid: () => string;
  spanTrace: <T>(name: string, fn: () => T) => T;
  spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  logMetrics: (type: string, data: Record<string, unknown>) => void;
  memSnapshot: () => Record<string, unknown>;
  jsonSizeOrSkip: (value: unknown, maxItems: number) => Record<string, unknown>;
  onEvent: (payload: Record<string, unknown>) => void;
  sendExtInitText: (text: string) => void;
  decodeExtMessage: (payload: Uint8Array) => DecodedExtMessage;
  handleDecodedExtMessage: (message: DecodedExtMessage) => void;
  buildConfigurationInitData: (folder: string | null, authority: string | null) => Record<string, unknown>;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => void;
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  sha1Short: (text: string) => string;
  resetExtRequestIds: () => void;
  log: (...args: unknown[]) => void;
}

function payloadLength(payload: { buffer?: Uint8Array }): number {
  return payload.buffer?.length ?? 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const value of bytes) out += value.toString(16).padStart(2, "0");
  return out;
}

function readRawReq(payload: Uint8Array & { readUInt32BE?: (offset: number) => number }): number {
  if (typeof payload.readUInt32BE === "function") return payload.readUInt32BE(1);
  return new DataView(payload.buffer, payload.byteOffset + 1, 4).getUint32(0, false) >>> 0;
}

function visiblePayloadHex(payload: Uint8Array): string {
  return bytesToHex(payload.slice(0, Math.min(32, payload.length)));
}

function emitTrace(runtime: ExtensionHostRuntime, payloadLen: number): void {
  if (!runtime.refs.extMsgTrace.enabled || runtime.refs.extMsgTrace.seen >= runtime.extMsgTraceMax) return;
  runtime.refs.extMsgTrace.seen += 1;
  runtime.refs.extMsgTrace.bytes += payloadLen;
  if (payloadLen > runtime.refs.extMsgTrace.maxBytes) runtime.refs.extMsgTrace.maxBytes = payloadLen;
  if (runtime.extMsgTraceEvery > 0 && (runtime.refs.extMsgTrace.seen % runtime.extMsgTraceEvery) === 0) {
    try {
      runtime.log(JSON.stringify({
        type: "ext/msg_trace",
        ts_ms: Date.now(),
        seen: runtime.refs.extMsgTrace.seen,
        total_bytes: runtime.refs.extMsgTrace.bytes,
        max_bytes: runtime.refs.extMsgTrace.maxBytes,
        last_len: payloadLen,
        mem: runtime.memSnapshot(),
      }));
    } catch {
      // logging only
    }
  }
}

function logHandshakeReady(runtime: ExtensionHostRuntime, startMs: number, extInitData: unknown): void {
  runtime.onEvent({ type: "ext/handshake_ready", ts_ms: Date.now(), after_ms: Date.now() - startMs });
  runtime.log(`[ext_handshake] READY after ${Date.now() - startMs}ms`);
  runtime.logMetrics("metrics/pre_ext_init_send", { mem: runtime.memSnapshot() });
  const initJson = runtime.spanTrace("connect.JSON.stringify(extInitData)", () => JSON.stringify(extInitData));
  if (runtime.initSizeProfile) {
    const extSnap = (extInitData && typeof extInitData === "object") ? (extInitData as { extensions?: Record<string, unknown> }).extensions ?? {} : {};
    runtime.logMetrics("metrics/ext_init_size", {
      init_bytes: initJson.length,
      env: runtime.jsonSizeOrSkip((extInitData as { environment?: unknown })?.environment, runtime.initSizeMaxItems),
      workspace: runtime.jsonSizeOrSkip((extInitData as { workspace?: unknown })?.workspace, runtime.initSizeMaxItems),
      extensions: {
        all_len: Array.isArray((extSnap as { allExtensions?: unknown[] }).allExtensions) ? (extSnap as { allExtensions?: unknown[] }).allExtensions!.length : 0,
        my_len: Array.isArray((extSnap as { myExtensions?: unknown[] }).myExtensions) ? (extSnap as { myExtensions?: unknown[] }).myExtensions!.length : 0,
        activation_keys: (extSnap as { activationEvents?: Record<string, unknown> }).activationEvents ? Object.keys((extSnap as { activationEvents?: Record<string, unknown> }).activationEvents!).length : 0,
        size: runtime.jsonSizeOrSkip(extSnap, runtime.initSizeMaxItems),
      },
    });
  }
  runtime.sendExtInitText(initJson);
  runtime.onEvent({ type: "ext/handshake_init_sent", ts_ms: Date.now(), bytes: initJson.length });
  runtime.log(`[ext_handshake] INIT_SENT bytes=${initJson.length} extensions=${(extInitData as { extensions?: { allExtensions?: unknown[] } })?.extensions?.allExtensions?.length ?? "?"}`);
}

async function waitForExtHandshake(runtime: ExtensionHostRuntime, extInitData: unknown): Promise<void> {
  return await new Promise((resolve, reject) => {
    const startMs = Date.now();
    const timeout = setTimeout(() => reject(new Error("ext host handshake timeout")), 60000);
    const protocol = runtime.refs.ext?.protocol;
    if (!protocol) {
      clearTimeout(timeout);
      reject(new Error("extension host protocol unavailable"));
      return;
    }
    const disposable = protocol.onMessage((payload) => {
      const buffer = payload.buffer;
      if (!buffer || buffer.length !== 1) return;
      const value = buffer[0];
      if (value === 2) {
        runtime.refs.extHandshake.readySeen = true;
        if (!runtime.refs.extHandshake.initSent) {
          runtime.refs.extHandshake.initSent = true;
          try {
            logHandshakeReady(runtime, startMs, extInitData);
          } catch (error) {
            clearTimeout(timeout);
            disposable.dispose?.();
            reject(error);
          }
        }
      } else if (value === 1) {
        runtime.refs.extHandshake.initialized = true;
        clearTimeout(timeout);
        disposable.dispose?.();
        runtime.onEvent({ type: "ext/handshake_initialized", ts_ms: Date.now(), after_ms: Date.now() - startMs });
        runtime.log(`[ext_handshake] INITIALIZED after ${Date.now() - startMs}ms`);
        resolve();
      } else if (value === 3) {
        runtime.log("[ext_handshake] TERMINATE received - ext host shutting down");
      }
    });
  });
}

function installExtMessageListener(runtime: ExtensionHostRuntime): void {
  runtime.refs.extMsgCount = 0;
  runtime.refs.ext?.protocol.onMessage((payload) => {
    const buffer = payload.buffer;
    if (buffer && buffer.length === 1) return;
    if (!runtime.refs.extHandshake.initialized || !buffer) return;

    runtime.refs.extMsgCount += 1;
    if (runtime.refs.extMsgCount <= 500) {
      const mem = runtime.memSnapshot();
      const heapUsed = typeof mem.heap_used === "number" ? mem.heap_used : 0;
      runtime.log(`[ext_msg] #${runtime.refs.extMsgCount} len=${payloadLength(payload)} heapUsed=${(heapUsed / 1048576).toFixed(1)}MB`);
    }

    emitTrace(runtime, payloadLength(payload));

    if (runtime.refs.extMsgCount >= 100 && runtime.refs.extMsgCount <= 120) {
      runtime.log(`[ext_msg_raw] #${runtime.refs.extMsgCount} len=${buffer.length} first32hex=${visiblePayloadHex(buffer)}`);
    }

    const msg = runtime.decodeExtMessage(buffer);
    if (runtime.refs.extMsgCount <= 500) {
      const rawType = buffer[0];
      const rawReq = buffer.length >= 5 ? readRawReq(buffer) : -1;
      runtime.log(`[ext_msg] #${runtime.refs.extMsgCount} kind=${msg.kind} type=${msg.type} rpcId=${msg.rpcId ?? "-"} method=${msg.method ?? "-"} req=${msg.req ?? "-"} rawType=${rawType} rawReq=${rawReq}`);
    }
    if (msg.kind !== "ext") return;
    if (runtime.refs.extMsgTrace.enabled && msg.error && runtime.refs.extMsgTrace.seen < runtime.extMsgTraceMax) {
      try {
        runtime.log(JSON.stringify({ type: "ext/msg_decode_error", ts_ms: Date.now(), error: msg.error, req: msg.req ?? null, msgType: msg.type ?? null }));
      } catch {
        // logging only
      }
    }

    if (msg.type === 1 || msg.type === 2 || msg.type === 3 || msg.type === 4) {
      if (runtime.refs.extMsgTrace.enabled && runtime.refs.extMsgTrace.seen < runtime.extMsgTraceMax) {
        const meta: Record<string, unknown> = {
          type: "ext/request_meta",
          ts_ms: Date.now(),
          req: msg.req,
          rpcId: msg.rpcId,
          method: msg.method,
          encoding: (msg.type === 3 || msg.type === 4) ? "mixed" : "json",
        };
        if (typeof msg.argsRawLen === "number") meta.argsRawLen = msg.argsRawLen;
        if (msg.argsMeta && typeof msg.argsMeta === "object") meta.argsMeta = msg.argsMeta;
        if (msg.skipReason) meta.skipReason = msg.skipReason;
        try {
          runtime.log(JSON.stringify(meta));
        } catch {
          // logging only
        }
      }
      runtime.handleDecodedExtMessage(msg);
      return;
    }

    if (msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10 || msg.type === 11 || msg.type === 12) {
      runtime.handleDecodedExtMessage(msg);
    }
  });
}

function bootstrapConfiguration(runtime: ExtensionHostRuntime, context: ExtensionHostConnectContext): void {
  const configInit = runtime.spanTrace("connect.buildConfigurationInitData", () => runtime.buildConfigurationInitData(context.workspaceRoot, context.useRemote ? context.authority : null));
  runtime.sendExt(runtime.connectionTypes.ExtHostConfiguration, "$initializeConfiguration", [configInit], false);
  try {
    const defaults = (configInit as { defaults?: { keys?: unknown[] } }).defaults?.keys ?? [];
    const userRemote = (configInit as { userRemote?: { keys?: unknown[] } }).userRemote?.keys ?? [];
    const workspace = (configInit as { workspace?: { keys?: unknown[] } }).workspace?.keys ?? [];
    const allChangedKeys = [...new Set([...(Array.isArray(defaults) ? defaults : []), ...(Array.isArray(userRemote) ? userRemote : []), ...(Array.isArray(workspace) ? workspace : [])])];
    runtime.sendExt(runtime.connectionTypes.ExtHostConfiguration, "$acceptConfigurationChanged", [configInit, { keys: allChangedKeys, overrides: [] }], false);
  } catch {
    // preserve current best-effort behavior
  }
}

function bootstrapExtensionHost(runtime: ExtensionHostRuntime, context: ExtensionHostConnectContext): void {
  try {
    const providerInfos: Array<[string, number]> = [
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
      runtime.sendExt(runtime.connectionTypes.ExtHostFileSystemInfo, "$acceptProviderInfos", [{ $mid: 1, path: "/dummy", scheme }, caps], false);
    }
  } catch {
    // bootstrap only
  }
  try {
    const regexSource = "(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\$\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\'\\\"\\,\\.\\<\\>\\/\\?\\s]+)";
    const defs = runtime.bootstrapLanguageIds.map((languageId) => ({ languageId, regexSource, regexFlags: "g" }));
    runtime.sendExt(runtime.connectionTypes.ExtHostLanguageFeatures, "$setWordDefinitions", [defs], false);
  } catch {
    // bootstrap only
  }
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostLanguageFeatures, "$acceptInlineCompletionsUnificationState", [{ codeUnification: false, modelUnification: false, extensionUnification: false, expAssignments: [] }], false);
  } catch {
    // bootstrap only
  }
  runtime.sendExt(runtime.connectionTypes.ExtHostLanguages, "$acceptLanguageIds", [runtime.bootstrapLanguageIds], false);
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostOutputService, "$setVisibleChannel", [null], false);
  } catch {
    // bootstrap only
  }
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostStatusBar, "$acceptStaticEntries", [[]], false);
  } catch {
    // bootstrap only
  }
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [{ newActiveEditor: null }], false);
  } catch {
    // bootstrap only
  }
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostEditorTabs, "$acceptEditorTabModel", [[{ groupId: 0, isActive: true, viewColumn: 0, tabs: [] }]], false);
  } catch {
    // bootstrap only
  }
  try {
    runtime.sendExt(runtime.connectionTypes.ExtHostExtensionService, "$activateByEvent", ["onLanguage", 0], false);
  } catch {
    // bootstrap only
  }
  if (context.workspaceRoot) {
    const rootPath = String(context.workspaceRoot);
    const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
    const workspace = {
      isUntitled: false,
      folders: [{ uri: runtime.uriForPath(rootPath, context.authority), name, index: 0 }],
      id: runtime.sha1Short(rootPath),
      name,
      transient: false,
    };
    runtime.sendExt(runtime.connectionTypes.ExtHostWorkspace, "$initializeWorkspace", [workspace, context.workspaceTrusted], false);
    if (context.workspaceTrusted) runtime.sendExt(runtime.connectionTypes.ExtHostWorkspace, "$onDidGrantWorkspaceTrust", [], false);
  }
}

export async function connectExtensionHostSession(
  runtime: ExtensionHostRuntime,
  context: ExtensionHostConnectContext,
): Promise<Record<string, unknown>> {
  const ext = await runtime.spanTraceAsync("connect.remoteAgent.ext", () => runtime.connectRemoteAgent({
    socketFactory: context.socketFactory,
    connectTo: context.connectTo,
    serverRootPath: context.serverRootPath,
    reconnectionToken: runtime.randomUuid(),
    connectionToken: context.token,
    commit: context.commit,
    desiredConnectionType: runtime.connectionTypes.ExtensionHost,
    args: context.extArgs,
    signService: runtime.signService,
    timeoutMs: 15000,
    debugLabel: `renderer-ExtensionHost-${runtime.randomUuid().slice(0, 8)}`,
  }));
  runtime.refs.ext = { protocol: ext.protocol };

  runtime.state.connected = true;
  runtime.state.ready = false;
  runtime.state.extConnected = true;
  runtime.state.useRemote = !!context.useRemote;
  runtime.state.authority = context.authority;
  runtime.state.serverRootPath = context.serverRootPath;
  runtime.state.commit = context.commit;
  runtime.state.workspaceFolder = context.workspaceRoot;
  runtime.state.activePath = null;
  runtime.state.activeUri = null;
  runtime.state.activeLanguageId = null;
  runtime.state.lastOpenTs = null;
  runtime.state.docSymbolsProviderHandle = null;
  runtime.state.hoverProviderHandle = null;
  runtime.resetExtRequestIds();
  runtime.refs.debugExtReqSeen = 0;
  runtime.refs.extHandshake = { readySeen: false, initSent: false, initialized: false };

  const handshakePromise = waitForExtHandshake(runtime, context.extInitData);
  installExtMessageListener(runtime);
  await handshakePromise;

  runtime.log(`[rpc-config] source: ${runtime.rpcConfigSource}`);
  bootstrapConfiguration(runtime, context);
  bootstrapExtensionHost(runtime, context);

  return {
    ok: true,
    proxyHttp: context.proxyHttp,
    serverRootPath: context.serverRootPath,
    commit: context.commit,
    authority: context.authority,
  };
}
