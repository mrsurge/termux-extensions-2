import type { DocumentContentRuntime, LocalFsStatsLike } from "./document-content";
import type { ExtensionHostRuntime, DecodedExtMessage } from "./extension-host";
import type { ManagementRuntime } from "./management";
import type { TransportRuntime, SentRequestOwnerLike, TransportPendingOptions } from "./transport-session";
import type { ConfigurationRuntime } from "./configuration";
import type { ExtHostDispatchRuntime } from "../protocol/ext-host-dispatch";
import type { ExtensionCatalogRuntime } from "../extensions/catalog";
import type { ProviderDocument } from "../extensions/provider-registry";
import type { CompletionRuntime } from "../extensions/intelligence/completions";
import type { CodeNavigationRuntime } from "../extensions/intelligence/code-navigation";
import type { DocumentColorRuntime } from "../extensions/intelligence/document-colors";
import type { HoverRuntime } from "../extensions/intelligence/hover";
import type { InlayHintsRuntime } from "../extensions/intelligence/inlay-hints";
import type { InlineCompletionRuntime } from "../extensions/intelligence/inline-completions";
import type { SemanticRuntime } from "../extensions/intelligence/semantic-tokens";
import type { StructureRuntime } from "../extensions/intelligence/structure";
import type { LifecycleRuntime } from "../workspace/lifecycle";
import type { WorkbenchDocumentRegistry } from "../workspace/document-registry";

export interface RuntimeBuilderState {
  connected: boolean;
  ready: boolean;
  mgmtConnected: boolean;
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

export interface CompletionRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  useRemote: boolean;
  languageIdFromPath: (filePath: string) => string;
  didChange: (params: Record<string, unknown>, opts: { waitForAck: true; timeoutMs: number }) => Promise<unknown> | unknown;
  findAllProviderHandles: (
    kind: "completions",
    document: ProviderDocument,
  ) => number[];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

export interface DocumentColorRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  useRemote: boolean;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  findAllProviderHandles: (
    kind: "documentColors",
    document: ProviderDocument,
  ) => number[];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

export interface InlineCompletionRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ) => { req: number; promise: Promise<unknown> };
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

export interface InlayHintsRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  languageIdFromPath: (filePath: string) => string;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ) => { req: number; promise: Promise<unknown> };
  log: (message: string) => void;
  warn: (message: string, detail?: unknown) => void;
}

export interface SemanticTokensRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  useRemote: boolean;
  languageIdFromPath: (filePath: string) => string;
  didChange: (
    params: Record<string, unknown>,
    opts: { waitForAck: true; timeoutMs: number },
  ) => Promise<unknown> | unknown;
  findAllProviderHandles: (kind: "semanticTokens", languageId: string) => number[];
  findSemanticFullHandles: SemanticRuntime["findSemanticFullHandles"];
  findSemanticRangeHandles: SemanticRuntime["findSemanticRangeHandles"];
  getProjectionDocument: SemanticRuntime["getProjectionDocument"];
  getProjection: SemanticRuntime["getProjection"];
  getProjectionGeneration: SemanticRuntime["getProjectionGeneration"];
  storeProjection: SemanticRuntime["storeProjection"];
  releaseResult: SemanticRuntime["releaseResult"];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  getProvider: SemanticRuntime["getProvider"];
  log: (message: string) => void;
  warn: (message: string) => void;
  timeLabel: () => string;
}

export interface DocumentFeatureRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  useRemote: boolean;
  languageIdFromPath: (filePath: string) => string;
  getDocumentVersion: (path: string) => number | null;
  getActiveGeneration: () => number | string | null;
  updateActiveDocument: (path: string, uriObj: unknown, languageId: string) => void;
  selectorGroupsSummary: (kind: "documentSymbols" | "foldingRanges" | "hover") => string;
  findAllProviderHandles: (
    kind: "documentSymbols" | "foldingRanges" | "hover",
    document: ProviderDocument,
  ) => number[];
  waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  sleep: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
}

export interface CodeNavigationRuntimeDeps {
  extProtocol: unknown;
  languageFeaturesRpcId: number;
  authority: string;
  defaultRemoteAuthority: string;
  useRemote: boolean;
  languageIdFromPath: (filePath: string) => string;
  findAllProviderHandles: CodeNavigationRuntime["findAllProviderHandles"];
  waitFor: (
    condition: () => boolean,
    options: { timeoutMs: number; intervalMs: number },
  ) => Promise<boolean>;
  uriForPath: (filePath: string, authority: string) => unknown;
  sendExtPending: CodeNavigationRuntime["sendExtPending"];
  sendExt: CodeNavigationRuntime["sendExt"];
  readTextFile: CodeNavigationRuntime["readTextFile"];
  sessions: CodeNavigationRuntime["sessions"];
  log: (...args: unknown[]) => void;
}

export interface WorkspaceLifecycleRuntimeDeps {
  extProtocol: unknown;
  state: LifecycleRuntime["state"];
  activeEditorId: string | null;
  setActiveEditorId: (value: string | null) => void;
  activeUriObj: unknown;
  setActiveUriObj: (value: unknown) => void;
  activeTab: unknown;
  setActiveTab: (value: unknown) => void;
  activeGeneration: number | string | null;
  setActiveGeneration: (value: number | string | null) => void;
  nextModelNumber: number;
  setNextModelNumber: (value: number) => void;
  documentRegistry: WorkbenchDocumentRegistry;
  mgmtIpc: LifecycleRuntime["watcher"]["mgmtIpc"];
  setMgmtIpc: (value: LifecycleRuntime["watcher"]["mgmtIpc"]) => void;
  fsWatcherSub: LifecycleRuntime["watcher"]["fsWatcherSub"];
  setFsWatcherSub: (value: LifecycleRuntime["watcher"]["fsWatcherSub"]) => void;
  useRemote: boolean;
  authority: string;
  extRpcIds: LifecycleRuntime["extRpcIds"];
  readTextFile: (path: string) => Promise<string>;
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  uriToString: (uri: unknown) => string;
  resolveLanguageId: (
    path: string,
    text: string,
    requestedLanguageId?: unknown,
  ) => string;
  activateLanguage: (languageId: string) => Promise<unknown>;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => unknown;
  spanTrace: <T>(name: string, fn: () => T) => T;
  spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  logMetrics: (type: string, data: Record<string, unknown>) => void;
  onEvent: (payload: Record<string, unknown>) => void;
  clearProjectScopedSwitchState: LifecycleRuntime["clearProjectScopedSwitchState"];
  sha1Short: (text: string) => string;
  randomUuid: () => string;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface ExtensionCatalogRuntimeDeps {
  env: Record<string, string | undefined>;
  extensions: unknown[];
  productVersion: string | null;
  rawExtensionConfigs: ConfigurationRuntime["rawExtensionConfigs"];
  readTextFile: (path: string) => Promise<string>;
  joinPath: (...parts: string[]) => string;
  readTextFileSync: (path: string) => string;
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  randomUuid: () => string;
  sha1Short: (text: string) => string;
  logMetrics: (type: string, data: Record<string, unknown>) => void;
  log: (...args: unknown[]) => void;
}

export interface ManagementRuntimeDeps {
  env: Record<string, string | undefined>;
  mgmt: ManagementRuntime["refs"]["mgmt"];
  setMgmt: (value: ManagementRuntime["refs"]["mgmt"]) => void;
  mgmtIpc: ManagementRuntime["refs"]["mgmtIpc"];
  setMgmtIpc: (value: ManagementRuntime["refs"]["mgmtIpc"]) => void;
  useRemote: boolean;
  setUseRemote: (value: boolean) => void;
  authority: string;
  setAuthority: (value: string) => void;
  productVersion: string | null;
  setProductVersion: (value: string | null) => void;
  rawExtensionConfigs: ConfigurationRuntime["rawExtensionConfigs"];
  setRawExtensionConfigs: (value: ConfigurationRuntime["rawExtensionConfigs"]) => void;
  extensions: unknown[];
  setExtensions: (value: unknown[]) => void;
  state: { mgmtConnected: boolean };
  defaults: {
    codeServerHttp: string;
    codeServerSocketPath: string | null;
    remoteAuthority: string;
  };
  signService: unknown;
  connectionTypes: { Management: unknown };
  createSocketFactory: (options: { wsSchema: string; basePathname: string; socketPath?: string | null }) => unknown;
  connectRemoteAgent: (options: Record<string, unknown>) => Promise<{ protocol: unknown }>;
  createMgmtIpc: (protocol: unknown, authority: string) => NonNullable<ManagementRuntime["refs"]["mgmtIpc"]>;
  randomUuid: () => string;
  spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  discoverServerRootPath: (httpBase: string, folder: string | null, socketPath: string | null) => Promise<string>;
  commitFromServerRootPath: (serverRootPath: string) => string | null;
  scanExtensionsFromDisk: (authority: string | null) => Promise<unknown[]>;
  extractExtensionConfigDefaults: (scannedExtensions: unknown[]) => unknown;
  sanitizeExtensionForInit: (ext: unknown, authority: string | null) => unknown;
  extensionIdentifierFrom: (ext: unknown) => string | null;
  loadProductVersionFromAppRoot: (envData: unknown) => Promise<string | null>;
  buildExtHostInitData: ManagementRuntime["buildExtHostInitData"];
  setupFileWatcher: (workspaceRoot: string | null) => Promise<void>;
  onEvent: (payload: Record<string, unknown>) => void;
  log: (...args: unknown[]) => void;
}

export interface ExtensionHostRuntimeDeps {
  state: ExtensionHostRuntime["state"];
  ext: ExtensionHostRuntime["refs"]["ext"];
  setExt: (value: ExtensionHostRuntime["refs"]["ext"]) => void;
  signService: unknown;
  connectionTypes: ExtensionHostRuntime["connectionTypes"];
  bootstrapLanguageIds: string[];
  rpcConfigSource: string;
  extMsgTraceEvery: number;
  extMsgTraceMax: number;
  initSizeProfile: boolean;
  initSizeMaxItems: number;
  extHandshake: ExtensionHostRuntime["refs"]["extHandshake"];
  setExtHandshake: (value: ExtensionHostRuntime["refs"]["extHandshake"]) => void;
  extMsgTrace: ExtensionHostRuntime["refs"]["extMsgTrace"];
  setExtMsgTrace: (value: ExtensionHostRuntime["refs"]["extMsgTrace"]) => void;
  extMsgCount: number;
  setExtMsgCount: (value: number) => void;
  debugExtReqSeen: number;
  setDebugExtReqSeen: (value: number) => void;
  connectRemoteAgent: ExtensionHostRuntime["connectRemoteAgent"];
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
  buildConfigurationInitData: ExtensionHostRuntime["buildConfigurationInitData"];
  sendExt: ExtensionHostRuntime["sendExt"];
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  sha1Short: (text: string) => string;
  resetExtRequestIds: () => void;
  log: (...args: unknown[]) => void;
}

export interface ExtHostDispatchRuntimeDeps {
  state: ExtHostDispatchRuntime["state"];
  providerRegistry: ExtHostDispatchRuntime["providerRegistry"];
  requestOwner: ExtHostDispatchRuntime["extRequests"];
  replyDropMethods: ReadonlySet<string>;
  replyEmptyMethods: ReadonlySet<string>;
  replyNullMethods: ReadonlySet<string>;
  mainThreadConsoleRpcId: number;
  mainThreadExtensionServiceRpcId: number;
  mainThreadLoggerRpcId: number;
  mainThreadOutputServiceRpcId: number;
  mainThreadStatusBarRpcId: number;
  mainThreadStorageRpcId: number;
  extHostWorkspaceRpcId: number;
  extensionActivity: ExtHostDispatchRuntime["extensionActivity"];
  initializeExtensionStorage: ExtHostDispatchRuntime["initializeExtensionStorage"];
  setExtensionStorageValue: ExtHostDispatchRuntime["setExtensionStorageValue"];
  handleWebviewRequest: ExtHostDispatchRuntime["handleWebviewRequest"];
  debugExtReqSeen: number;
  setDebugExtReqSeen: (value: number) => void;
  debugExtReplySeen: number;
  setDebugExtReplySeen: (value: number) => void;
  debugMainThreadReplySeen: number;
  setDebugMainThreadReplySeen: (value: number) => void;
  onEvent: (payload: Record<string, unknown>) => void;
  sendPayload: (payload: Uint8Array) => void;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => unknown;
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

export interface TransportRuntimeDeps {
  requestOwner: SentRequestOwnerLike;
  extProtocol: TransportRuntime["refs"]["extProtocol"];
  mgmtProtocol: TransportRuntime["refs"]["mgmtProtocol"];
  mgmtIpc: TransportRuntime["refs"]["mgmtIpc"];
  fsWatcherSub: TransportRuntime["refs"]["watcherSub"];
  state: RuntimeBuilderState;
  encodeJsonRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => Uint8Array;
  encodeMixedRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => Uint8Array;
  wrapPayload: (payload: Uint8Array) => unknown;
  onEvent: (payload: Record<string, unknown>) => void;
  nowMs: () => number;
  setFsWatcherSub: (value: TransportRuntime["refs"]["watcherSub"]) => void;
  setMgmtIpc: (value: TransportRuntime["refs"]["mgmtIpc"]) => void;
  setMgmtProtocol: (value: TransportRuntime["refs"]["mgmtProtocol"]) => void;
  setExtProtocol: (value: TransportRuntime["refs"]["extProtocol"]) => void;
  resetHandshake: () => void;
  resetConnecting: () => void;
  clearLanguageCatalogCache: () => void;
}

export interface DocumentContentRuntimeDeps {
  extProtocol: unknown;
  useRemote: boolean;
  authority: string;
  defaultRemoteAuthority: string;
  extHostDocumentContentProvidersRpcId: number;
  documentRegistry: WorkbenchDocumentRegistry;
  readTextFile: (path: string) => Promise<string>;
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  statPath: (path: string) => Promise<LocalFsStatsLike>;
  languageIdFromPath: (path: string) => string;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => unknown;
  sendExtPending: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    pendingOptions: TransportPendingOptions,
  ) => { req: number; promise: Promise<unknown> };
  log: (...args: unknown[]) => void;
}

function ensureConnected(extProtocol: unknown): void {
  if (!extProtocol) throw new Error("not connected");
}

export function createCompletionRuntime(deps: CompletionRuntimeDeps): CompletionRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    documentScheme: () => deps.useRemote ? "vscode-remote" : "file",
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    didChange: (params: Record<string, unknown>, opts: { waitForAck: true; timeoutMs: number }) => deps.didChange(params, opts),
    findAllProviderHandles: (kind: "completions", document: ProviderDocument) => deps.findAllProviderHandles(kind, document),
    waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => deps.waitFor(condition, options),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    log: (message: string) => deps.log(message),
    warn: (message: string, detail?: unknown) => deps.warn(message, detail),
  };
}

export function createDocumentColorRuntime(deps: DocumentColorRuntimeDeps): DocumentColorRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    documentScheme: () => deps.useRemote ? "vscode-remote" : "file",
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    didChange: (params: Record<string, unknown>, opts: { waitForAck: true; timeoutMs: number }) => deps.didChange(params, opts),
    findAllProviderHandles: (kind: "documentColors", document: ProviderDocument) => deps.findAllProviderHandles(kind, document),
    waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => deps.waitFor(condition, options),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    log: (message: string) => deps.log(message),
    warn: (message: string, detail?: unknown) => deps.warn(message, detail),
  };
}

export function createInlineCompletionRuntime(deps: InlineCompletionRuntimeDeps): InlineCompletionRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    didChange: (params: Record<string, unknown>, opts: { waitForAck: true; timeoutMs: number }) => deps.didChange(params, opts),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    sendExtAwaitTerminalReply: (rpcId: number, method: string, args: unknown[], cancellable: boolean, timeoutMs: number) =>
      deps.sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs),
    log: (message: string) => deps.log(message),
    warn: (message: string, detail?: unknown) => deps.warn(message, detail),
  };
}

export function createInlayHintsRuntime(deps: InlayHintsRuntimeDeps): InlayHintsRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    sendExtAwaitTerminalReply: (rpcId: number, method: string, args: unknown[], cancellable: boolean, timeoutMs: number) =>
      deps.sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs),
    log: (message: string) => deps.log(message),
    warn: (message: string, detail?: unknown) => deps.warn(message, detail),
  };
}

export function createSemanticTokensRuntime(deps: SemanticTokensRuntimeDeps): SemanticRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    documentScheme: () => deps.useRemote ? "vscode-remote" : "file",
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    didChange: (params: Record<string, unknown>, opts: { waitForAck: true; timeoutMs: number }) => deps.didChange(params, opts),
    findAllProviderHandles: (kind: "semanticTokens", languageId: string) => deps.findAllProviderHandles(kind, languageId),
    findSemanticFullHandles: (document: ProviderDocument) => deps.findSemanticFullHandles(document),
    findSemanticRangeHandles: (document: ProviderDocument) => deps.findSemanticRangeHandles(document),
    getProjectionDocument: (path: string) => deps.getProjectionDocument(path),
    getProjection: (path: string, languageId: string, textFingerprint?: string | null) =>
      deps.getProjection(path, languageId, textFingerprint),
    getProjectionGeneration: () => deps.getProjectionGeneration(),
    storeProjection: (document, result, expectedProviderGeneration) =>
      deps.storeProjection(document, result, expectedProviderGeneration),
    releaseResult: (providerHandle, resultId) =>
      deps.releaseResult(providerHandle, resultId),
    waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => deps.waitFor(condition, options),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    getProvider: (kind: "semanticTokens", handle: number) => deps.getProvider(kind, handle),
    log: (message: string) => deps.log(message),
    warn: (message: string) => deps.warn(message),
    timeLabel: () => deps.timeLabel(),
  };
}

export function createDocumentFeatureRuntime(deps: DocumentFeatureRuntimeDeps): StructureRuntime & HoverRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () => String(deps.authority ?? deps.defaultRemoteAuthority),
    documentScheme: () => deps.useRemote ? "vscode-remote" : "file",
    languageIdFromPath: (filePath: string) => deps.languageIdFromPath(filePath),
    getDocumentVersion: (path: string) => deps.getDocumentVersion(path),
    getActiveGeneration: () => deps.getActiveGeneration(),
    updateActiveDocument: (path: string, uriObj: unknown, languageId: string) => deps.updateActiveDocument(path, uriObj, languageId),
    selectorGroupsSummary: (kind: "documentSymbols" | "foldingRanges" | "hover") => deps.selectorGroupsSummary(kind),
    findAllProviderHandles: (kind: "documentSymbols" | "foldingRanges" | "hover", document: ProviderDocument) => deps.findAllProviderHandles(kind, document),
    waitFor: (condition: () => boolean, options: { timeoutMs: number; intervalMs: number }) => deps.waitFor(condition, options),
    uriForPath: (filePath: string, authority: string) => deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    sleep: (ms: number) => deps.sleep(ms),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createCodeNavigationRuntime(
  deps: CodeNavigationRuntimeDeps,
): CodeNavigationRuntime {
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    languageFeaturesRpcId: deps.languageFeaturesRpcId,
    defaultAuthority: () =>
      String(deps.authority ?? deps.defaultRemoteAuthority),
    documentScheme: () => deps.useRemote ? "vscode-remote" : "file",
    languageIdFromPath: (filePath: string) =>
      deps.languageIdFromPath(filePath),
    findAllProviderHandles: (kind, document) =>
      deps.findAllProviderHandles(kind, document),
    waitFor: (condition, options) => deps.waitFor(condition, options),
    uriForPath: (filePath, authority) =>
      deps.uriForPath(filePath, authority),
    sendExtPending: (rpcId, method, args, cancellable, pendingOptions) =>
      deps.sendExtPending(
        rpcId,
        method,
        args,
        cancellable,
        pendingOptions,
      ),
    sendExt: (rpcId, method, args, cancellable = false) =>
      deps.sendExt(rpcId, method, args, cancellable),
    readTextFile: (path) => deps.readTextFile(path),
    sessions: deps.sessions,
    log: (...args) => deps.log(...args),
  };
}

export function createWorkspaceLifecycleRuntime(deps: WorkspaceLifecycleRuntimeDeps): LifecycleRuntime {
  let currentActiveEditorId = deps.activeEditorId;
  let currentActiveUriObj = deps.activeUriObj;
  let currentActiveTab = deps.activeTab;
  let currentActiveGeneration = deps.activeGeneration;
  let currentNextModelNumber = deps.nextModelNumber;
  let currentMgmtIpc = deps.mgmtIpc;
  let currentFsWatcherSub = deps.fsWatcherSub;
  return {
    ensureConnected: () => ensureConnected(deps.extProtocol),
    state: deps.state,
    session: {
      get activeEditorId() { return currentActiveEditorId; },
      set activeEditorId(value: string | null) { currentActiveEditorId = value; deps.setActiveEditorId(value); },
      get activeUriObj() { return currentActiveUriObj; },
      set activeUriObj(value: unknown) { currentActiveUriObj = value; deps.setActiveUriObj(value); },
      get activeTab() { return currentActiveTab; },
      set activeTab(value: unknown) { currentActiveTab = value; deps.setActiveTab(value); },
      get activeGeneration() { return currentActiveGeneration; },
      set activeGeneration(value: number | string | null) { currentActiveGeneration = value; deps.setActiveGeneration(value); },
      get nextModelNumber() { return currentNextModelNumber; },
      set nextModelNumber(value: number) { currentNextModelNumber = value; deps.setNextModelNumber(value); },
      documentRegistry: deps.documentRegistry,
    },
    watcher: {
      get mgmtIpc() { return currentMgmtIpc; },
      set mgmtIpc(value: LifecycleRuntime["watcher"]["mgmtIpc"]) { currentMgmtIpc = value; deps.setMgmtIpc(value); },
      get fsWatcherSub() { return currentFsWatcherSub; },
      set fsWatcherSub(value: LifecycleRuntime["watcher"]["fsWatcherSub"]) { currentFsWatcherSub = value; deps.setFsWatcherSub(value); },
    },
    useRemote: deps.useRemote,
    authority: deps.authority,
    extRpcIds: deps.extRpcIds,
    readTextFile: (path: string) => deps.readTextFile(path),
    uriForPath: (path: string, authority: string | null) => deps.uriForPath(path, authority),
    uriToString: (uri: unknown) => deps.uriToString(uri),
    resolveLanguageId: (
      path: string,
      text: string,
      requestedLanguageId?: unknown,
    ) => deps.resolveLanguageId(path, text, requestedLanguageId),
    activateLanguage: (languageId: string) =>
      deps.activateLanguage(languageId),
    sendExt: (rpcId: number, method: string, args: unknown[], cancellable = false) => deps.sendExt(rpcId, method, args, cancellable),
    spanTrace: <T>(name: string, fn: () => T) => deps.spanTrace(name, fn),
    spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => deps.spanTraceAsync(name, fn),
    logMetrics: (type: string, data: Record<string, unknown>) => deps.logMetrics(type, data),
    onEvent: (payload: Record<string, unknown>) => deps.onEvent(payload),
    clearProjectScopedSwitchState: (reason: string) => deps.clearProjectScopedSwitchState(reason),
    sha1Short: (text: string) => deps.sha1Short(text),
    randomUuid: () => deps.randomUuid(),
    log: (...args: unknown[]) => deps.log(...args),
    warn: (...args: unknown[]) => deps.warn(...args),
  };
}

export function createExtensionCatalogRuntime(deps: ExtensionCatalogRuntimeDeps): ExtensionCatalogRuntime {
  return {
    env: deps.env,
    readTextFile: (filePath: string) => deps.readTextFile(filePath),
    joinPath: (...parts: string[]) => deps.joinPath(...parts),
    randomUuid: () => deps.randomUuid(),
    sha1Short: (text: string) => deps.sha1Short(text),
    logMetrics: (type: string, data: Record<string, unknown>) => deps.logMetrics(type, data),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createConfigurationRuntime(deps: ExtensionCatalogRuntimeDeps): ConfigurationRuntime {
  return {
    env: deps.env,
    extensions: deps.extensions,
    rawExtensionConfigs: deps.rawExtensionConfigs,
    readTextFileSync: (filePath: string) => deps.readTextFileSync(filePath),
    joinPath: (...parts: string[]) => deps.joinPath(...parts),
    uriForPath: (filePath: string, authority: string | null) => deps.uriForPath(filePath, authority),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createManagementRuntime(deps: ManagementRuntimeDeps): ManagementRuntime {
  let currentMgmt = deps.mgmt;
  let currentMgmtIpc = deps.mgmtIpc;
  let currentUseRemote = deps.useRemote;
  let currentAuthority = deps.authority;
  let currentProductVersion = deps.productVersion;
  let currentRawExtensionConfigs = deps.rawExtensionConfigs;
  let currentExtensions = deps.extensions;
  return {
    env: deps.env,
    defaults: deps.defaults,
    refs: {
      get mgmt() { return currentMgmt; },
      set mgmt(value: ManagementRuntime["refs"]["mgmt"]) { currentMgmt = value; deps.setMgmt(value); },
      get mgmtIpc() { return currentMgmtIpc; },
      set mgmtIpc(value: ManagementRuntime["refs"]["mgmtIpc"]) { currentMgmtIpc = value; deps.setMgmtIpc(value); },
      get useRemote() { return currentUseRemote; },
      set useRemote(value: boolean) { currentUseRemote = value; deps.setUseRemote(value); },
      get authority() { return currentAuthority; },
      set authority(value: string) { currentAuthority = value; deps.setAuthority(value); },
      get productVersion() { return currentProductVersion; },
      set productVersion(value: string | null) { currentProductVersion = value; deps.setProductVersion(value); },
      get rawExtensionConfigs() { return currentRawExtensionConfigs; },
      set rawExtensionConfigs(value: ConfigurationRuntime["rawExtensionConfigs"]) { currentRawExtensionConfigs = value; deps.setRawExtensionConfigs(value); },
      get extensions() { return currentExtensions; },
      set extensions(value: unknown[]) { currentExtensions = value; deps.setExtensions(value); },
    },
    state: deps.state,
    signService: deps.signService,
    connectionTypes: deps.connectionTypes,
    createSocketFactory: (options: { wsSchema: string; basePathname: string; socketPath?: string | null }) => deps.createSocketFactory(options),
    connectRemoteAgent: (options: Record<string, unknown>) => deps.connectRemoteAgent(options),
    createMgmtIpc: (protocol: unknown, authority: string) => deps.createMgmtIpc(protocol, authority),
    randomUuid: () => deps.randomUuid(),
    spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => deps.spanTraceAsync(name, fn),
    discoverServerRootPath: (httpBase: string, folder: string | null, socketPath: string | null) => deps.discoverServerRootPath(httpBase, folder, socketPath),
    commitFromServerRootPath: (serverRootPath: string) => deps.commitFromServerRootPath(serverRootPath),
    scanExtensionsFromDisk: (authority: string | null) => deps.scanExtensionsFromDisk(authority),
    extractExtensionConfigDefaults: (scannedExtensions: unknown[]) => deps.extractExtensionConfigDefaults(scannedExtensions),
    sanitizeExtensionForInit: (ext: unknown, authority: string | null) => deps.sanitizeExtensionForInit(ext, authority),
    extensionIdentifierFrom: (ext: unknown) => deps.extensionIdentifierFrom(ext),
    loadProductVersionFromAppRoot: (envData: unknown) => deps.loadProductVersionFromAppRoot(envData),
    buildExtHostInitData: (options) => deps.buildExtHostInitData(options),
    setupFileWatcher: (workspaceRoot: string | null) => deps.setupFileWatcher(workspaceRoot),
    onEvent: (payload: Record<string, unknown>) => deps.onEvent(payload),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createExtensionHostRuntime(deps: ExtensionHostRuntimeDeps): ExtensionHostRuntime {
  let currentExt = deps.ext;
  let currentExtHandshake = deps.extHandshake;
  let currentExtMsgTrace = deps.extMsgTrace;
  let currentExtMsgCount = deps.extMsgCount;
  let currentDebugExtReqSeen = deps.debugExtReqSeen;
  return {
    state: deps.state,
    refs: {
      get ext() { return currentExt; },
      set ext(value: ExtensionHostRuntime["refs"]["ext"]) { currentExt = value; deps.setExt(value); },
      get extHandshake() { return currentExtHandshake; },
      set extHandshake(value: ExtensionHostRuntime["refs"]["extHandshake"]) { currentExtHandshake = value; deps.setExtHandshake(value); },
      get extMsgTrace() { return currentExtMsgTrace; },
      set extMsgTrace(value: ExtensionHostRuntime["refs"]["extMsgTrace"]) { currentExtMsgTrace = value; deps.setExtMsgTrace(value); },
      get extMsgCount() { return currentExtMsgCount; },
      set extMsgCount(value: number) { currentExtMsgCount = value; deps.setExtMsgCount(value); },
      get debugExtReqSeen() { return currentDebugExtReqSeen; },
      set debugExtReqSeen(value: number) { currentDebugExtReqSeen = value; deps.setDebugExtReqSeen(value); },
    },
    signService: deps.signService,
    connectionTypes: deps.connectionTypes,
    bootstrapLanguageIds: deps.bootstrapLanguageIds,
    rpcConfigSource: deps.rpcConfigSource,
    extMsgTraceEvery: deps.extMsgTraceEvery,
    extMsgTraceMax: deps.extMsgTraceMax,
    initSizeProfile: deps.initSizeProfile,
    initSizeMaxItems: deps.initSizeMaxItems,
    connectRemoteAgent: (options: Record<string, unknown>) => deps.connectRemoteAgent(options),
    randomUuid: () => deps.randomUuid(),
    spanTrace: <T>(name: string, fn: () => T) => deps.spanTrace(name, fn),
    spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => deps.spanTraceAsync(name, fn),
    logMetrics: (type: string, data: Record<string, unknown>) => deps.logMetrics(type, data),
    memSnapshot: () => deps.memSnapshot(),
    jsonSizeOrSkip: (value: unknown, maxItems: number) => deps.jsonSizeOrSkip(value, maxItems),
    onEvent: (payload: Record<string, unknown>) => deps.onEvent(payload),
    sendExtInitText: (text: string) => deps.sendExtInitText(text),
    decodeExtMessage: (payload: Uint8Array) => deps.decodeExtMessage(payload),
    handleDecodedExtMessage: (message: DecodedExtMessage) => deps.handleDecodedExtMessage(message),
    buildConfigurationInitData: (folder: string | null, authority: string | null) => deps.buildConfigurationInitData(folder, authority),
    sendExt: (rpcId: number, method: string, args: unknown[], cancellable = false) => deps.sendExt(rpcId, method, args, cancellable),
    uriForPath: (path: string, authority: string | null) => deps.uriForPath(path, authority),
    sha1Short: (text: string) => deps.sha1Short(text),
    resetExtRequestIds: () => deps.resetExtRequestIds(),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createExtHostDispatchRuntime(deps: ExtHostDispatchRuntimeDeps): ExtHostDispatchRuntime {
  let currentDebugExtReqSeen = deps.debugExtReqSeen;
  let currentDebugExtReplySeen = deps.debugExtReplySeen;
  let currentDebugMainThreadReplySeen = deps.debugMainThreadReplySeen;
  return {
    replyDropMethods: deps.replyDropMethods,
    replyEmptyMethods: deps.replyEmptyMethods,
    replyNullMethods: deps.replyNullMethods,
    state: deps.state,
    providerRegistry: deps.providerRegistry,
    extRequests: deps.requestOwner,
    rpcIds: {
      MainThreadConsole: deps.mainThreadConsoleRpcId,
      MainThreadExtensionService: deps.mainThreadExtensionServiceRpcId,
      MainThreadLogger: deps.mainThreadLoggerRpcId,
      MainThreadOutputService: deps.mainThreadOutputServiceRpcId,
      MainThreadStatusBar: deps.mainThreadStatusBarRpcId,
      MainThreadStorage: deps.mainThreadStorageRpcId,
      ExtHostWorkspace: deps.extHostWorkspaceRpcId,
    },
    extensionActivity: deps.extensionActivity,
    initializeExtensionStorage: (shared, extensionId) => deps.initializeExtensionStorage(shared, extensionId),
    setExtensionStorageValue: (shared, extensionId, value) => deps.setExtensionStorageValue(shared, extensionId, value),
    handleWebviewRequest: (message) => deps.handleWebviewRequest(message),
    debug: {
      shouldEmitExtRequestEvent: () => currentDebugExtReqSeen < 200,
      markExtRequestEvent: () => {
        currentDebugExtReqSeen += 1;
        deps.setDebugExtReqSeen(currentDebugExtReqSeen);
      },
      shouldEmitExtReplyEvent: () => currentDebugExtReplySeen < 50,
      markExtReplyEvent: () => {
        currentDebugExtReplySeen += 1;
        deps.setDebugExtReplySeen(currentDebugExtReplySeen);
      },
      shouldEmitMainThreadReplyEvent: () => currentDebugMainThreadReplySeen < 80,
      markMainThreadReplyEvent: () => {
        currentDebugMainThreadReplySeen += 1;
        deps.setDebugMainThreadReplySeen(currentDebugMainThreadReplySeen);
      },
    },
    nowMs: () => Date.now(),
    timeLabel: () => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
    },
    onEvent: (payload: Record<string, unknown>) => deps.onEvent(payload),
    sendPayload: (payload: Uint8Array) => deps.sendPayload(payload),
    sendExt: (rpcId: number, method: string, args: unknown[], cancellable = false) => deps.sendExt(rpcId, method, args, cancellable),
    checkWorkspaceExists: (folders: unknown, includes: unknown) => deps.checkWorkspaceExists(folders, includes),
    startFileSearch: (includeFolder: unknown, options: unknown) => deps.startFileSearch(includeFolder, options),
    tryOpenDocument: (uri: unknown, options: unknown) => deps.tryOpenDocument(uri, options),
    provideTextDocumentContent: (handle: number, uri: unknown) => deps.provideTextDocumentContent(handle, uri),
    readVirtualVscodeUriBuffer: (uri: unknown) => deps.readVirtualVscodeUriBuffer(uri),
    statVirtualVscodeUri: (uri: unknown) => deps.statVirtualVscodeUri(uri),
    fsPathFromUri: (uri: unknown) => deps.fsPathFromUri(uri),
    readLocalUriBuffer: (uri: unknown) => deps.readLocalUriBuffer(uri),
    statLocalUri: (uri: unknown) => deps.statLocalUri(uri),
    uriObjToStringSafe: (uri: unknown) => deps.uriObjToStringSafe(uri),
    log: (...args: unknown[]) => deps.log(...args),
  };
}

export function createTransportRuntime(deps: TransportRuntimeDeps): TransportRuntime {
  let currentExtProtocol = deps.extProtocol;
  let currentMgmtProtocol = deps.mgmtProtocol;
  let currentMgmtIpc = deps.mgmtIpc;
  let currentFsWatcherSub = deps.fsWatcherSub;
  return {
    requestOwner: deps.requestOwner,
    refs: {
      get extProtocol() { return currentExtProtocol; },
      get mgmtProtocol() { return currentMgmtProtocol; },
      get watcherSub() { return currentFsWatcherSub; },
      get mgmtIpc() { return currentMgmtIpc; },
    },
    state: deps.state,
    wrapPayload: (payload: Uint8Array) => deps.wrapPayload(payload),
    encodeJsonRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => deps.encodeJsonRequest(input),
    encodeMixedRequest: (input: { req: number; rpcId: number; method: string; args?: readonly unknown[] | null; cancellable?: boolean }) => deps.encodeMixedRequest(input),
    onEvent: (payload: Record<string, unknown>) => deps.onEvent(payload),
    nowMs: () => deps.nowMs(),
    setWatcherSub: (value) => { currentFsWatcherSub = value; deps.setFsWatcherSub(value); },
    setMgmtIpc: (value) => { currentMgmtIpc = value; deps.setMgmtIpc(value); },
    setMgmtProtocol: (value) => { currentMgmtProtocol = value; deps.setMgmtProtocol(value); },
    setExtProtocol: (value) => { currentExtProtocol = value; deps.setExtProtocol(value); },
    resetHandshake: () => deps.resetHandshake(),
    resetConnecting: () => deps.resetConnecting(),
    clearLanguageCatalogCache: () => deps.clearLanguageCatalogCache(),
  };
}

export function createDocumentContentRuntime(deps: DocumentContentRuntimeDeps): DocumentContentRuntime {
  return {
    extConnected: () => !!deps.extProtocol,
    useRemote: deps.useRemote,
    defaultAuthority: deps.defaultRemoteAuthority,
    extRpcIds: {
      ExtHostDocumentContentProviders: deps.extHostDocumentContentProvidersRpcId,
    },
    documentRegistry: deps.documentRegistry,
    readTextFile: (path: string) => deps.readTextFile(path),
    readBinaryFile: (path: string) => deps.readBinaryFile(path),
    statPath: (path: string) => deps.statPath(path),
    languageIdFromPath: (path: string) => deps.languageIdFromPath(path),
    sendExt: (rpcId: number, method: string, args: unknown[], cancellable = false) => deps.sendExt(rpcId, method, args, cancellable),
    sendExtPending: (rpcId: number, method: string, args: unknown[], cancellable: boolean, pendingOptions: TransportPendingOptions) =>
      deps.sendExtPending(rpcId, method, args, cancellable, pendingOptions),
    log: (...args: unknown[]) => deps.log(...args),
  };
}
