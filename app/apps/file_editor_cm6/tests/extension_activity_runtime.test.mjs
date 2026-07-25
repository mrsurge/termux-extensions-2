import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ExtensionActivityRuntime } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/activity-runtime.mjs";

const RPC_IDS = {
  MainThreadConsole: 1,
  MainThreadExtensionService: 2,
  MainThreadLogger: 3,
  MainThreadOutputService: 4,
  MainThreadStatusBar: 5,
};

function createRuntime(events, options = {}) {
  return new ExtensionActivityRuntime({
    rpcIds: RPC_IDS,
    onEvent: (event) => events.push(event),
    resolveFsPath: (uri) =>
      uri && typeof uri === "object" && typeof uri.path === "string"
        ? uri.path
        : null,
    ...options,
  });
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for extension activity event");
}

test("normalizes extension activity, status entries, and output channels", () => {
  const events = [];
  const runtime = createRuntime(events);
  runtime.setExtensions([
    { id: "sample.extension", displayName: "Sample Extension" },
  ]);

  runtime.handleRequest({
    req: 1,
    rpcId: RPC_IDS.MainThreadExtensionService,
    method: "$onDidActivateExtension",
    args: [{ value: { id: "sample.extension" } }],
  });
  runtime.handleRequest({
    req: 2,
    rpcId: RPC_IDS.MainThreadExtensionService,
    method: "$onExtensionRuntimeError",
    args: [
      { value: { id: "sample.extension" } },
      { name: "Error", message: "broken extension", stack: "stack line" },
    ],
  });
  runtime.handleRequest({
    req: 3,
    rpcId: RPC_IDS.MainThreadStatusBar,
    method: "$setEntry",
    args: [
      "sample.status",
      "sample.status",
      "sample.extension",
      "Sample status",
      "$(check) Ready",
      "Sample tooltip",
      false,
      null,
      null,
      null,
      true,
      100,
      { label: "Sample ready" },
    ],
  });
  const outputReply = runtime.handleRequest({
    req: 4,
    rpcId: RPC_IDS.MainThreadOutputService,
    method: "$register",
    args: [
      "Sample Output",
      { scheme: "file", path: "/not-created/sample.log" },
      "log",
      "sample.extension",
    ],
  });

  assert.deepEqual(outputReply, {
    handledReply: true,
    replyResult: "te2-output-4",
  });
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.activities.length, 3);
  assert.equal(snapshot.activities.at(-1).message, "Registered output channel: Sample Output");
  assert.equal(
    snapshot.activities.find((item) => item.severity === "error").message,
    "Error: broken extension",
  );
  assert.equal(snapshot.statusEntries[0].text, "$(check) Ready");
  assert.equal(snapshot.channels[0].extensionId, "sample.extension");
  assert.ok(
    events.some((event) => event.type === "extension/statusBarChanged"),
  );
  assert.ok(
    events.some((event) => event.type === "extension/channelsChanged"),
  );
});

test("tails selected output channels progressively without loading the whole file", async () => {
  const events = [];
  const scratchRoot = process.env.TMPDIR || os.tmpdir();
  const directory = await fs.mkdtemp(
    path.join(scratchRoot, "te2-extension-log-"),
  );
  const logPath = path.join(directory, "extension.log");
  const runtime = createRuntime(events, { tailBytes: 1024 });
  try {
    await fs.writeFile(logPath, `${"old line\n".repeat(300)}tail marker\n`);
    const outputReply = runtime.handleRequest({
      req: 10,
      rpcId: RPC_IDS.MainThreadOutputService,
      method: "$register",
      args: [
        "Progressive Output",
        { scheme: "file", path: logPath },
        "log",
        "sample.extension",
      ],
    });
    const channelId = outputReply.replyResult;
    const selected = await runtime.selectLog(channelId);

    assert.equal(selected.ok, true);
    assert.equal(selected.truncated, true);
    assert.match(selected.content, /tail marker/);
    assert.ok(selected.content.length < 1400);

    await fs.appendFile(logPath, "progressive append\n");
    const appendEvent = await waitFor(() =>
      events.find(
        (event) =>
          event.type === "extension/logAppend" &&
          event.channelId === channelId &&
          String(event.content).includes("progressive append"),
      ),
    );
    assert.equal(appendEvent.source, "file");
  } finally {
    runtime.reset("test_cleanup");
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("streams direct logger RPC messages for selected channels", async () => {
  const events = [];
  const runtime = createRuntime(events);
  const resource = { scheme: "memory", path: "/sample.log" };
  runtime.handleRequest({
    req: 20,
    rpcId: RPC_IDS.MainThreadLogger,
    method: "$registerLogger",
    args: [
      {
        resource,
        id: "sample.logger",
        name: "Sample Logger",
        extensionId: "sample.extension",
      },
    ],
  });
  await runtime.selectLog("sample.logger");
  runtime.handleRequest({
    req: 21,
    rpcId: RPC_IDS.MainThreadLogger,
    method: "$log",
    args: [resource, [[4, "direct failure"]]],
  });

  assert.ok(
    events.some(
      (event) =>
        event.type === "extension/logAppend" &&
        event.channelId === "sample.logger" &&
        String(event.content).includes("[ERROR] direct failure"),
    ),
  );
  const selected = await runtime.selectLog("sample.logger");
  assert.match(selected.content, /\[ERROR\] direct failure/);
});
