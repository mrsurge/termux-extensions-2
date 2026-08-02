import * as net from "node:net";

import type {
  ElectronRunTargetResolution,
  ElectronRunTargetRoute,
} from "../shared/app-view-contracts";

const LOOPBACK_HOST = "127.0.0.1";
const TICKET_RE = /^[0-9a-f]{64}$/;
const MAX_WEBSOCKET_BACKLOG_BYTES = 4 * 1024 * 1024;

type RelayEntry = {
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

  resolve(rawRoute: unknown): Promise<ElectronRunTargetResolution> {
    const operation = this.#mutationQueue.then(() => this.#resolveNow(rawRoute));
    this.#mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #resolveNow(rawRoute: unknown): Promise<ElectronRunTargetResolution> {
    const route = normalizeRunTargetRoute(rawRoute);
    const existing = this.#entries.get(route.preferredPort);
    if (existing?.route.ticket === route.ticket) {
      return { ok: true, mode: "tunnel", url: localRunTargetUrl(route) };
    }
    if (existing) await this.#stopEntry(existing);

    const entry: RelayEntry = {
      route,
      server: net.createServer(),
      sockets: new Set(),
      websockets: new Set(),
    };
    entry.server.on("connection", (socket) => this.#accept(entry, socket));
    try {
      await listen(entry.server, route.preferredPort);
    } catch (error) {
      entry.server.close();
      if (errorCode(error) === "EADDRINUSE") {
        return { ok: true, mode: "direct", url: route.originalUrl };
      }
      throw error;
    }
    entry.server.unref();
    entry.server.on("error", (error) => {
      console.error(`[te2-run-target] listener failed: ${error.message}`);
      void this.#stopEntry(entry);
    });
    this.#entries.set(route.preferredPort, entry);
    return { ok: true, mode: "tunnel", url: localRunTargetUrl(route) };
  }

  stopAll(): Promise<void> {
    const operation = this.#mutationQueue.then(() => this.#stopAllNow());
    this.#mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #stopAllNow(): Promise<void> {
    await Promise.all([...this.#entries.values()].map((entry) => this.#stopEntry(entry)));
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
