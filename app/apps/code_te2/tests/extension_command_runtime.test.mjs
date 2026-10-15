import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateWhenClause,
  ExtensionCommandRuntime,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/command-runtime.mjs";
import { ClientOperationGate } from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/client-operation-gate.mjs";
import { WorkbenchClient } from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs";
import { checkWorkspaceContains } from "../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/workspace-contains.mjs";
import { handleExtHostRequest } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/ext-host-dispatch.mjs';

const RPC_IDS = {
  MainThreadCommands: 10,
  MainThreadMessageService: 29,
  ExtHostCommands: 89,
};

test('real Workbench dispatch adapter retains command registration, execution callbacks and retirement', async () => {
  const sent = [], navigation = [];
  const commands = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS, activateByEvent: async () => {}, syncSelection() {},
    uriForPath: path => ({ path }), openWorkbenchResource: async () => {},
    showLocations: async (...args) => { navigation.push(args); },
    sendExtAwaitTerminalReply: (_id, _method, args) => { sent.push(args); return { req: 1, promise: Promise.resolve({ type: 9, result: 'ok' }) }; },
    onEvent() {}, log() {},
  });
  const client = Object.create(WorkbenchClient.prototype);
  client.state = {};
  client._debugExtReqSeen = 200; client._debugExtReplySeen = 50; client._debugMainThreadReplySeen = 80;
  client._extensionActivity = { handleRequest: () => ({ handled: false }) };
  client._webviews = { handleMainThreadRequest: () => ({ handled: false }) };
  client._extensionEditorNavigation = { handleMainThreadRequest: () => ({ handled: false }) };
  client._extensionCommands = commands;
  const command = 'rust-analyzer.hoverRefCommandProxy';
  const dispatch = (method, args) => handleExtHostRequest(client._extHostDispatchRuntime(), {
    kind: 'ext', type: 1, req: 42, rpcId: RPC_IDS.MainThreadCommands, method, args,
  });
  assert.equal(dispatch('$registerCommand', [command]), true);
  await commands.execute({ surface: 'hover', command, arguments: [0], path: '/workspace/main.rs' });
  assert.deepEqual(sent, [[command, 0]]);
  const locations = [{ scheme: 'file', path: '/workspace/main.rs' }, { lineNumber: 85, column: 8 }, []];
  dispatch('$executeCommand', ['editor.action.showReferences', locations]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(navigation, [locations]);
  dispatch('$unregisterCommand', [command]);
  await assert.rejects(commands.execute({ surface: 'hover', command }), /Unknown extension command/);
});

test('hover executes a live internal command without a manifest menu contribution', async () => {
  const calls = [];
  let reply = { type: 9, result: 'ok' };
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS, activateByEvent: async () => {},
    sendExtAwaitTerminalReply: (rpc, method, args) => { calls.push({ rpc, method, args }); return { req: 1, promise: Promise.resolve(reply) }; },
    uriForPath: path => ({ scheme: 'file', path }), openWorkbenchResource: async () => {},
    syncSelection() {}, onEvent() {}, log() {},
  });
  const command = 'rust-analyzer.hoverRefCommandProxy';
  const registration = method => runtime.handleMainThreadRequest({ kind: 'ext', rpcId: RPC_IDS.MainThreadCommands, method, args: [command] });
  const params = { surface: 'hover', path: '/workspace/main.rs', command, arguments: [0] };
  await assert.rejects(runtime.execute(params), /Unknown extension command/);
  registration('$registerCommand');
  await runtime.execute(params);
  assert.deepEqual(calls[0].args, [command, 0]);
  await assert.rejects(runtime.execute({ ...params, surface: 'editor' }), /Unknown extension command/);
  reply = { type: 11, error: { message: 'unsupported navigation' } };
  await assert.rejects(runtime.execute(params), /unsupported navigation/);
  registration('$unregisterCommand');
  await assert.rejects(runtime.execute(params), /Unknown extension command/);
});

test('showReferences callback invokes the existing location owner, not a generic command evaluator', async () => {
  const calls = [];
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS, activateByEvent: async () => {},
    sendExtAwaitTerminalReply: () => { throw Error('unexpected extension request'); },
    uriForPath: path => ({ path }), openWorkbenchResource: async () => {},
    showLocations: async (...args) => { calls.push(args); }, syncSelection() {}, onEvent() {}, log() {},
  });
  const args = [{ scheme: 'file', path: '/workspace/main.rs' }, { lineNumber: 85, column: 8 }, []];
  const request = command => runtime.handleMainThreadRequest({ kind: 'ext', rpcId: RPC_IDS.MainThreadCommands, method: '$executeCommand', args: [command, args] });
  const result = request('editor.action.showReferences');
  await result.pending;
  assert.deepEqual(calls, [args]);
  assert.match(request('workbench.unknown').error.message, /Unsupported workbench command/);
});

test("unprojected positive context keys do not expose editor actions", () => {
  assert.equal(evaluateWhenClause("jsDebugCanPrettyPrint", {}), false);
  assert.equal(
    evaluateWhenClause("github.copilot.chat.copilotCLI.hasActiveDiff", {}),
    false,
  );
  assert.equal(
    evaluateWhenClause("resourceExtname == .json", { resourceExtname: ".json" }),
    true,
  );
});

test("resolves the Codex editor context contribution from a complete manifest", async () => {
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async () => {},
    sendExtAwaitTerminalReply: () => ({ req: 1, promise: Promise.resolve({}) }),
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection() {},
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "openai.chatgpt",
    extensionLocation: { path: "/extensions/openai.chatgpt" },
    contributes: {
      commands: [{
        command: "chatgpt.addToThread",
        title: "Add to Codex Thread",
        category: "Codex",
      }],
      menus: {
        "editor/context": [{
          command: "chatgpt.addToThread",
          group: "codex",
          when: "resourceScheme == file",
        }],
      },
    },
  }]);

  const menu = await runtime.resolveMenu({
    menu: "editor/context",
    surface: "editor",
    path: "/workspace/example.ts",
    languageId: "typescript",
    selection: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 4,
    },
  });

  assert.equal(menu.context.resourceScheme, "file");
  assert.deepEqual(
    menu.actions.map((action) => action.command),
    ["chatgpt.addToThread"],
  );
});

test("resolves contributed editor actions and executes through ExtHostCommands", async () => {
  const activations = [];
  const selections = [];
  const requests = [];
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async (event) => {
      activations.push(event);
      runtime.handleMainThreadRequest({
        kind: "ext",
        type: 1,
        req: 1,
        rpcId: RPC_IDS.MainThreadCommands,
        method: "$registerCommand",
        args: ["sample.open.selected"],
      });
    },
    sendExtAwaitTerminalReply(rpcId, method, args) {
      requests.push({ rpcId, method, args });
      return { req: 7, promise: Promise.resolve({ type: 9, result: "done" }) };
    },
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection: (params) => selections.push(params.selection),
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "sample.extension",
    extensionLocation: { path: "/extensions/sample" },
    contributes: {
      commands: [{ command: "sample.open.selected", title: "Open Selection" }],
      menus: {
        "editor/context": [{
          command: "sample.open.selected",
          when: "editorHasSelection && (resourceExtname == .json || editorLangId == json)",
          group: "navigation",
        }],
      },
    },
  }]);

  const selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 4,
  };
  const menu = await runtime.resolveMenu({
    menu: "editor/context",
    path: "/workspace/example.json",
    languageId: "json",
    selection,
  });
  assert.equal(menu.actions.length, 1);
  assert.equal(menu.actions[0].command, "sample.open.selected");

  const result = await runtime.execute({
    command: "sample.open.selected",
    path: "/workspace/example.json",
    languageId: "json",
    selection,
  });
  assert.deepEqual(activations, ["onCommand:sample.open.selected"]);
  assert.equal(selections.length, 1);
  assert.deepEqual(requests, [{
    rpcId: RPC_IDS.ExtHostCommands,
    method: "$executeContributedCommand",
    args: [
      "sample.open.selected",
      { scheme: "vscode-remote", path: "/workspace/example.json" },
    ],
  }]);
  assert.equal(result.result, "done");
});

test("delegates command registration authority to the extension host after activation", async () => {
  let executeCount = 0;
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async () => {},
    sendExtAwaitTerminalReply() {
      executeCount += 1;
      return { req: 8, promise: Promise.resolve({ type: 7 }) };
    },
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection() {},
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "sample.extension",
    contributes: {
      commands: [{ command: "sample.racy", title: "Racy Command" }],
    },
  }]);

  const result = await runtime.execute({
    command: "sample.racy",
    path: "/workspace/example.json",
    selection: null,
  });

  assert.equal(result.ok, true);
  assert.equal(executeCount, 1);
});

test("propagates the extension host's missing-command error", async () => {
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async () => {},
    sendExtAwaitTerminalReply() {
      return {
        req: 9,
        promise: Promise.reject(
          new Error("Contributed command 'sample.missing' does not exist."),
        ),
      };
    },
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection() {},
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "sample.extension",
    contributes: {
      commands: [{ command: "sample.missing", title: "Missing Command" }],
    },
  }]);

  await assert.rejects(
    runtime.execute({ command: "sample.missing" }),
    /Contributed command 'sample\.missing' does not exist\./,
  );
});

test("setContext gates actions and Explorer commands receive clicked and selected URIs", async () => {
  const requests = [];
  let selectionSyncs = 0;
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async () => {},
    sendExtAwaitTerminalReply(rpcId, method, args) {
      requests.push({ rpcId, method, args });
      return { req: 11, promise: Promise.resolve({ type: 9 }) };
    },
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection() {
      selectionSyncs += 1;
    },
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "sample.extension",
    contributes: {
      commands: [
        {
          command: "sample.inspect",
          title: "Inspect",
          enablement: "sample.ready",
        },
        {
          command: "sample.inspectAlternate",
          title: "Inspect Alternate",
        },
      ],
      menus: {
        "explorer/context": [{
          command: "sample.inspect",
          when: "explorerResourceIsFolder",
          group: "navigation@2",
          alt: "sample.inspectAlternate",
        }],
      },
    },
  }]);

  runtime.handleMainThreadRequest({
    kind: "ext",
    rpcId: RPC_IDS.MainThreadCommands,
    method: "$executeCommand",
    args: ["setContext", ["sample.ready", true]],
  });
  const menu = await runtime.resolveMenu({
    menu: "explorer/context",
    path: "/workspace/src",
    surface: "explorer",
    context: { explorerResourceIsFolder: true },
  });
  assert.equal(menu.actions[0].enabled, true);
  assert.equal(menu.actions[0].alternate.command, "sample.inspectAlternate");

  runtime.resetContext();
  const resetMenu = await runtime.resolveMenu({
    menu: "explorer/context",
    path: "/workspace/src",
    surface: "explorer",
    context: { explorerResourceIsFolder: true },
  });
  assert.equal(resetMenu.actions[0].enabled, false);

  runtime.handleMainThreadRequest({
    kind: "ext",
    rpcId: RPC_IDS.MainThreadCommands,
    method: "$executeCommand",
    args: ["setContext", ["sample.ready", true]],
  });

  await runtime.execute({
    command: "sample.inspect",
    path: "/workspace/src",
    selectedPaths: ["/workspace/src", "/workspace/test"],
    surface: "explorer",
  });
  assert.equal(selectionSyncs, 0);
  assert.deepEqual(requests[0].args, [
    "sample.inspect",
    { scheme: "vscode-remote", path: "/workspace/src" },
    [
      { scheme: "vscode-remote", path: "/workspace/src" },
      { scheme: "vscode-remote", path: "/workspace/test" },
    ],
  ]);
});

test("webview context actions use the authoritative view id without editor selection sync", async () => {
  const requests = [];
  let selectionSyncs = 0;
  const runtime = new ExtensionCommandRuntime({
    rpcIds: RPC_IDS,
    activateByEvent: async () => undefined,
    sendExtAwaitTerminalReply(rpcId, method, args) {
      requests.push({ rpcId, method, args });
      return { req: 17, promise: Promise.resolve({ type: 7 }) };
    },
    uriForPath: (filePath) => ({ scheme: "vscode-remote", path: filePath }),
    openWorkbenchResource: async () => undefined,
    syncSelection() {
      selectionSyncs += 1;
    },
    onEvent() {},
    log() {},
  });
  runtime.setExtensions([{
    id: "openai.chatgpt",
    contributes: {
      commands: [{ command: "chatgpt.newChat", title: "New Chat" }],
      menus: {
        "webview/context": [{
          command: "chatgpt.newChat",
          when: "webviewId == 'chatgpt.sidebarView' && chatgpt.supportsNewChatMenu",
        }],
      },
    },
  }]);
  assert.equal(runtime.hasMenu("webview/context"), true);
  runtime.handleMainThreadRequest({
    kind: "ext",
    rpcId: RPC_IDS.MainThreadCommands,
    method: "$executeCommand",
    args: ["setContext", ["chatgpt.supportsNewChatMenu", true]],
  });

  const menu = await runtime.resolveMenu({
    menu: "webview/context",
    surface: "webview",
    context: { webviewId: "chatgpt.sidebarView" },
  });
  assert.equal(menu.actions.length, 1);
  assert.equal(menu.actions[0].command, "chatgpt.newChat");
  assert.equal(menu.context.editorTextFocus, false);
  assert.equal(menu.context.resourceScheme, "");

  await runtime.execute({
    command: "chatgpt.newChat",
    surface: "webview",
    context: { webviewId: "chatgpt.sidebarView" },
  });
  assert.equal(selectionSyncs, 0);
  assert.deepEqual(requests[0], {
    rpcId: RPC_IDS.ExtHostCommands,
    method: "$executeContributedCommand",
    args: ["chatgpt.newChat"],
  });
});

test("projects active Monaco selections through the exact client facade", async () => {
  const calls = [];
  const client = Object.create(WorkbenchClient.prototype);
  client.state = { activePath: "/workspace/app.js" };
  client._activeEditorId = "editor-1";
  client._projectedClientInstanceId = "client_aaaaaaaaaaaa";
  client._clientOperationGate = new ClientOperationGate({ minimumTimeoutMs: 5 });
  client._sendExt = (...args) => calls.push(args);

  assert.deepEqual(
    await client.extensionEditorStateUpdate({
      clientInstanceId: "client_aaaaaaaaaaaa",
      path: "/workspace/app.js",
      source: "keyboard",
      selection: {
        startLineNumber: 4,
        startColumn: 2,
        endLineNumber: 4,
        endColumn: 8,
        selectionStartLineNumber: 4,
        selectionStartColumn: 2,
        positionLineNumber: 4,
        positionColumn: 8,
      },
    }),
    { ok: true, activePath: "/workspace/app.js" },
  );
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0][0], "number");
  assert.equal(calls[0][1], "$acceptEditorPropertiesChanged");
  assert.deepEqual(calls[0].slice(2), [[
    "editor-1",
    {
      options: null,
      selections: {
        selections: [{
          startLineNumber: 4,
          startColumn: 2,
          endLineNumber: 4,
          endColumn: 8,
          selectionStartLineNumber: 4,
          selectionStartColumn: 2,
          positionLineNumber: 4,
          positionColumn: 8,
        }],
        source: "keyboard",
      },
      visibleRanges: null,
    },
  ], false]);

  assert.deepEqual(
    await client.extensionEditorStateUpdate({
      clientInstanceId: "client_aaaaaaaaaaaa",
      path: "/workspace/other.js",
      source: "not-valid",
      selection: {},
    }),
    { ok: false, activePath: "/workspace/app.js" },
  );
  assert.equal(calls.length, 1);
});

test("workspaceContains supports brace expansion through vendored picomatch", async () => {
  const scratchBase = process.env.TEMPDIR || process.env.TMPDIR || os.tmpdir();
  const root = await fs.mkdtemp(path.join(scratchBase, "te2-workspace-contains-"));
  try {
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "nested", "sample.json"), "{}\n");
    assert.equal(
      await checkWorkspaceContains(
        [{ uri: { fsPath: root } }],
        ["**/*.{json}"],
      ),
      true,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
