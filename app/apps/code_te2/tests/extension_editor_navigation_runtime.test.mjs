import assert from "node:assert/strict";
import test from "node:test";

import {
  ExtensionEditorNavigationRuntime,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/editor-navigation-runtime.mjs";

test('extension locations retain exact client ownership and wait for presentation acknowledgement', async () => {
  const operations = [];
  const runtime = new ExtensionEditorNavigationRuntime({
    rpcIds: { MainThreadTextEditors: 20 }, fsPathFromUri: uri => uri?.path ?? null,
    activePath: () => '/workspace/main.rs', activeEditorId: () => 'editor-1',
    activeClientInstanceId: () => 'client_exact', emitBackendEvent() { assert.fail('must not open a file'); },
    notifyEditor: (method, params) => operations.push({ method, params }), createId: () => '1', log() {},
  });
  const range = { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 8 };
  const pending = runtime.showLocationsFromWorkbench({ path: '/workspace/main.rs' }, { lineNumber: 85, column: 8 }, [{ uri: { path: '/workspace/other.rs' }, range }]);
  assert.equal(operations[0].params.clientInstanceId, 'client_exact');
  assert.equal(operations[0].params.operation, 'showLocations');
  assert.deepEqual(operations[0].params.locations, [{ path: '/workspace/other.rs', range, selectionRange: range }]);
  assert.throws(() => runtime.completeEditorOperation({ operationId: operations[0].params.operationId, clientInstanceId: 'client_other', ok: true }), /identity mismatch/);
  runtime.completeEditorOperation({ operationId: operations[0].params.operationId, clientInstanceId: 'client_exact', ok: true });
  await pending;
  await assert.rejects(runtime.showLocationsFromWorkbench({ path: '/wrong.rs' }, { lineNumber: 1, column: 1 }, []), /Invalid/);
  await assert.rejects(runtime.showLocationsFromWorkbench({ path: '/workspace/main.rs' }, { lineNumber: 1, column: 1 }, [{ uri: { path: '/other.rs' }, range: { ...range, startColumn: 0 } }]), /Invalid/);
});

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
