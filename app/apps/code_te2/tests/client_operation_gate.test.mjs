import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientOperationGate,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/client-operation-gate.mjs";

const CLIENT_A = "client_aaaaaaaaaaaa";
const CLIENT_B = "client_bbbbbbbbbbbb";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gate() {
  return new ClientOperationGate({ minimumTimeoutMs: 5 });
}

test("client operation gate is FIFO even for concurrent work from one client", async () => {
  const operationGate = gate();
  const releaseFirst = deferred();
  const order = [];
  const first = operationGate.run(CLIENT_A, async () => {
    order.push("a:start");
    await releaseFirst.promise;
    order.push("a:end");
  }, { label: "a", timeoutMs: 200 });
  await Promise.resolve();
  const second = operationGate.run(CLIENT_A, async () => {
    order.push("a2:start");
    order.push("a2:end");
  }, { label: "a2", timeoutMs: 200 });
  const third = operationGate.run(CLIENT_B, async () => {
    order.push("b:start");
    order.push("b:end");
  }, { label: "b", timeoutMs: 200 });

  await Promise.resolve();
  assert.deepEqual(order, ["a:start"]);
  releaseFirst.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [
    "a:start",
    "a:end",
    "a2:start",
    "a2:end",
    "b:start",
    "b:end",
  ]);
});

test("nested in-process work reenters only through the owning operation token", async () => {
  const operationGate = gate();
  const order = [];
  await operationGate.run(CLIENT_A, async () => {
    order.push("outer:start");
    await operationGate.run(CLIENT_A, async () => {
      order.push("inner");
    }, { label: "inner", timeoutMs: 200 });
    order.push("outer:end");
  }, { label: "outer", timeoutMs: 200 });
  assert.deepEqual(order, ["outer:start", "inner", "outer:end"]);
});

test("correlated frontend roundtrip reenters its exact owning operation", async () => {
  const operationGate = gate();
  const childFinished = deferred();
  const outer = operationGate.run(CLIENT_A, async () => {
    assert.equal(
      operationGate.registerReentryKey("extension_open_1", CLIENT_A),
      true,
    );
    await childFinished.promise;
  }, { label: "command", timeoutMs: 200 });
  await Promise.resolve();

  await operationGate.run(CLIENT_A, async () => {
    childFinished.resolve();
  }, {
    label: "open",
    timeoutMs: 200,
    reentryKey: "extension_open_1",
  });
  await outer;
  assert.equal(operationGate.snapshot().owner, null);
});

test("expired owner cannot poison the next client", async () => {
  const timedOut = [];
  const operationGate = new ClientOperationGate({
    minimumTimeoutMs: 5,
    onTimeout: (snapshot) => timedOut.push(snapshot),
  });
  const stuck = operationGate.run(
    CLIENT_A,
    () => new Promise(() => {}),
    { label: "stuck", timeoutMs: 20 },
  );
  const recovered = operationGate.run(
    CLIENT_B,
    async () => "recovered",
    { label: "next", timeoutMs: 100, waitTimeoutMs: 200 },
  );

  await assert.rejects(stuck, /Client operation timed out: stuck/);
  assert.equal(await recovered, "recovered");
  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0].owner.clientInstanceId, CLIENT_A);
  assert.equal(operationGate.snapshot().owner, null);
});

test("reset rejects both the active owner and queued clients", async () => {
  const operationGate = gate();
  const active = operationGate.run(
    CLIENT_A,
    () => new Promise(() => {}),
    { label: "active", timeoutMs: 200 },
  );
  const queued = operationGate.run(
    CLIENT_B,
    async () => "never",
    { label: "queued", timeoutMs: 200 },
  );
  await Promise.resolve();
  operationGate.clear("workspace_reset");
  await assert.rejects(active, /workspace_reset/);
  await assert.rejects(queued, /workspace_reset/);
  assert.deepEqual(operationGate.snapshot(), {
    owner: null,
    queued: 0,
    reentryKeys: 0,
  });
});
