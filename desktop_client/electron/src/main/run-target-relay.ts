import * as net from "node:net";

import type {
  ElectronRunTargetAuxiliaryRoute,
  ElectronRunTargetRoute,
  ElectronRunTargetRouteSet,
} from "../shared/app-view-contracts";

const LOOPBACK_HOST = "127.0.0.1";
const TICKET_RE = /^[0-9a-f]{64}$/;
const MAX_AUXILIARY_PORTS = 8;
const MAX_WEBSOCKET_BACKLOG_BYTES = 4 * 1024 * 1024;

type RelayEntry = {
  groupId: string;
  route: ElectronRunTargetRoute;
  server: net.Server;
  sockets: Set<net.Socket>;
  websockets: Set<WebSocket>;
};

type GroupIdentity = {
  ownerId: string;
  shellId: string;
};

export type ElectronRunTargetRouteProjection = {
  dto: "RunTargetRouteProjection";
  version: 1;
  groups: ElectronRunTargetRouteSet[];
};

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code || "")
    : "";
}

function loopbackUrl(rawUrl: string, expectedPort: number): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new Error("Run target URL must be credential-free HTTP");
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("Run target URL must address server loopback");
  }
  const effectivePort = Number(url.port || 80);
  if (effectivePort !== expectedPort) {
    throw new Error("Run target URL port does not match preferredPort");
  }
  return url;
}

export function normalizeRunTargetRoute(raw: unknown): ElectronRunTargetRoute {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Run target route is invalid");
  }
  const value = raw as Record<string, unknown>;
  const ticket = String(value.ticket || "").trim();
  const tunnelPath = String(value.tunnelPath || "").trim();
  const preferredPort = Number(value.preferredPort);
  const originalUrl = String(value.originalUrl || "").trim();
  if (!TICKET_RE.test(ticket)) throw new Error("Run target ticket is invalid");
  if (tunnelPath !== `/api/run-targets/${ticket}/tunnel`) {
    throw new Error("Run target tunnel path is invalid");
  }
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    throw new Error("Run target preferred port is invalid");
  }
  loopbackUrl(originalUrl, preferredPort);
  return {
    dto: "RunTargetRoute",
    version: 1,
    ticket,
    tunnelPath,
    preferredPort,
    originalUrl,
    expiresAt: Number(value.expiresAt) || 0,
  };
}

export function normalizeRunTargetRouteSet(raw: unknown): ElectronRunTargetRouteSet {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Run target route set is invalid");
  }
  const value = raw as Record<string, unknown>;
  if (!("primary" in value)) {
    const primary = normalizeRunTargetRoute(value);
    return {
      dto: "RunTargetRouteSet",
      version: 1,
      ownerId: "",
      shellId: "",
      relayGroupId: primary.ticket,
      primary,
      additional: [],
    };
  }
  const ownerId = String(value.ownerId || "").trim();
  const shellId = String(value.shellId || "").trim();
  if (!ownerId || !shellId) {
    throw new Error("Run target Framework-Shell ownership is invalid");
  }
  const relayGroupId = String(value.relayGroupId || "").trim();
  if (!TICKET_RE.test(relayGroupId)) {
    throw new Error("Run target relay group is invalid");
  }
  const primary = normalizeRunTargetRoute(value.primary);
  if (relayGroupId !== primary.ticket) {
    throw new Error("Run target relay group must identify the primary route");
  }
  if (!Array.isArray(value.additional) || value.additional.length > MAX_AUXILIARY_PORTS) {
    throw new Error("Run target auxiliary routes are invalid");
  }
  const seenPorts = new Set([primary.preferredPort]);
  const additional = value.additional.map((rawRoute): ElectronRunTargetAuxiliaryRoute => {
    const route = normalizeRunTargetRoute(rawRoute);
    const label = rawRoute && typeof rawRoute === "object" && !Array.isArray(rawRoute)
      ? String((rawRoute as Record<string, unknown>).label || "").trim()
      : "";
    if (!label) throw new Error("Run target auxiliary route label is required");
    if (seenPorts.has(route.preferredPort)) {
      throw new Error(`Run target contains duplicate port ${route.preferredPort}`);
    }
    seenPorts.add(route.preferredPort);
    return { ...route, label };
  });
  return {
    dto: "RunTargetRouteSet",
    version: 1,
    ownerId,
    shellId,
    relayGroupId,
    primary,
    additional,
  };
}

export function normalizeRunTargetRouteProjection(
  raw: unknown,
): ElectronRunTargetRouteProjection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Run target route projection is invalid");
  }
  const value = raw as Record<string, unknown>;
  if (value.dto !== "RunTargetRouteProjection" || value.version !== 1) {
    throw new Error("Run target route projection is invalid");
  }
  if (!Array.isArray(value.groups)) {
    throw new Error("Run target route projection groups are invalid");
  }
  return {
    dto: "RunTargetRouteProjection",
    version: 1,
    groups: value.groups.map(normalizeRunTargetRouteSet),
  };
}

export function isConfiguredFrameworkLoopback(configuredFrameworkOrigin: string): boolean {
  const hostname = new URL(configuredFrameworkOrigin).hostname.toLowerCase();
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname);
}

export function localRunTargetUrl(route: ElectronRunTargetRoute): string {
  const url = loopbackUrl(route.originalUrl, route.preferredPort);
  url.hostname = LOOPBACK_HOST;
  url.port = String(route.preferredPort);
  return url.href;
}

function tunnelWebSocketUrl(configuredFrameworkOrigin: string, tunnelPath: string): string {
  const url = new URL(tunnelPath, configuredFrameworkOrigin);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error("Run target tunnel requires an HTTP or HTTPS framework origin");
  return url.href;
}

function listen(server: net.Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true }, () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

export class RunTargetRelayManager {
  readonly #entries = new Map<number, RelayEntry>();
  readonly #groupIdentities = new Map<string, GroupIdentity>();
  #activeRoutesByShellId = new Map<string, ElectronRunTargetRouteSet>();
  #hasAuthoritativeProjection = false;
  #projectionReady = false;
  #projectionGeneration = 0;
  #lastConfiguredLoopback: boolean | null = null;
  #lastError: string | null = null;
  readonly #readyWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly frameworkOrigin: () => string,
    private readonly localityClassifier:
      (frameworkOrigin: string) => boolean | Promise<boolean> =
        isConfiguredFrameworkLoopback,
  ) {}

  updateRouteProjection(rawProjection: unknown): Promise<void> {
    const projection = normalizeRunTargetRouteProjection(rawProjection);
    const next = new Map(projection.groups.map((group) => [group.shellId, group]));
    const generation = ++this.#projectionGeneration;
    this.#activeRoutesByShellId = next;
    this.#hasAuthoritativeProjection = true;
    this.#projectionReady = false;
    const operation = this.#mutationQueue.then(
      () => this.#reconcileProjection(next, generation),
    );
    this.#mutationQueue = operation.then(() => undefined, () => undefined);
    void operation.then(
      () => {
        if (generation !== this.#projectionGeneration) return;
        this.#projectionReady = true;
        this.#lastError = null;
        this.#resolveReadyWaiters();
      },
      (error: unknown) => {
        if (generation !== this.#projectionGeneration) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.#projectionReady = false;
        this.#lastError = normalized.message;
        this.#rejectReadyWaiters(normalized);
      },
    );
    return operation;
  }

  suspendRouteProjection(): void {
    this.#hasAuthoritativeProjection = false;
    this.#projectionReady = false;
    this.#projectionGeneration += 1;
  }

  waitUntilProjectionReady(timeoutMs = 10_000): Promise<void> {
    if (this.#hasAuthoritativeProjection && this.#projectionReady) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.#readyWaiters.delete(waiter);
          reject(new Error("Run target route authority did not become ready"));
        }, timeoutMs),
      };
      this.#readyWaiters.add(waiter);
    });
  }

  debugSnapshot(): Record<string, unknown> {
    return {
      authorityAvailable: this.#hasAuthoritativeProjection,
      projectionReady: this.#projectionReady,
      configuredLoopback: this.#lastConfiguredLoopback,
      lastError: this.#lastError,
      projectedGroups: this.#activeRoutesByShellId.size,
      listenerPorts: [...this.#entries.keys()].sort((left, right) => left - right),
    };
  }

  async #reconcileProjection(
    next: Map<string, ElectronRunTargetRouteSet>,
    generation: number,
  ): Promise<void> {
    const configuredLoopback = await this.localityClassifier(this.frameworkOrigin());
    if (generation !== this.#projectionGeneration) return;
    const staleGroupIds = [...this.#groupIdentities]
      .filter(([groupId, identity]) => {
        const active = next.get(identity.shellId);
        return !active ||
          active.ownerId !== identity.ownerId ||
          active.relayGroupId !== groupId ||
          !this.#groupMatches(active);
      })
      .map(([groupId]) => groupId);
    await Promise.all(staleGroupIds.map((groupId) => this.#stopGroup(groupId)));
    this.#lastConfiguredLoopback = configuredLoopback;
    if (configuredLoopback) {
      await Promise.all([...this.#groupIdentities.keys()].map((groupId) => (
        this.#stopGroup(groupId)
      )));
      return;
    }
    for (const routeSet of next.values()) {
      if (generation !== this.#projectionGeneration) return;
      await this.#startOrReuseGroup(routeSet);
    }
  }

  async #startOrReuseGroup(routeSet: ElectronRunTargetRouteSet): Promise<void> {
    const oldGroupIds = [...this.#groupIdentities]
      .filter(([, identity]) => (
        identity.ownerId === routeSet.ownerId && identity.shellId !== routeSet.shellId
      ))
      .map(([groupId]) => groupId);
    await Promise.all(oldGroupIds.map((groupId) => this.#stopGroup(groupId)));
    const existingPrimary = this.#entries.get(routeSet.primary.preferredPort);
    if (existingPrimary && existingPrimary.groupId !== routeSet.relayGroupId) {
      throw new Error(
        `Run target port ${routeSet.primary.preferredPort} is owned by another profile`,
      );
    }
    if (this.#groupMatches(routeSet)) {
      return;
    }
    await this.#stopGroup(routeSet.relayGroupId);

    const primary = this.#createEntry(routeSet.relayGroupId, routeSet.primary);
    try {
      await this.#startEntry(primary);
    } catch (error) {
      primary.server.close();
      if (errorCode(error) === "EADDRINUSE") {
        throw new Error(`Run target port ${routeSet.primary.preferredPort} is already in use`);
      }
      throw error;
    }

    try {
      for (const route of routeSet.additional) {
        const existing = this.#entries.get(route.preferredPort);
        if (existing && existing.groupId !== routeSet.relayGroupId) {
          throw new Error(
            `${route.label} port ${route.preferredPort} is owned by another run profile`,
          );
        }
        const entry = this.#createEntry(routeSet.relayGroupId, route);
        try {
          await this.#startEntry(entry);
        } catch (error) {
          entry.server.close();
          if (errorCode(error) === "EADDRINUSE") {
            throw new Error(`${route.label} port ${route.preferredPort} is already in use`);
          }
          throw error;
        }
      }
    } catch (error) {
      await this.#stopGroup(routeSet.relayGroupId);
      throw error;
    }
    this.#groupIdentities.set(routeSet.relayGroupId, {
      ownerId: routeSet.ownerId,
      shellId: routeSet.shellId,
    });
  }

  stopAll(): Promise<void> {
    const operation = this.#mutationQueue.then(() => this.#stopAllNow());
    this.#mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  #createEntry(groupId: string, route: ElectronRunTargetRoute): RelayEntry {
    const entry: RelayEntry = {
      groupId,
      route,
      server: net.createServer(),
      sockets: new Set(),
      websockets: new Set(),
    };
    entry.server.on("connection", (socket) => this.#accept(entry, socket));
    return entry;
  }

  async #startEntry(entry: RelayEntry): Promise<void> {
    await listen(entry.server, entry.route.preferredPort);
    entry.server.unref();
    this.#entries.set(entry.route.preferredPort, entry);
    entry.server.on("error", (error) => {
      console.error(`[te2-run-target] listener failed: ${error.message}`);
      void this.#stopGroup(entry.groupId);
    });
  }

  #groupMatches(routeSet: ElectronRunTargetRouteSet): boolean {
    const expected = [routeSet.primary, ...routeSet.additional];
    const current = [...this.#entries.values()].filter(
      (entry) => entry.groupId === routeSet.relayGroupId,
    );
    return current.length === expected.length && expected.every((route) => {
      const entry = this.#entries.get(route.preferredPort);
      return entry?.groupId === routeSet.relayGroupId && entry.route.ticket === route.ticket;
    });
  }

  async #stopAllNow(): Promise<void> {
    this.#hasAuthoritativeProjection = false;
    this.#projectionReady = false;
    this.#projectionGeneration += 1;
    this.#activeRoutesByShellId.clear();
    this.#groupIdentities.clear();
    this.#lastConfiguredLoopback = null;
    this.#lastError = null;
    await Promise.all([...this.#entries.values()].map((entry) => this.#stopEntry(entry)));
  }

  async #stopGroup(groupId: string): Promise<void> {
    this.#groupIdentities.delete(groupId);
    const entries = [...this.#entries.values()].filter((entry) => entry.groupId === groupId);
    await Promise.all(entries.map((entry) => this.#stopEntry(entry)));
  }

  #resolveReadyWaiters(): void {
    for (const waiter of this.#readyWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    this.#readyWaiters.clear();
  }

  #rejectReadyWaiters(error: Error): void {
    for (const waiter of this.#readyWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.#readyWaiters.clear();
  }

  #accept(entry: RelayEntry, socket: net.Socket): void {
    if (this.#entries.get(entry.route.preferredPort) !== entry) {
      socket.destroy();
      return;
    }
    entry.sockets.add(socket);
    socket.pause();
    socket.setNoDelay(true);
    socket.unref();

    let closed = false;
    let opened = false;
    const websocket = new WebSocket(
      tunnelWebSocketUrl(this.frameworkOrigin(), entry.route.tunnelPath),
    );
    websocket.binaryType = "arraybuffer";
    entry.websockets.add(websocket);

    const closePair = (): void => {
      if (closed) return;
      closed = true;
      entry.sockets.delete(socket);
      entry.websockets.delete(websocket);
      if (!socket.destroyed) socket.destroy();
      if (
        websocket.readyState === WebSocket.CONNECTING ||
        websocket.readyState === WebSocket.OPEN
      ) {
        websocket.close();
      }
    };

    websocket.addEventListener("open", () => {
      if (closed) return;
      opened = true;
      socket.resume();
    });
    websocket.addEventListener("message", (event) => {
      if (closed || typeof event.data === "string" || !(event.data instanceof ArrayBuffer)) {
        closePair();
        return;
      }
      socket.write(Buffer.from(event.data), (error) => {
        if (error) closePair();
      });
    });
    websocket.addEventListener("close", closePair);
    websocket.addEventListener("error", closePair);
    socket.on("data", (chunk) => {
      if (!opened || websocket.readyState !== WebSocket.OPEN) {
        closePair();
        return;
      }
      if (websocket.bufferedAmount > MAX_WEBSOCKET_BACKLOG_BYTES) {
        closePair();
        return;
      }
      websocket.send(chunk);
    });
    socket.once("end", closePair);
    socket.once("close", closePair);
    socket.once("error", closePair);
  }

  async #stopEntry(entry: RelayEntry): Promise<void> {
    if (this.#entries.get(entry.route.preferredPort) === entry) {
      this.#entries.delete(entry.route.preferredPort);
    }
    for (const socket of entry.sockets) {
      if (!socket.destroyed) socket.destroy();
    }
    entry.sockets.clear();
    for (const websocket of entry.websockets) {
      if (
        websocket.readyState === WebSocket.CONNECTING ||
        websocket.readyState === WebSocket.OPEN
      ) {
        websocket.close();
      }
    }
    entry.websockets.clear();
    await closeServer(entry.server);
  }
}
