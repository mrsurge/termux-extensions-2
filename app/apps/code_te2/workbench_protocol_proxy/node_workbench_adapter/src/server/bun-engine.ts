import { Server as Engine } from "@socket.io/bun-engine";
import { serve } from "bun";
import type { AdapterHttpHandler, AdapterHttpRequest } from "./http-types.ts";

async function* requestBody(request: Request): AsyncGenerator<Uint8Array, void, unknown> {
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handleBunHttp(request: Request, handler: AdapterHttpHandler): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key] = value; });
  const adapted: AdapterHttpRequest = {
    url: request.url, method: request.method, headers,
    [Symbol.asyncIterator]: () => requestBody(request),
  };
  let status = 200;
  const responseHeaders = new Headers();
  let body: Uint8Array<ArrayBuffer> | null = null;
  let ended = false;
  await handler(adapted, {
    writeHead(code, values) {
      status = code;
      for (const [key, value] of Object.entries(values)) responseHeaders.set(key, String(value));
    },
    end(value) {
      ended = true;
      body = value === undefined ? null : typeof value === "string"
        ? new TextEncoder().encode(value) : new Uint8Array(value);
    },
  });
  if (!ended) throw new Error("WBA HTTP handler did not finish its response");
  return new Response(body, { status, headers: responseHeaders });
}

export function createBunEngine(path: string) {
  const engine = new Engine({
    path: `${path.replace(/\/$/, "")}/`,
    maxHttpBufferSize: 8 * 1024 * 1024,
    cors: { origin: true, credentials: true },
    // Preserve the WBA's WebSocket-only transport policy.
    allowRequest: async request => {
      if (new URL(request.url).searchParams.get("transport") !== "websocket") {
        throw new Error("WBA requires websocket transport");
      }
    },
  });
  return {
    bind(io: { bind(engine: Engine): unknown }): void { io.bind(engine); },
    listen(host: string, port: number, handler: AdapterHttpHandler): { stop(): void } {
      const handlers = engine.handler();
      const listener = serve({
        hostname: host, port, ...handlers,
        fetch(request, server) {
          if (new URL(request.url).pathname.replace(/\/$/, "") === path.replace(/\/$/, "")) {
            return engine.handleRequest(request, server);
          }
          return handleBunHttp(request, handler);
        },
      });
      return { stop() { engine.close(); void listener.stop(true); } };
    },
  };
}
