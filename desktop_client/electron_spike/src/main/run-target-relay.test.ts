import assert from "node:assert/strict";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  localRunTargetUrl,
  normalizeRunTargetRoute,
  RunTargetRelayManager,
} from "./run-target-relay";

const TICKET = "a".repeat(64);

function route(port: number) {
  return {
    ticket: TICKET,
    tunnelPath: `/api/run-targets/${TICKET}/tunnel`,
    preferredPort: port,
    originalUrl: `http://localhost:${port}/health?full=1#status`,
  };
}

function listen(server: net.Server, port = 0): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      resolvePromise((server.address() as AddressInfo).port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

test("run target route requires a ticket-bound tunnel and matching loopback port", () => {
  const value = normalizeRunTargetRoute(route(43123));
  assert.equal(value.preferredPort, 43123);
  assert.equal(localRunTargetUrl(value), "http://127.0.0.1:43123/health?full=1#status");
  assert.throws(
    () => normalizeRunTargetRoute({ ...route(43123), originalUrl: "http://example.com:43123/" }),
    /server loopback/,
  );
  assert.throws(
    () => normalizeRunTargetRoute({ ...route(43123), tunnelPath: "/wrong" }),
    /tunnel path/,
  );
});

test("occupied preferred port selects same-device direct mode", async () => {
  const occupied = net.createServer();
  const port = await listen(occupied);
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    assert.deepEqual(await manager.resolve(route(port)), {
      ok: true,
      mode: "direct",
      url: `http://localhost:${port}/health?full=1#status`,
    });
  } finally {
    await manager.stopAll();
    await close(occupied);
  }
});

test("free preferred port creates a reusable client tunnel", async () => {
  const reservation = net.createServer();
  const port = await listen(reservation);
  await close(reservation);
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    const expected = {
      ok: true,
      mode: "tunnel",
      url: `http://127.0.0.1:${port}/health?full=1#status`,
    };
    const [first, second] = await Promise.all([
      manager.resolve(route(port)),
      manager.resolve(route(port)),
    ]);
    assert.deepEqual(first, expected);
    assert.deepEqual(second, expected);
  } finally {
    await manager.stopAll();
  }
});
