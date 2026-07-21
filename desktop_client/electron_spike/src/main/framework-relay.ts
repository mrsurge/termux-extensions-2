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
): void {
  const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  downstream.write(`${lines.join("\r\n")}\r\n\r\n`);
}

export async function startFrameworkRelay(
  configuredOrigin: string,
  assets: DesktopAssetManager,
): Promise<FrameworkRelay> {
  let target = relayTarget(configuredOrigin);
  let browserOrigin = "";
  let assetsEnabled = (await assets.missingRequiredAsset()) === null;
  const activeSockets = new Set<Duplex>();

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
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
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
      activeSockets.add(upstream);
      upstream.once("close", () => activeSockets.delete(upstream));
      writeUpgradeResponse(downstream, upstreamResponse);
      if (upstreamHead.length) downstream.write(upstreamHead);
      if (downstreamHead.length) upstream.write(downstreamHead);
      downstream.pipe(upstream).pipe(downstream);
    });
    upstreamRequest.on("response", (upstreamResponse) => {
      writeUpgradeResponse(downstream, upstreamResponse);
      upstreamResponse.pipe(downstream);
    });
    upstreamRequest.on("error", (error) => {
      console.error(`[te2-desktop-relay] WebSocket upgrade failed: ${error.message}`);
      downstream.destroy(error);
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
