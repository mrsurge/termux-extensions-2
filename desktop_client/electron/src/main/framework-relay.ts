import { createReadStream } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { mapLocalAssetPath, type DesktopAssetManager } from "./assets";

const LOOPBACK_HOST = "127.0.0.1";

function trace(message: string): void {
  if (process.env.TE2_DESKTOP_RELAY_TRACE === "1") {
    console.log(`[te2-desktop-relay] ${message}`);
  }
}

export type FrameworkRelay = {
  readonly browserOrigin: string;
  readonly configuredOrigin: string;
  readonly port: number;
  refreshAssets(): Promise<void>;
  retarget(configuredOrigin: string): void;
  stop(): Promise<void>;
};

function relayTarget(configuredOrigin: string): URL {
  const target = new URL(configuredOrigin);
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error("The desktop framework relay requires an HTTP or HTTPS origin");
  }
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  return target;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      server.off("error", reject);
      resolvePromise((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function proxyHeaders(
  headers: http.IncomingHttpHeaders,
  target: URL,
): http.OutgoingHttpHeaders {
  return { ...headers, host: target.host };
}

function writeUpgradeResponse(
  downstream: Duplex,
  response: http.IncomingMessage,
): boolean {
  const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  return writeSocket(downstream, `${lines.join("\r\n")}\r\n\r\n`);
}

function writeSocket(socket: Duplex, data: string | Buffer): boolean {
  if (socket.destroyed || !socket.writable || socket.writableEnded) return false;
  try {
    socket.write(data, (error) => {
      if (!error) return;
      trace(`socket write stopped: ${error.message}`);
      if (!socket.destroyed) socket.destroy();
    });
    return true;
  } catch (error) {
    trace(
      `socket write stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!socket.destroyed) socket.destroy();
    return false;
  }
}

export function bridgeRelaySockets(downstream: Duplex, upstream: Duplex): void {
  let closed = false;
  const closePair = (): void => {
    if (closed) return;
    closed = true;
    downstream.unpipe(upstream);
    upstream.unpipe(downstream);
    if (!downstream.destroyed) downstream.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };
  const closeOnError = (side: string) => (error: Error): void => {
    trace(`${side} tunnel socket stopped: ${error.message}`);
    closePair();
  };

  downstream.once("error", closeOnError("browser"));
  upstream.once("error", closeOnError("framework"));
  downstream.once("end", closePair);
  upstream.once("end", closePair);
  downstream.once("close", closePair);
  upstream.once("close", closePair);

  if (
    downstream.destroyed ||
    upstream.destroyed ||
    !downstream.readable ||
    !upstream.readable
  ) {
    closePair();
    return;
  }
  downstream.pipe(upstream, { end: false });
  upstream.pipe(downstream, { end: false });
}

export async function startFrameworkRelay(
  configuredOrigin: string,
  assets: DesktopAssetManager,
): Promise<FrameworkRelay> {
  let target = relayTarget(configuredOrigin);
  let browserOrigin = "";
  let assetsEnabled = (await assets.missingRequiredAsset()) === null;
  const activeSockets = new Set<Duplex>();
  const trackSocket = (socket: Duplex, side: string): void => {
    activeSockets.add(socket);
    socket.on("error", (error) => trace(`${side} socket stopped: ${error.message}`));
    socket.once("close", () => activeSockets.delete(socket));
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url || "/", browserOrigin);
      const mappedAsset = assetsEnabled ? mapLocalAssetPath(requestUrl.pathname) : null;
      if (mappedAsset) {
        const localPath = await assets.resolveLocalAsset(requestUrl.pathname);
        if (!localPath) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Local desktop asset is missing");
          return;
        }
        trace(`asset ${request.method} ${requestUrl.pathname}`);
        const headers = {
          "Cache-Control": "max-age=31536000, immutable",
          "Content-Type": assets.contentType(localPath),
        };
        response.writeHead(200, headers);
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(localPath).on("error", () => response.destroy()).pipe(response);
        return;
      }

      const transport = target.protocol === "https:" ? https : http;
      const upstream = transport.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: request.method,
        path: request.url,
        headers: proxyHeaders(request.headers, target),
      }, (upstreamResponse) => {
        const stopUpstreamResponse = (): void => {
          if (!upstreamResponse.destroyed) upstreamResponse.destroy();
        };
        response.once("close", stopUpstreamResponse);
        upstreamResponse.once("error", (error) => {
          trace(`HTTP response stream stopped: ${error.message}`);
          if (!response.destroyed) response.destroy();
        });
        const headers = { ...upstreamResponse.headers };
        const location = headers.location;
        if (location) {
          try {
            const redirected = new URL(location, target);
            if (redirected.origin === target.origin) {
              headers.location = new URL(
                `${redirected.pathname}${redirected.search}${redirected.hash}`,
                browserOrigin,
              ).href;
            }
          } catch {
            // Preserve malformed upstream Location values verbatim.
          }
        }
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        upstreamResponse.pipe(response);
      });
      const stopUpstreamRequest = (): void => {
        if (!upstream.destroyed) upstream.destroy();
      };
      request.once("aborted", stopUpstreamRequest);
      response.once("close", stopUpstreamRequest);
      upstream.on("error", (error) => {
        if (response.headersSent) response.destroy(error);
        else {
          response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(`Framework relay failed: ${error.message}`);
        }
      });
      request.pipe(upstream);
    })().catch((error) => {
      if (response.headersSent) response.destroy(error as Error);
      else {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
  });

  server.on("connection", (socket) => {
    trackSocket(socket, "browser");
  });

  server.on("upgrade", (request, downstream, downstreamHead) => {
    const transport = target.protocol === "https:" ? https : http;
    const upstreamRequest = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: request.method,
      path: request.url,
      headers: proxyHeaders(request.headers, target),
    });
    upstreamRequest.on("upgrade", (upstreamResponse, upstream, upstreamHead) => {
      trackSocket(upstream, "framework");
      const wroteResponse = writeUpgradeResponse(downstream, upstreamResponse);
      const wroteUpstreamHead = !upstreamHead.length || writeSocket(downstream, upstreamHead);
      const wroteDownstreamHead = !downstreamHead.length || writeSocket(upstream, downstreamHead);
      if (!wroteResponse || !wroteUpstreamHead || !wroteDownstreamHead) {
        if (!downstream.destroyed) downstream.destroy();
        if (!upstream.destroyed) upstream.destroy();
        return;
      }
      bridgeRelaySockets(downstream, upstream);
    });
    upstreamRequest.on("response", (upstreamResponse) => {
      if (!writeUpgradeResponse(downstream, upstreamResponse)) {
        upstreamResponse.destroy();
        return;
      }
      upstreamResponse.once("error", (error) => {
        trace(`WebSocket rejection stream stopped: ${error.message}`);
        if (!downstream.destroyed) downstream.destroy();
      });
      downstream.once("close", () => upstreamResponse.destroy());
      upstreamResponse.pipe(downstream);
    });
    upstreamRequest.on("error", (error) => {
      trace(`WebSocket upgrade failed: ${error.message}`);
      if (!downstream.destroyed) downstream.destroy();
    });
    upstreamRequest.end();
  });

  const port = await listen(server);
  browserOrigin = `http://${LOOPBACK_HOST}:${port}`;
  console.log(`[te2-desktop-relay] ${browserOrigin} -> ${target.origin}`);

  let stopped = false;
  return {
    browserOrigin,
    get configuredOrigin() {
      return target.origin;
    },
    port,
    async refreshAssets() {
      assetsEnabled = (await assets.missingRequiredAsset()) === null;
    },
    retarget(nextOrigin) {
      const nextTarget = relayTarget(nextOrigin);
      if (nextTarget.origin === target.origin) return;
      const previousOrigin = target.origin;
      target = nextTarget;
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      console.log(
        `[te2-desktop-relay] retargeted ${browserOrigin}: ${previousOrigin} -> ${target.origin}`,
      );
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const socket of activeSockets) socket.destroy();
      activeSockets.clear();
      await closeServer(server);
    },
  };
}
