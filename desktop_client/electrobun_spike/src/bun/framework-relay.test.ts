import { describe, expect, test } from "bun:test";

import { startFrameworkRelay } from "./framework-relay";

describe("startFrameworkRelay", () => {
  test("projects concurrent HTTP traffic through a dynamic loopback port", async () => {
    const payload = "te2-relay-".repeat(128 * 1024);
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        return new Response(`${url.pathname}:${payload}`);
      },
    });
    const relay = startFrameworkRelay(`http://127.0.0.1:${upstream.port}`);
    expect(relay).not.toBeNull();

    try {
      expect(relay!.browserOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(relay!.port).not.toBe(upstream.port);
      const paths = Array.from({ length: 6 }, (_, index) => `/request-${index}`);
      const responses = await Promise.all(
        paths.map(async (path) => {
          const response = await fetch(`${relay!.browserOrigin}${path}`);
          expect(response.status).toBe(200);
          return response.text();
        }),
      );
      expect(responses).toEqual(paths.map((path) => `${path}:${payload}`));
    } finally {
      relay!.stop();
      upstream.stop(true);
    }
  }, 20_000);

  test("relays a persistent raw binary stream without HTTP framing", async () => {
    const expected = Buffer.alloc(8 * 1024, 0xa5);
    const upstream = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        binaryType: "buffer",
        data(socket, bytes) {
          socket.write(bytes);
        },
      },
    });
    const relay = startFrameworkRelay(`http://127.0.0.1:${upstream.port}`)!;

    try {
      const reply = await new Promise<Buffer>((resolvePromise, reject) => {
        type ClientData = { chunks: Buffer[]; received: number; settled: boolean };
        void Bun.connect<ClientData>({
          hostname: "127.0.0.1",
          port: relay.port,
          data: { chunks: [], received: 0, settled: false },
          socket: {
            binaryType: "buffer",
            open(socket) {
              socket.write(expected);
            },
            data(socket, bytes) {
              socket.data.chunks.push(Buffer.from(bytes));
              socket.data.received += bytes.byteLength;
              if (socket.data.received >= expected.byteLength) {
                socket.data.settled = true;
                resolvePromise(Buffer.concat(socket.data.chunks));
                socket.terminate();
              }
            },
            close(socket, error) {
              if (!socket.data.settled && error) reject(error);
            },
            connectError(_socket, error) {
              reject(error);
            },
            error(_socket, error) {
              reject(error);
            },
          },
        }).catch(reject);
      });
      expect(reply).toEqual(expected);
    } finally {
      relay.stop();
      upstream.stop(true);
    }
  }, 10_000);

  test("retargets the existing loopback listener for new connections", async () => {
    const firstUpstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("first");
      },
    });
    const secondUpstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("second");
      },
    });
    const firstOrigin = `http://127.0.0.1:${firstUpstream.port}`;
    const secondOrigin = `http://127.0.0.1:${secondUpstream.port}`;
    const relay = startFrameworkRelay(firstOrigin)!;
    const browserOrigin = relay.browserOrigin;

    try {
      expect(await fetch(browserOrigin).then((response) => response.text())).toBe("first");

      relay.retarget(secondOrigin);

      expect(relay.browserOrigin).toBe(browserOrigin);
      expect(relay.configuredOrigin).toBe(secondOrigin);
      expect(await fetch(browserOrigin).then((response) => response.text())).toBe("second");
    } finally {
      relay.stop();
      firstUpstream.stop(true);
      secondUpstream.stop(true);
    }
  });

  test("leaves HTTPS origins direct", () => {
    expect(startFrameworkRelay("https://framework.example")).toBeNull();
  });
});
