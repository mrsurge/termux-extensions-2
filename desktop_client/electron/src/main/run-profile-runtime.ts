import type { Session, WebFrameMain } from "electron";

import type {
  ElectronRunProfileRuntimeMetadata,
  ElectronRunTargetDescriptor,
  ElectronRunTargetRoute,
} from "../shared/app-view-contracts";

const DEVTOOLS_MARKER_PREFIX = "te2-devtools:";
const RUNTIME_MARKER_PREFIX = "te2-run-profile:";
const SOURCE_TIMEOUT_MS = 5_000;

type RuntimeConfig = ElectronRunProfileRuntimeMetadata & {
  targetId?: string;
  targetLabel?: string;
};

function routeEntries(route: ElectronRunTargetDescriptor): ElectronRunTargetRoute[] {
  return route.dto === "RunTargetRouteSet"
    ? [route.primary, ...route.additional]
    : [route];
}

function replaceRequestHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): Record<string, string> {
  const next = { ...headers };
  const lower = name.toLowerCase();
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === lower) delete next[key];
  }
  next[name] = value;
  return next;
}

function replaceResponseHeader(
  headers: Record<string, string[]> | undefined,
  name: string,
  value: string,
): Record<string, string[]> {
  const next = { ...(headers || {}) };
  const lower = name.toLowerCase();
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === lower) delete next[key];
  }
  next[name] = [value];
  return next;
}

function decodeFrameRuntime(name: string): RuntimeConfig | null {
  const prefix = name.startsWith(DEVTOOLS_MARKER_PREFIX)
    ? DEVTOOLS_MARKER_PREFIX
    : name.startsWith(RUNTIME_MARKER_PREFIX)
      ? RUNTIME_MARKER_PREFIX
      : "";
  if (!prefix) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(name.slice(prefix.length))) as Partial<RuntimeConfig>;
    const surfaceId = String(parsed.surfaceId || "").trim();
    if (!surfaceId || parsed.devRuntime !== true) return null;
    return {
      surfaceId,
      profileId: String(parsed.profileId || "").trim(),
      devRuntime: true,
      devTools: parsed.devTools === true,
      workerIdBase: String(parsed.workerIdBase || "rp-prof").trim() || "rp-prof",
      workerLabel: String(parsed.workerLabel || surfaceId).trim(),
      frameworkOrigin: String(parsed.frameworkOrigin || "").trim(),
      targetId: String(parsed.targetId || "").trim(),
      targetLabel: String(parsed.targetLabel || "").trim(),
    };
  } catch {
    return null;
  }
}

function stripModuleExports(source: string): string {
  return source.replace(
    /\bexport\s+(?=(?:async\s+)?function|class|const|let|var)/g,
    "",
  );
}

export class ElectronRunProfileRuntime {
  private readonly originsBySurface = new Map<string, Set<string>>();
  private activeOrigins = new Set<string>();
  private sourceCache: { origin: string; socket: string; bridge: string } | null = null;

  constructor(
    private readonly frameworkSession: Session,
    private readonly browserFrameworkOrigin: () => string,
  ) {
    frameworkSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.resourceType === "webSocket" || !this.matches(details.url)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      let headers = replaceRequestHeader(details.requestHeaders, "Cache-Control", "no-cache");
      headers = replaceRequestHeader(headers, "Pragma", "no-cache");
      callback({ requestHeaders: headers });
    });
    frameworkSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === "webSocket" || !this.matches(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      let headers = replaceResponseHeader(
        details.responseHeaders,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      headers = replaceResponseHeader(headers, "Pragma", "no-cache");
      headers = replaceResponseHeader(headers, "Expires", "0");
      callback({ responseHeaders: headers });
    });
  }

  registerDirect(
    runtime: ElectronRunProfileRuntimeMetadata,
    url: string,
    route?: ElectronRunTargetDescriptor,
  ): void {
    const surfaceId = String(runtime?.surfaceId || "").trim();
    if (!surfaceId || runtime?.devRuntime !== true) return;
    const origins = new Set([new URL(url).origin]);
    if (route) {
      for (const entry of routeEntries(route)) {
        try {
          const target = new URL(entry.originalUrl);
          target.hostname = "127.0.0.1";
          target.port = String(entry.preferredPort);
          origins.add(target.origin);
        } catch {}
      }
    }
    this.originsBySurface.set(surfaceId, origins);
    this.rebuildOrigins();
  }

  release(surfaceId: string): void {
    if (!this.originsBySurface.delete(String(surfaceId || "").trim())) return;
    this.rebuildOrigins();
  }

  clear(): void {
    this.originsBySurface.clear();
    this.activeOrigins = new Set();
    this.sourceCache = null;
  }

  async injectFrame(frame: WebFrameMain): Promise<void> {
    const runtime = decodeFrameRuntime(frame.name);
    const origins = runtime ? this.originsBySurface.get(runtime.surfaceId) : null;
    if (!runtime || !origins || !this.matchesOrigins(frame.url, origins)) return;
    const trustedOrigin = new URL(this.browserFrameworkOrigin()).origin;
    if (new URL(runtime.frameworkOrigin).origin !== trustedOrigin) return;
    const sources = await this.loadSources(trustedOrigin);
    const init = JSON.stringify({
      appId: "code_te2",
      baseUrl: trustedOrigin,
      workerLabel: runtime.workerLabel,
      workerIdPrefix: `${runtime.workerIdBase}-elct`,
      workerOwnerLength: 4,
      uniquePerWindow: true,
    });
    await frame.executeJavaScript(`
      if (!globalThis.__te2RunProfileConsoleBridge) {
        ${sources.socket}
        ${stripModuleExports(sources.bridge)}
        globalThis.__te2RunProfileConsoleBridge = initConsoleBridge(${init});
      }
    `);
  }

  private matches(url: string): boolean {
    try {
      return this.activeOrigins.has(new URL(url).origin);
    } catch {
      return false;
    }
  }

  private matchesOrigins(url: string, origins: Set<string>): boolean {
    try {
      return origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  }

  private rebuildOrigins(): void {
    const next = new Set<string>();
    for (const origins of this.originsBySurface.values()) {
      for (const origin of origins) next.add(origin);
    }
    this.activeOrigins = next;
  }

  private async loadSources(origin: string): Promise<{ socket: string; bridge: string }> {
    if (this.sourceCache?.origin === origin) return this.sourceCache;
    const [socket, bridge] = await Promise.all([
      this.fetchSource(`${origin}/static/vendor/socket.io.min.js`),
      this.fetchSource(`${origin}/static/js/te2_console_bridge.js`),
    ]);
    this.sourceCache = { origin, socket, bridge };
    return this.sourceCache;
  }

  private async fetchSource(url: string): Promise<string> {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
    const source = await response.text();
    if (!source) throw new Error(`${url} is empty`);
    return `${source}\n//# sourceURL=${url}`;
  }
}
