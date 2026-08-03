import * as net from "node:net";

import type {
  ElectronRunTargetAuxiliaryRoute,
  ElectronRunTargetDescriptor,
  ElectronRunTargetResolution,
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
      relayGroupId: primary.ticket,
      primary,
      additional: [],
    };
  }
  const relayGroupId = String(value.relayGroupId || "").trim();
  if (!TICKET_RE.test(relayGroupId)) {
    throw new Error("Run target relay group is invalid");
  }
  const primary = normalizeRunTargetRoute(value.primary);
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
    relayGroupId,
    primary,
    additional,
  };
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
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly frameworkOrigin: () => string) {}

  resolve(rawRoute: ElectronRunTargetDescriptor | unknown): Promise<ElectronRunTargetResolution> {
    const operation = this.#mutationQueue.then(() => this.#resolveNow(rawRoute));
    this.#mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #resolveNow(rawRoute: unknown): Promise<ElectronRunTargetResolution> {
    const legacy = Boolean(rawRoute && typeof rawRoute === "object" && !("primary" in rawRoute));
    const routeSet = normalizeRunTargetRouteSet(rawRoute);
    const existingPrimary = this.#entries.get(routeSet.primary.preferredPort);
    if (existingPrimary && existingPrimary.groupId !== routeSet.relayGroupId) {
      if (legacy) await this.#stopGroup(existingPrimary.groupId);
      else {
        throw new Error(
          `Run target port ${routeSet.primary.preferredPort} is owned by another profile`,
        );
      }
    }
    if (this.#groupMatches(routeSet)) {
      return { ok: true, mode: "tunnel", url: localRunTargetUrl(routeSet.primary) };
    }
    await this.#stopGroup(routeSet.relayGroupId);

    const primary = this.#createEntry(routeSet.relayGroupId, routeSet.primary);
    try {
      await this.#startEntry(primary);
    } catch (error) {
      primary.server.close();
      if (errorCode(error) === "EADDRINUSE") {
        return { ok: true, mode: "direct", url: routeSet.primary.originalUrl };
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
    return { ok: true, mode: "tunnel", url: localRunTargetUrl(routeSet.primary) };
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
    await Promise.all([...this.#entries.values()].map((entry) => this.#stopEntry(entry)));
  }

  async #stopGroup(groupId: string): Promise<void> {
    const entries = [...this.#entries.values()].filter((entry) => entry.groupId === groupId);
    await Promise.all(entries.map((entry) => this.#stopEntry(entry)));
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
