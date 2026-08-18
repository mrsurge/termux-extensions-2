import assert from "node:assert/strict";
import test from "node:test";

import {
  ExtensionEditorNavigationRuntime,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/editor-navigation-runtime.mjs";

test("showTextDocument waits for canonical open and cursor placement acknowledgements", async () => {
  const clientInstanceId = "client_abcdefghijkl";
  let activePath = null;
  let activeEditorId = null;
  const backendEvents = [];
  const editorOperations = [];
  let id = 0;
  const runtime = new ExtensionEditorNavigationRuntime({
    rpcIds: { MainThreadTextEditors: 20 },
    fsPathFromUri: (uri) => uri?.path ?? null,
    activePath: () => activePath,
    activeEditorId: () => activeEditorId,
    activeClientInstanceId: () => clientInstanceId,
    emitBackendEvent: (event) => backendEvents.push(event),
    notifyEditor: (method, params) => editorOperations.push({ method, params }),
    createId: () => String(++id),
    log() {},
  });

  const result = runtime.handleMainThreadRequest({
    kind: "ext",
    rpcId: 20,
    method: "$tryShowTextDocument",
    args: [
      { scheme: "vscode-remote", path: "/workspace/main.ts" },
      {
        selection: {
          startLineNumber: 5,
          startColumn: 3,
          endLineNumber: 5,
          endColumn: 8,
        },
      },
    ],
  });
  assert.equal(result.handled, true);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].path, "/workspace/main.ts");
  assert.equal(backendEvents[0].clientInstanceId, clientInstanceId);

  activePath = "/workspace/main.ts";
  activeEditorId = "editor-1";
  runtime.activeEditorChanged(activePath, clientInstanceId);
  runtime.completeBackendOpen({
    ok: true,
    requestId: backendEvents[0].requestId,
    path: activePath,
    clientInstanceId,
  });
  assert.equal(editorOperations.length, 1);
  assert.equal(editorOperations[0].method, "vscode.editorOperation");
  assert.equal(editorOperations[0].params.operation, "setSelections");

  runtime.completeEditorOperation({
    ok: true,
    operationId: editorOperations[0].params.operationId,
    clientInstanceId,
  });
  assert.equal(await result.pending, "editor-1");
});
