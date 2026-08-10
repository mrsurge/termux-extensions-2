import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ExtensionMementoStore } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/extension-storage.mjs";
import { handleExtHostRequest } from "../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/ext-host-dispatch.mjs";
import { loadRpcIds } from "../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/rpc-ids.mjs";
import { decodeExtHostRpc } from "../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/wire-encoding.mjs";

const codeTe2Root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MAIN_THREAD_STORAGE = 38;

async function temporaryStorageRoot() {
  const scratchRoot = process.env.TEMPDIR
    ? path.resolve(process.env.TEMPDIR)
    : path.join(codeTe2Root, ".codex-scratch");
  await mkdir(scratchRoot, { recursive: true });
  return mkdtemp(path.join(scratchRoot, ".extension-storage-test-"));
}

test(
  "extension Mementos survive restart and isolate workspace state",
  { timeout: 5_000 },
  async () => {
    const rootPath = await temporaryStorageRoot();
    const workspaceA = path.join(rootPath, "workspace-a");
    const workspaceB = path.join(rootPath, "workspace-b");
    try {
      const first = new ExtensionMementoStore({
        rootPath,
        workspacePath: () => workspaceA,
      });
      await first.setValue(true, "OpenAI.ChatGPT", {
        "viewed2025-09-15-nux": true,
        "persisted-atom-state": { theme: "dark" },
      });
      await first.setValue(false, "OpenAI.ChatGPT", {
        activeThreadId: "thread-a",
      });

      const restarted = new ExtensionMementoStore({
        rootPath,
        workspacePath: () => workspaceA,
      });
      assert.deepEqual(
        JSON.parse(await restarted.initialize(true, "openai.chatgpt")),
        {
          "viewed2025-09-15-nux": true,
          "persisted-atom-state": { theme: "dark" },
        },
      );
      assert.deepEqual(
        JSON.parse(await restarted.initialize(false, "openai.chatgpt")),
        { activeThreadId: "thread-a" },
      );

      const otherWorkspace = new ExtensionMementoStore({
        rootPath,
        workspacePath: () => workspaceB,
      });
      assert.deepEqual(
        JSON.parse(await otherWorkspace.initialize(true, "OPENAI.CHATGPT")),
        {
          "viewed2025-09-15-nux": true,
          "persisted-atom-state": { theme: "dark" },
        },
      );
      assert.equal(
        await otherWorkspace.initialize(false, "openai.chatgpt"),
        undefined,
      );

      const files = await readdir(rootPath, { recursive: true });
      assert.equal(
        files.some((name) => name.endsWith(".tmp")),
        false,
      );
      assert.equal(files.filter((name) => name.endsWith(".json")).length, 2);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  },
);

function dispatchRuntime(store) {
  return {
    replyDropMethods: new Set(),
    replyEmptyMethods: new Set(),
    replyNullMethods: new Set(),
    state: { ready: false },
    providerRegistry: {
      registerFromRequest: () => ({
        handled: false,
        ready: false,
        logs: [],
        events: [],
      }),
      getTextContentProvider: () => null,
      hasTextContentProvider: () => false,
    },
    extRequests: {
      getSentMeta: () => undefined,
      resolveReply: () => false,
      deleteSentMeta: () => undefined,
    },
    rpcIds: {
      MainThreadConsole: 12,
      MainThreadExtensionService: 50,
      MainThreadLogger: 27,
      MainThreadOutputService: 29,
      MainThreadStatusBar: 33,
      MainThreadStorage: MAIN_THREAD_STORAGE,
      ExtHostWorkspace: 106,
    },
    extensionActivity: { handleRequest: () => ({}) },
    initializeExtensionStorage: (shared, extensionId) =>
      store.initialize(shared, extensionId),
    setExtensionStorageValue: (shared, extensionId, value) =>
      store.setValue(shared, extensionId, value),
    handleWebviewRequest: () => ({ handled: false }),
    debug: {
      shouldEmitExtRequestEvent: () => false,
      markExtRequestEvent: () => undefined,
      shouldEmitExtReplyEvent: () => false,
      markExtReplyEvent: () => undefined,
      shouldEmitMainThreadReplyEvent: () => false,
      markMainThreadReplyEvent: () => undefined,
    },
    nowMs: () => Date.now(),
    timeLabel: () => "00:00:00.000",
    onEvent: () => undefined,
    sendPayload: () => undefined,
    sendExt: () => undefined,
    checkWorkspaceExists: async () => false,
    startFileSearch: async () => [],
    tryOpenDocument: async () => null,
    provideTextDocumentContent: async () => null,
    readVirtualVscodeUriBuffer: () => null,
    statVirtualVscodeUri: () => null,
    fsPathFromUri: () => null,
    readLocalUriBuffer: async () => new Uint8Array(),
    statLocalUri: async () => ({}),
    uriObjToStringSafe: () => "",
    log: () => undefined,
  };
}

async function dispatch(runtime, message) {
  const payloads = [];
  let resolveTerminal;
  const terminal = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  runtime.sendPayload = (payload) => {
    payloads.push(payload);
    if ([7, 8, 9, 10, 11, 12].includes(payload[0])) {
      resolveTerminal(payload);
    }
  };
  assert.equal(handleExtHostRequest(runtime, message), true);
  const replyPayload = await terminal;
  assert.equal(payloads[0][0], 5);
  return decodeExtHostRpc(replyPayload);
}

test(
  "MainThreadStorage dispatch persists writes and returns cold-start state",
  { timeout: 5_000 },
  async () => {
    const rootPath = await temporaryStorageRoot();
    const workspacePath = path.join(rootPath, "workspace");
    try {
      const runtime = dispatchRuntime(
        new ExtensionMementoStore({
          rootPath,
          workspacePath: () => workspacePath,
        }),
      );
      const setReply = await dispatch(runtime, {
        kind: "ext",
        type: 1,
        req: 1,
        rpcId: MAIN_THREAD_STORAGE,
        method: "$setValue",
        args: [true, "openai.chatgpt", { viewedNux: true }],
      });
      assert.equal(setReply.type, 7);

      const restartedRuntime = dispatchRuntime(
        new ExtensionMementoStore({
          rootPath,
          workspacePath: () => workspacePath,
        }),
      );
      const initializeReply = await dispatch(restartedRuntime, {
        kind: "ext",
        type: 1,
        req: 2,
        rpcId: MAIN_THREAD_STORAGE,
        method: "$initializeExtensionStorage",
        args: [true, "openai.chatgpt"],
      });
      assert.equal(initializeReply.type, 9);
      assert.deepEqual(JSON.parse(initializeReply.result), { viewedNux: true });

      const missingReply = await dispatch(restartedRuntime, {
        kind: "ext",
        type: 1,
        req: 3,
        rpcId: MAIN_THREAD_STORAGE,
        method: "$initializeExtensionStorage",
        args: [false, "openai.chatgpt"],
      });
      assert.equal(missingReply.type, 7);

      const wrongActorReply = await dispatch(restartedRuntime, {
        kind: "ext",
        type: 1,
        req: 4,
        rpcId: MAIN_THREAD_STORAGE + 1,
        method: "$setValue",
        args: [true, "openai.chatgpt", { discarded: true }],
      });
      assert.equal(wrongActorReply.type, 11);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  },
);

test("MainThreadStorage uses the generated named nid", () => {
  const loaded = loadRpcIds({
    env: { TE2_RPC_CONFIG_PATH: "/generated/te2_rpc_config.json" },
    readText: () =>
      JSON.stringify({
        code_server_version: "4.130.0",
        nids: { MainThreadStorage: 61 },
      }),
  });
  assert.equal(loaded.ids.MainThreadStorage, 61);
  assert.match(loaded.source, /1\/\d+ applied/);
});
