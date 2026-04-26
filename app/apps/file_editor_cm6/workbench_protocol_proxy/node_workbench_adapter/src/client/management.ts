export interface ManagementState {
  mgmtConnected: boolean;
}

export interface ManagementMutableRefs {
  mgmt: { protocol: unknown } | null;
  mgmtIpc: {
    whenInitialized: (timeoutMs: number) => Promise<void>;
    call: (channel: string, method: string, args: unknown) => Promise<unknown>;
    listen: (channel: string, event: string, args: unknown[]) => { event: (listener: (payload: unknown) => void) => void; dispose?: () => void };
    dispose?: () => void;
  } | null;
  useRemote: boolean;
  authority: string;
  productVersion: string | null;
  rawExtensionConfigs: unknown;
  extensions: unknown[];
}

export interface ManagementRuntime {
  env: Record<string, string | undefined>;
  defaults: {
    codeServerHttp: string;
    remoteAuthority: string;
  };
  refs: ManagementMutableRefs;
  state: ManagementState;
  signService: unknown;
  connectionTypes: {
    Management: unknown;
  };
  createSocketFactory: (options: { wsSchema: string; basePathname: string }) => unknown;
  connectRemoteAgent: (options: Record<string, unknown>) => Promise<{ protocol: unknown }>;
  createMgmtIpc: (protocol: unknown, authority: string) => {
    whenInitialized: (timeoutMs: number) => Promise<void>;
    call: (channel: string, method: string, args: unknown) => Promise<unknown>;
    listen: (channel: string, event: string, args: unknown[]) => { event: (listener: (payload: unknown) => void) => void; dispose?: () => void };
    dispose?: () => void;
  };
  randomUuid: () => string;
  spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  discoverServerRootPath: (httpBase: string, folder: string | null) => Promise<string>;
  commitFromServerRootPath: (serverRootPath: string) => string | null;
  scanExtensionsFromDisk: (authority: string | null) => Promise<unknown[]>;
  extractExtensionConfigDefaults: (scannedExtensions: unknown[]) => unknown;
  sanitizeExtensionForInit: (ext: unknown, authority: string | null) => unknown;
  extensionIdentifierFrom: (ext: unknown) => string | null;
  loadProductVersionFromAppRoot: (envData: unknown) => Promise<string | null>;
  buildExtHostInitData: (options: {
    authority: string | null;
    commit: string | null;
    envData: unknown;
    scannedExtensions: unknown[];
    folder: string | null;
    useRemote: boolean;
    productVersion: string | null;
  }) => unknown;
  setupFileWatcher: (workspaceRoot: string | null) => Promise<void>;
  onEvent: (payload: Record<string, unknown>) => void;
  log: (...args: unknown[]) => void;
}

export interface ManagementConnectResult {
  proxyHttp: string;
  token: string;
  authority: string;
  useRemote: boolean;
  serverRootPath: string;
  commit: string | null;
  workspaceTrusted: boolean;
  workspaceRoot: string | null;
  socketFactory: unknown;
  connectTo: { host: string; port: number };
  extArgs: { language: string; break: boolean; port: null; env: { VSCODE_PROXY_URI: string } };
  envData: unknown;
  scannedExtensions: unknown[];
  extInitData: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function includeBuiltinFromEnv(env: Record<string, string | undefined>): boolean {
  const raw = String(env.TE2_INCLUDE_BUILTIN_EXTS || "").toLowerCase().trim();
  return !(raw === "0" || raw === "false" || raw === "no");
}

function shouldSkipMgmtEnv(env: Record<string, string | undefined>): boolean {
  return String(env.TE2_SKIP_MGMT_ENV || "") === "1";
}

function shouldSkipMgmtScan(env: Record<string, string | undefined>): boolean {
  return String(env.TE2_SKIP_MGMT_SCAN || "") === "1";
}

function extensionsSource(env: Record<string, string | undefined>): string {
  return String(env.TE2_EXTENSIONS_SOURCE || "scan").toLowerCase();
}

function coerceWorkspaceRoot(params: Record<string, unknown>, folder: string | null): string | null {
  const workspaceFolder = typeof params.workspaceFolder === "string" ? params.workspaceFolder : null;
  return workspaceFolder ?? folder;
}

function coerceConnectTo(proxyHttp: string): { proxyUrl: URL; connectTo: { host: string; port: number } } {
  const proxyUrl = new URL(proxyHttp);
  return {
    proxyUrl,
    connectTo: {
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)),
    },
  };
}

async function getEnvironmentData(runtime: ManagementRuntime, authority: string): Promise<unknown> {
  if (shouldSkipMgmtEnv(runtime.env) || !runtime.refs.mgmtIpc) return null;
  return await runtime.spanTraceAsync("connect.mgmtIpc.getEnvironmentData", () =>
    runtime.refs.mgmtIpc!.call("remoteextensionsenvironment", "getEnvironmentData", { remoteAuthority: authority }),
  );
}

async function scanExtensions(
  runtime: ManagementRuntime,
  useRemote: boolean,
  authority: string,
): Promise<unknown[]> {
  if (shouldSkipMgmtScan(runtime.env)) return [];
  const source = extensionsSource(runtime.env);
  if (source === "disk") {
    return await runtime.spanTraceAsync("connect.scanExtensions.disk", () => runtime.scanExtensionsFromDisk(useRemote ? authority : null));
  }
  if (!runtime.refs.mgmtIpc) return [];
  const scanned = await runtime.spanTraceAsync("connect.scanExtensions.rpc", () =>
    runtime.refs.mgmtIpc!.call("remoteExtensionsScanner", "scanExtensions", ["en", null, [], null, null]),
  );
  if (!Array.isArray(scanned)) return [];
  const includeBuiltin = includeBuiltinFromEnv(runtime.env);
  return scanned.filter((ext) => includeBuiltin || (isRecord(ext) && ext.isBuiltin === false));
}

function sanitizeScannedExtensions(
  runtime: ManagementRuntime,
  scannedExtensions: unknown[],
  useRemote: boolean,
  authority: string,
): unknown[] {
  try {
    if (String(runtime.env.TE2_DEBUG_SCAN_SHAPE || "") === "1" && Array.isArray(scannedExtensions)) {
      const sample = scannedExtensions.slice(0, 5).map((ext) => {
        const identifier = isRecord(ext) && isRecord(ext.identifier) ? ext.identifier : null;
        const packageJson = isRecord(ext) && isRecord(ext.packageJSON) ? ext.packageJSON : null;
        const id = runtime.extensionIdentifierFrom(ext) ?? (isRecord(ext) ? String(ext.id ?? identifier?.id ?? "") : null);
        const loc = isRecord(ext) ? (ext.extensionLocation ?? ext.location ?? packageJson?.extensionLocation ?? null) : null;
        return {
          id,
          keys: isRecord(ext) ? Object.keys(ext).slice(0, 20) : [],
          loc: isRecord(loc)
            ? { $mid: loc.$mid ?? null, scheme: loc.scheme ?? null, authority: loc.authority ?? null, path: loc.path ?? null, fsPath: loc.fsPath ?? null }
            : null,
        };
      });
      runtime.onEvent({ type: "mgmt/scanExtensions_shape", ts_ms: Date.now(), sample });
    }
    const authForLoc = useRemote ? authority : null;
    if (!Array.isArray(scannedExtensions)) return [];
    return scannedExtensions.map((ext) => runtime.sanitizeExtensionForInit(ext, authForLoc)).filter(Boolean);
  } catch {
    return [];
  }
}

function logLoadedExtensions(runtime: ManagementRuntime, scannedExtensions: unknown[]): void {
  try {
    const extIds = scannedExtensions.map((ext) => runtime.extensionIdentifierFrom(ext) ?? "?").sort();
    const builtinCount = scannedExtensions.filter((ext) => isRecord(ext) && ext.isBuiltin === true).length;
    const userCount = extIds.length - builtinCount;
    runtime.log(`[extensions] loaded ${extIds.length} extensions (${builtinCount} builtin, ${userCount} user): ${extIds.join(", ")}`);
  } catch {
    // logging only
  }
}

export async function loadProductVersionFromAppRoot(
  runtime: { refs: Pick<ManagementMutableRefs, "productVersion">; log: (...args: unknown[]) => void; readTextFile: (path: string) => Promise<string>; joinPath: (...parts: string[]) => string },
  envData: unknown,
): Promise<string | null> {
  if (runtime.refs.productVersion) return runtime.refs.productVersion;
  try {
    const appRoot = isRecord(envData) ? envData.appRoot : null;
    const appRootPath = isRecord(appRoot) ? (appRoot.path ?? appRoot.fsPath ?? null) : null;
    if (!appRootPath || typeof appRootPath !== "string") return null;
    const productPath = runtime.joinPath(String(appRootPath), "product.json");
    const raw = await runtime.readTextFile(productPath);
    const parsed = JSON.parse(raw);
    const version = isRecord(parsed) ? parsed.version : null;
    if (typeof version === "string" && version.trim()) {
      runtime.refs.productVersion = version.trim();
      return runtime.refs.productVersion;
    }
  } catch {
    // preserve current best-effort behavior
  }
  return null;
}

export async function discoverServerRootPath(httpBase: string, folder: string | null): Promise<string> {
  const url = new URL("/", httpBase);
  if (folder) url.searchParams.set("folder", folder);
  const resp = await fetch(url, { headers: { accept: "text/html", "accept-encoding": "identity" } });
  const text = await resp.text();
  const match = text.match(/(stable-[0-9a-f]{40})/);
  if (!match) return "/";
  return `/${match[1]}`;
}

export function commitFromServerRootPath(serverRootPath: string): string | null {
  const match = String(serverRootPath).match(/^\/stable-([0-9a-f]{40})$/);
  return match?.[1] ?? null;
}

export async function connectManagementSession(
  runtime: ManagementRuntime,
  params: Record<string, unknown> = {},
): Promise<ManagementConnectResult> {
  const proxyHttp = typeof params.proxyHttp === "string" ? params.proxyHttp : runtime.defaults.codeServerHttp;
  const token = typeof params.token === "string" ? params.token : "00000000000000000000";
  const folder = typeof params.folder === "string" ? params.folder : null;
  const authority = typeof params.authority === "string" ? params.authority : runtime.defaults.remoteAuthority;
  const useRemote = params.useRemote ?? (String(runtime.env.TE2_USE_REMOTE || "1") === "1");
  const serverRootPath = typeof params.serverRootPath === "string"
    ? params.serverRootPath
    : await runtime.spanTraceAsync("connect.discoverServerRootPath", () => runtime.discoverServerRootPath(proxyHttp, folder));
  const commit = typeof params.commit === "string" ? params.commit : runtime.commitFromServerRootPath(serverRootPath);
  const workspaceTrusted = params.workspaceTrusted ?? true;

  runtime.refs.useRemote = !!useRemote;
  runtime.refs.authority = authority;

  const { proxyUrl, connectTo } = coerceConnectTo(proxyHttp);
  const wsSchema = proxyUrl.protocol === "https:" ? "wss" : "ws";
  const socketFactory = runtime.createSocketFactory({ wsSchema, basePathname: proxyUrl.pathname });

  const mgmt = await runtime.spanTraceAsync("connect.remoteAgent.mgmt", () => runtime.connectRemoteAgent({
    socketFactory,
    connectTo,
    serverRootPath,
    reconnectionToken: runtime.randomUuid(),
    connectionToken: token,
    commit,
    desiredConnectionType: runtime.connectionTypes.Management,
    args: undefined,
    signService: runtime.signService,
    timeoutMs: 15000,
    debugLabel: `renderer-Management-${runtime.randomUuid().slice(0, 8)}`,
  }));
  runtime.refs.mgmt = { protocol: mgmt.protocol };
  runtime.state.mgmtConnected = true;

  try {
    runtime.refs.mgmtIpc?.dispose?.();
  } catch {
    // best effort
  }
  runtime.refs.mgmtIpc = runtime.createMgmtIpc(mgmt.protocol, authority);
  await runtime.spanTraceAsync("connect.mgmtIpc.whenInitialized", () => runtime.refs.mgmtIpc!.whenInitialized(15000));

  let envData: unknown = null;
  try {
    envData = await getEnvironmentData(runtime, authority);
    runtime.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: true, pid: isRecord(envData) ? envData.pid ?? null : null });
  } catch (error) {
    runtime.onEvent({ type: "mgmt/getEnvironmentData", ts_ms: Date.now(), ok: false, error: String((error as Error)?.message ?? error) });
  }

  let scannedExtensions: unknown[] = [];
  try {
    scannedExtensions = await scanExtensions(runtime, !!useRemote, authority);
    runtime.onEvent({
      type: "mgmt/scanExtensions",
      ts_ms: Date.now(),
      ok: true,
      count: Array.isArray(scannedExtensions) ? scannedExtensions.length : null,
      source: shouldSkipMgmtScan(runtime.env) ? "skipped" : extensionsSource(runtime.env),
    });
  } catch (error) {
    runtime.onEvent({ type: "mgmt/scanExtensions", ts_ms: Date.now(), ok: false, error: String((error as Error)?.message ?? error) });
  }

  runtime.refs.rawExtensionConfigs = runtime.extractExtensionConfigDefaults(scannedExtensions);
  scannedExtensions = sanitizeScannedExtensions(runtime, scannedExtensions, !!useRemote, authority);
  logLoadedExtensions(runtime, scannedExtensions);
  runtime.refs.extensions = Array.isArray(scannedExtensions) ? scannedExtensions : [];

  try {
    if (!shouldSkipMgmtScan(runtime.env) && runtime.refs.mgmtIpc) {
      await runtime.spanTraceAsync("connect.whenExtensionsReady", () => runtime.refs.mgmtIpc!.call("remoteExtensionsScanner", "whenExtensionsReady", undefined));
      runtime.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: true });
    }
  } catch (error) {
    runtime.onEvent({ type: "mgmt/whenExtensionsReady", ts_ms: Date.now(), ok: false, error: String((error as Error)?.message ?? error) });
  }

  const proxyUri = typeof params.proxyUri === "string" ? params.proxyUri : `http://${authority}/proxy/{{port}}/`;
  const extArgs = { language: "en", break: false, port: null, env: { VSCODE_PROXY_URI: proxyUri } };
  const workspaceRoot = coerceWorkspaceRoot(params, folder);

  await runtime.setupFileWatcher(workspaceRoot);

  const productVersion = await runtime.loadProductVersionFromAppRoot(envData);
  const extInitData = runtime.buildExtHostInitData({
    authority: useRemote ? authority : null,
    commit,
    envData,
    scannedExtensions,
    folder: workspaceRoot,
    useRemote: !!useRemote,
    productVersion,
  });

  return {
    proxyHttp,
    token,
    authority,
    useRemote: !!useRemote,
    serverRootPath,
    commit,
    workspaceTrusted: workspaceTrusted === true,
    workspaceRoot,
    socketFactory,
    connectTo,
    extArgs,
    envData,
    scannedExtensions,
    extInitData,
  };
}
