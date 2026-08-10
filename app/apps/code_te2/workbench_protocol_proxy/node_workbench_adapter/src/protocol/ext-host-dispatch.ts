export interface DecodedExtHostRpc {
  kind: "ext";
  type?: number;
  req?: number;
  rpcId?: number;
  method?: string;
  args?: unknown[];
  argsRawLen?: number;
  argsMeta?: Record<string, unknown>;
  cancellable?: boolean;
  skippedArgsParse?: boolean;
  skippedResultParse?: boolean;
  skippedErrorParse?: boolean;
  skipReason?: string;
  resultRawLen?: number;
  errorRawLen?: number;
  buffer?: Uint8Array;
  result?: unknown;
  mixedArgs?: unknown[];
  buffers?: unknown[];
  error?: unknown;
}

export interface ExtHostDispatchDebugRuntime {
  shouldEmitExtRequestEvent: () => boolean;
  markExtRequestEvent: () => void;
  shouldEmitExtReplyEvent: () => boolean;
  markExtReplyEvent: () => void;
  shouldEmitMainThreadReplyEvent: () => boolean;
  markMainThreadReplyEvent: () => void;
}

export interface ExtHostDispatchRuntime {
  replyDropMethods: ReadonlySet<string>;
  replyEmptyMethods: ReadonlySet<string>;
  replyNullMethods: ReadonlySet<string>;
  state: { ready: boolean };
  providerRegistry: {
    registerFromRequest: (method: unknown, args: unknown) => {
      handled: boolean;
      ready: boolean;
      logs: string[];
      events: Record<string, unknown>[];
    };
    getTextContentProvider: (scheme: string) => number | null;
    hasTextContentProvider: (scheme: string) => boolean;
  };
  extRequests: {
    getSentMeta: (req: number) => { rpcId: number; method: string; ts_ms: number } | undefined;
    resolveReply: (message: Record<string, unknown>) => boolean;
    deleteSentMeta: (req: number) => void;
  };
  rpcIds: {
    MainThreadConsole: number;
    MainThreadExtensionService: number;
    MainThreadLogger: number;
    MainThreadOutputService: number;
    MainThreadStatusBar: number;
    ExtHostWorkspace: number;
  };
  extensionActivity: {
    handleRequest: (request: {
      req: number;
      rpcId?: number;
      method?: string;
      args?: unknown[];
    }) => {
      handledReply?: boolean;
      replyResult?: unknown;
    };
  };
  debug: ExtHostDispatchDebugRuntime;
  nowMs: () => number;
  timeLabel: () => string;
  onEvent: (payload: Record<string, unknown>) => void;
  sendPayload: (payload: Uint8Array) => void;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => void;
  checkWorkspaceExists: (folders: unknown, includes: unknown) => Promise<boolean>;
  startFileSearch: (includeFolder: unknown, options: unknown) => Promise<Record<string, unknown>[]>;
  tryOpenDocument: (uri: unknown, options: unknown) => Promise<unknown>;
  provideTextDocumentContent: (handle: number, uri: unknown) => Promise<string | null>;
  readVirtualVscodeUriBuffer: (uri: unknown) => Uint8Array | null;
  statVirtualVscodeUri: (uri: unknown) => Record<string, unknown> | null;
  fsPathFromUri: (uri: unknown) => string | null;
  readLocalUriBuffer: (uri: unknown) => Promise<Uint8Array>;
  statLocalUri: (uri: unknown) => Promise<Record<string, unknown>>;
  uriObjToStringSafe: (uri: unknown) => string;
  log: (...args: unknown[]) => void;
}

interface ExtRequestMetaEvent extends Record<string, unknown> {
  type: "ext/request";
  ts_ms: number;
  req: number;
  rpcId?: number;
  method?: string;
  args?: unknown[];
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function byte(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function jsonBytes(value: unknown): Uint8Array {
  const raw = JSON.stringify(value ?? null);
  return new TextEncoder().encode(raw === undefined ? "null" : raw);
}

function encodeExtAck(req: number): Uint8Array {
  return concatBytes([byte(5), u32be(req)]);
}

function encodeExtReplyOkEmpty(req: number): Uint8Array {
  return concatBytes([byte(7), u32be(req)]);
}

function encodeExtReplyOkJson(req: number, result: unknown): Uint8Array {
  const raw = jsonBytes(result ?? null);
  return concatBytes([byte(9), u32be(req), u32be(raw.length), raw]);
}

function encodeExtReplyOkVSBuffer(req: number, buffer: Uint8Array): Uint8Array {
  return concatBytes([byte(8), u32be(req), u32be(buffer.length), buffer]);
}

function encodeExtReplyError(req: number, error: unknown): Uint8Array {
  const raw = jsonBytes(error ?? null);
  return concatBytes([byte(11), u32be(req), u32be(raw.length), raw]);
}

function isReplyType(type: unknown): type is 7 | 8 | 9 | 10 | 11 | 12 {
  return type === 7 || type === 8 || type === 9 || type === 10 || type === 11 || type === 12;
}

function isRequestType(type: unknown): type is 1 | 2 | 3 | 4 {
  return type === 1 || type === 2 || type === 3 || type === 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function objectKeysPreview(value: unknown, limit = 12): string[] {
  if (!isRecord(value)) return [];
  try {
    return Object.keys(value).slice(0, limit);
  } catch {
    return [];
  }
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

const LOG_ARGS_METHODS = new Set([
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

function emitRequestEvent(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  if (!runtime.debug.shouldEmitExtRequestEvent()) return;
  runtime.debug.markExtRequestEvent();
  const event: ExtRequestMetaEvent = {
    type: "ext/request",
    ts_ms: runtime.nowMs(),
    req: Number(msg.req ?? 0),
  };
  if (typeof msg.rpcId === "number") event.rpcId = msg.rpcId;
  if (typeof msg.method === "string") event.method = msg.method;
  if (msg.method && LOG_ARGS_METHODS.has(msg.method) && Array.isArray(msg.args)) event.args = msg.args;
  runtime.onEvent(event);
}

function logActivationLifecycle(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  if (msg.method === "$onWillActivateExtension" || msg.method === "$onDidActivateExtension" || msg.method === "$onExtensionActivationError") {
    const raw0 = Array.isArray(msg.args) ? msg.args[0] : undefined;
    const extId =
      (isRecord(raw0) && isRecord(raw0.value) && stringValue(raw0.value.id)) ||
      (isRecord(raw0) && stringValue(raw0.id)) ||
      (isRecord(raw0) && isRecord(raw0.identifier) && stringValue(raw0.identifier.id)) ||
      (typeof raw0 === "string" ? raw0 : (() => {
        try {
          return JSON.stringify(raw0)?.slice(0, 200) ?? "unknown";
        } catch {
          return "unknown";
        }
      })());
    runtime.log(`[ext_activation] ${msg.method} extId=${extId}`);
  }
  if (msg.method === "$ensureActivation") runtime.log(`[ext_activation] $ensureActivation args=${JSON.stringify(msg.args ?? [])}`);
  if (msg.method === "$initializeExtensionStorage") runtime.log(`[ext_activation] $initializeExtensionStorage args=${JSON.stringify(msg.args ?? []).slice(0, 200)}`);
  if (msg.method === "$onUnexpectedError") runtime.log(`[ext_error] $onUnexpectedError args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
  if (msg.method === "$logExtensionHostMessage") runtime.log(`[ext_log] $logExtensionHostMessage args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
  if (msg.method === "$register") runtime.log(`[ext_register] $register rpcId=${msg.rpcId} args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
  if (msg.method === "$onExtensionRuntimeError") runtime.log(`[ext_error] $onExtensionRuntimeError args=${JSON.stringify(msg.args ?? []).slice(0, 500)}`);
}

function applyProviderRegistration(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  if (msg.method && msg.method.startsWith("$register") && msg.method.endsWith("Provider")) {
    runtime.log(`[providers] ${msg.method} handle=${msg.args?.[0]} selector=${JSON.stringify(msg.args?.[1])?.slice(0, 300)}`);
  }
  const registration = runtime.providerRegistry.registerFromRequest(msg.method, msg.args);
  if (!registration.handled) return;
  for (const line of registration.logs) runtime.log(line);
  if (registration.ready) runtime.state.ready = true;
  for (const event of registration.events) runtime.onEvent({ ...event, ts_ms: runtime.nowMs() });
}

function logDiagnosticsChange(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  const argsSummary = Array.isArray(msg.args) ? `args.length=${msg.args.length}` : `args=${typeof msg.args}`;
  const pairs = Array.isArray(msg.args) && Array.isArray(msg.args[1]) ? msg.args[1] : [];
  const markerCounts = pairs.map((pair: unknown) => (Array.isArray(pair) && Array.isArray(pair[1]) ? pair[1].length : "?"));
  runtime.log(`[wb_client] ts=${runtime.nowMs()} $changeMany owner=${Array.isArray(msg.args) ? msg.args[0] : "?"} pairs=${pairs.length} markerCounts=[${markerCounts.join(",")}] ${argsSummary}`);
  try {
    if (markerCounts.includes("?") && pairs.length > 0 && Array.isArray(pairs[0])) {
      const uri = pairs[0][0];
      const markers = pairs[0][1];
      const uriKeys = objectKeysPreview(uri);
      const markerKeys = objectKeysPreview(markers);
      let markersPreview = "";
      try {
        if (isRecord(markers)) markersPreview = JSON.stringify(markers).slice(0, 240);
      } catch {
        markersPreview = "";
      }
      let uriPath = "";
      try {
        if (isRecord(uri)) uriPath = String(uri.path || uri.fsPath || "");
      } catch {
        uriPath = "";
      }
      runtime.log(
        `[wb_client] ts=${runtime.nowMs()} $changeMany suspicious pair0 uriType=${typeof uri} uriPath=${uriPath} uriKeys=${JSON.stringify(uriKeys)} ` +
        `markersType=${Array.isArray(markers) ? "array" : typeof markers} markersKeys=${JSON.stringify(markerKeys)} markersPreview=${markersPreview}`,
      );
    }
  } catch {
    // Preserve current logging-only behavior.
  }
  if (pairs.length > 0 && Array.isArray(pairs[0]) && pairs[0].length >= 2) {
    const sampleMarkers = Array.isArray(pairs[0][1]) ? pairs[0][1].slice(0, 1) : [];
    if (sampleMarkers.length && isRecord(sampleMarkers[0])) {
      runtime.log(`[wb_client] ts=${runtime.nowMs()} $changeMany sample marker keys:`, Object.keys(sampleMarkers[0]));
    }
    const allMarkers = Array.isArray(pairs[0][1]) ? pairs[0][1] : [];
    const dump = allMarkers.slice(0, 3).map((marker: unknown) => ({
      severity: isRecord(marker) ? marker.severity : undefined,
      code: isRecord(marker) ? marker.code : undefined,
      source: isRecord(marker) ? marker.source : undefined,
      message: String(isRecord(marker) ? marker.message ?? "" : "").slice(0, 120),
      startLineNumber: isRecord(marker) ? marker.startLineNumber : undefined,
      startColumn: isRecord(marker) ? marker.startColumn : undefined,
      endLineNumber: isRecord(marker) ? marker.endLineNumber : undefined,
      endColumn: isRecord(marker) ? marker.endColumn : undefined,
      tags: isRecord(marker) ? marker.tags : undefined,
      relatedInformation: isRecord(marker) && Array.isArray(marker.relatedInformation) ? marker.relatedInformation.length : 0,
    }));
    runtime.log(`[diagnostics_dump] total=${allMarkers.length} first3=${JSON.stringify(dump)}`);
  }
  runtime.onEvent({ type: "diagnostics/changeMany", ts_ms: runtime.nowMs(), args: msg.args });
}

function handleSemanticTokensEvent(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): boolean {
  if (msg.method !== "$emitDocumentSemanticTokensEvent" && msg.method !== "$emitDocumentRangeSemanticTokensEvent") return false;
  const rawHandle = Array.isArray(msg.args) ? msg.args[0] : undefined;
  const eventHandle = Number(rawHandle);
  if (!Number.isFinite(eventHandle)) {
    runtime.log(`[semanticTokens] ignored ${msg.method} with invalid eventHandle=${String(rawHandle)}`);
    return true;
  }
  const range = msg.method === "$emitDocumentRangeSemanticTokensEvent";
  runtime.log(`[semanticTokens] ${msg.method} eventHandle=${eventHandle}`);
  runtime.onEvent({
    type: "provider/semanticTokens/didChange",
    ts_ms: runtime.nowMs(),
    eventHandle,
    range,
  });
  return true;
}

function sendReplyPayload(
  runtime: ExtHostDispatchRuntime,
  req: number,
  method: string | undefined,
  payload: Uint8Array,
): void {
  runtime.sendPayload(payload);
  if (!runtime.debug.shouldEmitMainThreadReplyEvent()) return;
  runtime.debug.markMainThreadReplyEvent();
  const firstByte = payload[0] ?? null;
  runtime.log(`[ext_reply_sent] req=${req} method=${method} type=${firstByte} len=${payload.length}`);
  runtime.onEvent({
    type: "ext/reply_to_ext",
    ts_ms: runtime.nowMs(),
    req,
    method: method ?? null,
    replyType: firstByte,
  });
}

function requestReplyPayload(
  runtime: ExtHostDispatchRuntime,
  msg: DecodedExtHostRpc,
  activityResult: { handledReply?: boolean; replyResult?: unknown },
): Uint8Array | null {
  const req = Number(msg.req ?? 0);
  const method = msg.method ?? "";

  if (activityResult.handledReply) {
    runtime.log(
      `[ext_reply] ${method} req=${req} -> ${String(activityResult.replyResult ?? "null")}`,
    );
    return encodeExtReplyOkJson(req, activityResult.replyResult);
  }
  if (runtime.replyDropMethods.has(method)) {
    runtime.onEvent({ type: "ext/reply_drop", ts_ms: runtime.nowMs(), req, method });
    return null;
  }
  if (runtime.replyEmptyMethods.has(method)) return encodeExtReplyOkEmpty(req);
  if (runtime.replyNullMethods.has(method)) return encodeExtReplyOkJson(req, null);
  if (method === "$getInitialState") return encodeExtReplyOkJson(req, { isFocused: true, isActive: true });
  if (method === "$requestWorkspaceTrust") {
    try {
      runtime.sendExt(runtime.rpcIds.ExtHostWorkspace, "$onDidGrantWorkspaceTrust", [], false);
    } catch {
      // Preserve current behavior: reply success even if follow-up notification fails.
    }
    return encodeExtReplyOkJson(req, true);
  }
  if (method === "$getTools") return encodeExtReplyOkJson(req, []);
  if (method === "$initializeExtensionStorage") return encodeExtReplyOkJson(req, "{}");
  if (method === "$resolveProxy") return encodeExtReplyOkJson(req, null);
  if (method === "$getPassword") return encodeExtReplyOkJson(req, null);
  if (method === "$executeCommand") return encodeExtReplyOkEmpty(req);
  return encodeExtReplyOkEmpty(req);
}

function handleTryOpenDocument(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  const req = Number(msg.req ?? 0);
  const uri = Array.isArray(msg.args) ? msg.args[0] : undefined;
  const options = Array.isArray(msg.args) ? msg.args[1] ?? {} : {};
  const uriStr = runtime.uriObjToStringSafe(uri);
  runtime.log(`[ext_reply] $tryOpenDocument req=${req} uri=${uriStr}`);
  runtime.tryOpenDocument(uri, options).then((openedUri) => {
    sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkJson(req, openedUri));
  }).catch((error) => {
    runtime.log(`[ext_reply] $tryOpenDocument error: ${error instanceof Error ? error.message : String(error)}`);
    sendReplyPayload(
      runtime,
      req,
      msg.method,
      encodeExtReplyError(req, { message: `TE2: cannot open document (${uriStr}): ${error instanceof Error ? error.message : String(error)}`, code: "FileNotFound" }),
    );
  });
}

function handleCheckExists(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  const req = Number(msg.req ?? 0);
  const folders = Array.isArray(msg.args) ? msg.args[0] : [];
  const includes = Array.isArray(msg.args) ? msg.args[1] : [];
  runtime.checkWorkspaceExists(folders, includes).then((exists) => {
    sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkJson(req, exists));
  }).catch((error) => {
    runtime.log(`[ext_reply] $checkExists error: ${error instanceof Error ? error.message : String(error)}`);
    sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkJson(req, false));
  });
}

function handleStartFileSearch(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): void {
  const req = Number(msg.req ?? 0);
  const includeFolder = Array.isArray(msg.args) ? msg.args[0] : null;
  const options = Array.isArray(msg.args) ? msg.args[1] : {};
  runtime.startFileSearch(includeFolder, options).then((results) => {
    sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkJson(req, results));
  }).catch((error) => {
    runtime.log(`[ext_reply] $startFileSearch error: ${error instanceof Error ? error.message : String(error)}`);
    sendReplyPayload(
      runtime,
      req,
      msg.method,
      encodeExtReplyError(req, {
        message: `TE2: workspace file search failed: ${error instanceof Error ? error.message : String(error)}`,
        code: "FileSearchFailed",
      }),
    );
  });
}

function handleReadFile(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): Uint8Array | null {
  const req = Number(msg.req ?? 0);
  const uri = Array.isArray(msg.args) ? msg.args[0] : undefined;
  const uriStr = runtime.uriObjToStringSafe(uri);
  const uriScheme = isRecord(uri) ? stringValue(uri.scheme) : null;
  const virtualBuffer = runtime.readVirtualVscodeUriBuffer(uri);
  const fsPath = runtime.fsPathFromUri(uri);
  const contentHandle = uriScheme ? runtime.providerRegistry.getTextContentProvider(uriScheme) : null;

  if (virtualBuffer) {
    runtime.log(`[ext_reply] $readFile req=${req} uri=${uriStr} -> virtual vscode schema`);
    return encodeExtReplyOkVSBuffer(req, virtualBuffer);
  }
  if (fsPath) {
    runtime.log(`[ext_reply] $readFile req=${req} uri=${uriStr} -> local fsPath=${fsPath}`);
    runtime.readLocalUriBuffer(uri).then((buffer) => {
      sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkVSBuffer(req, buffer));
    }).catch((error) => {
      runtime.log(`[ext_reply] $readFile local-file error: ${error instanceof Error ? error.message : String(error)}`);
      sendReplyPayload(
        runtime,
        req,
        msg.method,
        encodeExtReplyError(req, { message: `TE2: readFile failed (${uriStr}): ${error instanceof Error ? error.message : String(error)}`, code: "FileNotFound" }),
      );
    });
    return null;
  }
  if (contentHandle != null) {
    runtime.log(`[ext_reply] $readFile req=${req} uri=${uriStr} -> round-trip via contentProvider handle=${contentHandle}`);
    runtime.provideTextDocumentContent(contentHandle, uri).then((content) => {
      if (content != null) {
        sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkVSBuffer(req, toUtf8Bytes(String(content))));
        return;
      }
      sendReplyPayload(runtime, req, msg.method, encodeExtReplyError(req, { message: `Content provider returned null for ${uriStr}`, code: "FileNotFound" }));
    }).catch((error) => {
      runtime.log(`[ext_reply] $readFile content-provider error: ${error instanceof Error ? error.message : String(error)}`);
      sendReplyPayload(
        runtime,
        req,
        msg.method,
        encodeExtReplyError(req, { message: `TE2: content provider error (${uriStr}): ${error instanceof Error ? error.message : String(error)}`, code: "FileNotFound" }),
      );
    });
    return null;
  }
  runtime.log(`[ext_reply] $readFile req=${req} uri=${uriStr} -> no provider for scheme=${uriScheme}`);
  return encodeExtReplyError(req, { message: `TE2: $readFile not supported (${uriStr})`, code: "FileNotFound" });
}

function handleStat(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): Uint8Array | null {
  const req = Number(msg.req ?? 0);
  const uri = Array.isArray(msg.args) ? msg.args[0] : undefined;
  const uriStr = runtime.uriObjToStringSafe(uri);
  const uriScheme = isRecord(uri) ? stringValue(uri.scheme) : null;
  const virtualStat = runtime.statVirtualVscodeUri(uri);
  const fsPath = runtime.fsPathFromUri(uri);

  if (virtualStat) {
    runtime.log(`[ext_reply] $stat req=${req} uri=${uriStr} -> virtual vscode schema`);
    return encodeExtReplyOkJson(req, virtualStat);
  }
  if (fsPath) {
    runtime.log(`[ext_reply] $stat req=${req} uri=${uriStr} -> local fsPath=${fsPath}`);
    runtime.statLocalUri(uri).then((statPayload) => {
      sendReplyPayload(runtime, req, msg.method, encodeExtReplyOkJson(req, statPayload));
    }).catch((error) => {
      runtime.log(`[ext_reply] $stat local-file error: ${error instanceof Error ? error.message : String(error)}`);
      sendReplyPayload(
        runtime,
        req,
        msg.method,
        encodeExtReplyError(req, { message: `TE2: $stat failed (${uriStr}): ${error instanceof Error ? error.message : String(error)}`, code: "FileNotFound" }),
      );
    });
    return null;
  }
  if (uriScheme && runtime.providerRegistry.hasTextContentProvider(uriScheme)) {
    runtime.log(`[ext_reply] $stat req=${req} uri=${uriStr} -> synthetic stat for scheme=${uriScheme}`);
    return encodeExtReplyOkJson(req, { type: 1, size: 0, mtime: Date.now(), ctime: Date.now() });
  }
  runtime.log(`[ext_reply] $stat req=${req} uri=${uriStr}`);
  return encodeExtReplyError(req, { message: `TE2: $stat not supported (${uriStr})`, code: "FileNotFound" });
}

export function handleExtHostRequest(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): boolean {
  if (!isRequestType(msg.type) || typeof msg.req !== "number") return false;

  emitRequestEvent(runtime, msg);
  logActivationLifecycle(runtime, msg);
  const activityResult = runtime.extensionActivity.handleRequest({
    req: msg.req,
    rpcId: msg.rpcId,
    method: msg.method,
    args: msg.args,
  });

  try {
    runtime.sendPayload(encodeExtAck(msg.req));
  } catch {
    // Preserve current behavior: continue best-effort even if the ACK send fails.
  }

  applyProviderRegistration(runtime, msg);
  if (msg.method === "$changeMany") logDiagnosticsChange(runtime, msg);
  handleSemanticTokensEvent(runtime, msg);

  if (msg.method === "$checkExists") {
    handleCheckExists(runtime, msg);
    return true;
  }
  if (msg.method === "$startFileSearch") {
    handleStartFileSearch(runtime, msg);
    return true;
  }
  if (msg.method === "$tryOpenDocument") {
    handleTryOpenDocument(runtime, msg);
    return true;
  }
  if (msg.method === "$readFile") {
    const payload = handleReadFile(runtime, msg);
    if (payload) sendReplyPayload(runtime, msg.req, msg.method, payload);
    return true;
  }
  if (msg.method === "$stat") {
    const payload = handleStat(runtime, msg);
    if (payload) sendReplyPayload(runtime, msg.req, msg.method, payload);
    return true;
  }

  const payload = requestReplyPayload(runtime, msg, activityResult);
  if (payload) sendReplyPayload(runtime, msg.req, msg.method, payload);
  return true;
}

export function handleExtHostReply(runtime: ExtHostDispatchRuntime, msg: DecodedExtHostRpc): boolean {
  if (!isReplyType(msg.type) || typeof msg.req !== "number") return false;

  if (msg.type === 11 || msg.type === 12) {
    const errMeta = runtime.extRequests.getSentMeta(msg.req);
    runtime.log(`${runtime.timeLabel()} [ext_reply_ERROR] req=${msg.req} type=${msg.type} method=${errMeta?.method ?? "?"} error=${JSON.stringify(msg.error)?.slice(0, 500)}`);
  }
  const meta = runtime.extRequests.getSentMeta(msg.req);
  const resolved = runtime.extRequests.resolveReply(msg as unknown as Record<string, unknown>);
  if (meta && runtime.debug.shouldEmitExtReplyEvent()) {
    runtime.debug.markExtReplyEvent();
    runtime.onEvent({
      type: "ext/reply",
      ts_ms: runtime.nowMs(),
      req: msg.req,
      to: { rpcId: meta.rpcId, method: meta.method },
      replyType: msg.type,
      ok: msg.type === 7 || msg.type === 8 || msg.type === 9 || msg.type === 10,
      hasResult: hasOwn(msg, "result"),
      hasError: hasOwn(msg, "error") && msg.error != null,
      error: msg.type === 11 ? msg.error : null,
    });
  }
  if (resolved) runtime.extRequests.deleteSentMeta(msg.req);
  return true;
}
