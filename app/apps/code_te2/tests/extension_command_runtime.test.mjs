import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ExtensionCommandRuntime } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/command-runtime.mjs";
import { checkWorkspaceContains } from "../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/workspace-contains.mjs";

const RPC_IDS = {
  MainThreadCommands: 10,
  MainThreadMessageService: 29,
  ExtHostCommands: 89,
};

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
