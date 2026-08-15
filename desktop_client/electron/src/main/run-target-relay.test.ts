import assert from "node:assert/strict";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  isConfiguredFrameworkLoopback,
  localRunTargetUrl,
  normalizeRunTargetRoute,
  normalizeRunTargetRouteSet,
  RunTargetRelayManager,
} from "./run-target-relay";

const TICKET = "a".repeat(64);

function route(port: number, ticket = TICKET) {
  return {
    ticket,
    tunnelPath: `/api/run-targets/${ticket}/tunnel`,
    preferredPort: port,
    originalUrl: `http://localhost:${port}/health?full=1#status`,
  };
}

function routeSet(
  primaryPort: number,
  additionalPort: number,
  ownerId = "owner:first",
  shellId = "shell:first",
  primaryTicket = TICKET,
  auxiliaryTicket = "b".repeat(64),
) {
  return {
    dto: "RunTargetRouteSet",
    version: 1,
    ownerId,
    shellId,
    relayGroupId: primaryTicket,
    primary: route(primaryPort, primaryTicket),
    additional: [{ ...route(additionalPort, auxiliaryTicket), label: "Vite / HMR" }],
  };
}

function projection(...groups: ReturnType<typeof routeSet>[]) {
  return {
    dto: "RunTargetRouteProjection",
    version: 1,
    groups,
  };
}

async function availablePorts(count: number): Promise<number[]> {
  const reservations = Array.from({ length: count }, () => net.createServer());
  try {
    return await Promise.all(reservations.map((server) => listen(server)));
  } finally {
    await Promise.all(reservations.map((server) => close(server)));
  }
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
  if (!server.listening) return Promise.resolve();
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

async function assertPortFree(port: number): Promise<void> {
  const server = net.createServer();
  try {
    await listen(server, port);
  } finally {
    await close(server);
  }
}

async function assertPortOwned(port: number): Promise<void> {
  const server = net.createServer();
  try {
    await assert.rejects(
      listen(server, port),
      (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
    );
  } finally {
    await close(server);
  }
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

test("route sets require unique labeled auxiliary ports", () => {
  const value = normalizeRunTargetRouteSet(routeSet(43123, 43124));
  assert.equal(value.primary.preferredPort, 43123);
  assert.equal(value.additional[0]?.label, "Vite / HMR");
  assert.throws(
    () => normalizeRunTargetRouteSet(routeSet(43123, 43123)),
    /duplicate port/,
  );
});

test("framework locality uses only the configured host", () => {
  assert.equal(isConfiguredFrameworkLoopback("http://localhost:8089"), true);
  assert.equal(isConfiguredFrameworkLoopback("http://127.0.0.1:8089"), true);
  assert.equal(isConfiguredFrameworkLoopback("http://[::1]:8089"), true);
  assert.equal(isConfiguredFrameworkLoopback("http://100.91.80.45:8089"), false);
  assert.equal(isConfiguredFrameworkLoopback("http://framework.example:8089"), false);
});

test("authoritative remote projection creates and reuses all listeners", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const descriptor = routeSet(primaryPort, auxiliaryPort);
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await manager.updateRouteProjection(projection(descriptor));
    assert.equal(manager.debugSnapshot().projectionReady, true);
    await assertPortOwned(primaryPort);
    await assertPortOwned(auxiliaryPort);

    await manager.updateRouteProjection(projection(descriptor));
    await assertPortOwned(primaryPort);
    await assertPortOwned(auxiliaryPort);
  } finally {
    await manager.stopAll();
  }
});

test("configured loopback projection creates no client listeners", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const manager = new RunTargetRelayManager(() => "http://127.0.0.1:8089");
  try {
    await manager.updateRouteProjection(projection(routeSet(primaryPort, auxiliaryPort)));
    assert.equal(manager.debugSnapshot().projectionReady, true);
    await assertPortFree(primaryPort);
    await assertPortFree(auxiliaryPort);
  } finally {
    await manager.stopAll();
  }
});

test("occupied auxiliary port fails projection and rolls back primary", async () => {
  const [primaryPort] = await availablePorts(1);
  const occupied = net.createServer();
  const auxiliaryPort = await listen(occupied);
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await assert.rejects(
      manager.updateRouteProjection(projection(routeSet(primaryPort, auxiliaryPort))),
      /Vite \/ HMR port .* already in use/,
    );
    assert.equal(manager.debugSnapshot().projectionReady, false);
    await assertPortFree(primaryPort);
  } finally {
    await manager.stopAll();
    await close(occupied);
  }
});

test("projection removal closes only the exited Framework-Shell group", async () => {
  const [firstPrimary, firstAuxiliary, secondPrimary, secondAuxiliary] =
    await availablePorts(4);
  const first = routeSet(firstPrimary, firstAuxiliary);
  const second = routeSet(
    secondPrimary,
    secondAuxiliary,
    "owner:second",
    "shell:second",
    "c".repeat(64),
    "d".repeat(64),
  );
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await manager.updateRouteProjection(projection(first, second));
    await manager.updateRouteProjection(projection(second));
    await assertPortFree(firstPrimary);
    await assertPortFree(firstAuxiliary);
    await assertPortOwned(secondPrimary);
    await assertPortOwned(secondAuxiliary);

    await manager.updateRouteProjection(projection());
    await assertPortFree(secondPrimary);
    await assertPortFree(secondAuxiliary);
  } finally {
    await manager.stopAll();
  }
});

test("a new shell generation replaces the same owner's stale listeners", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const first = routeSet(primaryPort, auxiliaryPort);
  const replacement = routeSet(
    primaryPort,
    auxiliaryPort,
    "owner:first",
    "shell:replacement",
    "e".repeat(64),
    "f".repeat(64),
  );
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await manager.updateRouteProjection(projection(first));
    await manager.updateRouteProjection(projection(replacement));
    await assertPortOwned(primaryPort);
    await assertPortOwned(auxiliaryPort);

    await manager.updateRouteProjection(projection());
    await assertPortFree(primaryPort);
    await assertPortFree(auxiliaryPort);
  } finally {
    await manager.stopAll();
  }
});

test("UI IPC interruption preserves listeners until the next snapshot event", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const descriptor = routeSet(primaryPort, auxiliaryPort);
  const manager = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await manager.updateRouteProjection(projection(descriptor));
    manager.suspendRouteProjection();
    await assertPortOwned(primaryPort);
    await assertPortOwned(auxiliaryPort);

    const ready = manager.waitUntilProjectionReady();
    const reconcile = manager.updateRouteProjection(projection(descriptor));
    await Promise.all([ready, reconcile]);
    assert.equal(manager.debugSnapshot().projectionReady, true);
  } finally {
    await manager.stopAll();
  }
});

test("native app readiness can wait event-wise without an independent timeout", async () => {
  const manager = new RunTargetRelayManager(() => "http://127.0.0.1:8089");
  let settled = false;
  try {
    const ready = manager.waitUntilProjectionReady(null).then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    await manager.updateRouteProjection(projection());
    await ready;
    assert.equal(settled, true);
  } finally {
    await manager.stopAll();
  }
});

test("a fresh manager reconstructs listeners from one projection event", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const descriptor = routeSet(primaryPort, auxiliaryPort);
  const first = new RunTargetRelayManager(() => "http://framework.example:8089");
  await first.updateRouteProjection(projection(descriptor));
  await assertPortOwned(primaryPort);
  await first.stopAll();
  await assertPortFree(primaryPort);

  const restarted = new RunTargetRelayManager(() => "http://framework.example:8089");
  try {
    await restarted.updateRouteProjection(projection(descriptor));
    await assertPortOwned(primaryPort);
    await assertPortOwned(auxiliaryPort);
  } finally {
    await restarted.stopAll();
  }
});

test("superseded projection cannot resurrect removed listeners", async () => {
  const [primaryPort, auxiliaryPort] = await availablePorts(2);
  const descriptor = routeSet(primaryPort, auxiliaryPort);
  let releaseProbe!: () => void;
  let markProbeStarted!: () => void;
  let probeCount = 0;
  const probeStarted = new Promise<void>((resolvePromise) => {
    markProbeStarted = resolvePromise;
  });
  const probeGate = new Promise<void>((resolvePromise) => {
    releaseProbe = resolvePromise;
  });
  const manager = new RunTargetRelayManager(
    () => "http://framework.example:8089",
    async () => {
      probeCount += 1;
      if (probeCount === 1) {
        markProbeStarted();
        await probeGate;
      }
      return false;
    },
  );
  try {
    const first = manager.updateRouteProjection(projection(descriptor));
    await probeStarted;
    const removal = manager.updateRouteProjection(projection());
    releaseProbe();
    await Promise.all([first, removal]);
    assert.equal(manager.debugSnapshot().projectionReady, true);
    await assertPortFree(primaryPort);
    await assertPortFree(auxiliaryPort);
  } finally {
    releaseProbe();
    await manager.stopAll();
  }
});
