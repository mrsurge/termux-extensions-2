import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence++}`;
  return import(url);
}

test("coalesces Monaco selection events and resyncs exact state after WBA open", async () => {
  const { createEditorExtensionStateRuntime } = await importTypeScript(
    "monaco_editor/editor_extension_state_runtime.ts",
  );
  let cursorListener = null;
  let modelListener = null;
  let selection = {
    startLineNumber: 3,
    startColumn: 2,
    endLineNumber: 3,
    endColumn: 2,
    selectionStartLineNumber: 3,
    selectionStartColumn: 2,
    positionLineNumber: 3,
    positionColumn: 2,
  };
  const disposed = [];
  const timers = new Map();
  const attempts = [];
  let timerId = 0;
  let connected = true;
  const editor = {
    getModel: () => ({}),
    getSelection: () => selection,
    getPosition: () => ({
      lineNumber: selection.positionLineNumber,
      column: selection.positionColumn,
    }),
    onDidChangeCursorSelection(listener) {
      cursorListener = listener;
      return { dispose: () => disposed.push("cursor") };
    },
    onDidChangeModel(listener) {
      modelListener = listener;
      return { dispose: () => disposed.push("model") };
    },
  };
  const runtime = createEditorExtensionStateRuntime({
    getCurrentPath: () => "/workspace/app.js",
    notify(method, params) {
      attempts.push({ method, params });
      return connected;
    },
    setTimeoutFn(callback) {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
  });

  const flushTimer = () => {
    const [[id, callback]] = timers.entries();
    timers.delete(id);
    callback();
  };

  runtime.attach(editor);
  selection = { ...selection, positionColumn: 4, endColumn: 4 };
  cursorListener({ source: "keyboard" });
  selection = { ...selection, positionColumn: 7, endColumn: 7 };
  cursorListener({ source: "mouse" });
  assert.equal(timers.size, 1);
  flushTimer();

  assert.deepEqual(attempts, [
    {
      method: "vscode.editorState.update",
      params: {
        path: "/workspace/app.js",
        source: "mouse",
        reason: "selection",
        selection: {
          startLineNumber: 3,
          startColumn: 2,
          endLineNumber: 3,
          endColumn: 7,
          selectionStartLineNumber: 3,
          selectionStartColumn: 2,
          positionLineNumber: 3,
          positionColumn: 7,
        },
      },
    },
  ]);

  cursorListener({ source: "keyboard" });
  flushTimer();
  assert.equal(attempts.length, 1);

  connected = false;
  selection = { ...selection, positionColumn: 9, endColumn: 9 };
  cursorListener({ source: "keyboard" });
  flushTimer();
  assert.equal(attempts.length, 2);

  connected = true;
  assert.equal(runtime.publish(), true);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2].params.selection.positionColumn, 9);

  assert.equal(runtime.resync("open_ack"), true);
  assert.equal(attempts.length, 4);
  assert.equal(attempts[3].params.reason, "open_ack");
  assert.equal(attempts[3].params.source, "api");

  modelListener();
  runtime.dispose();
  assert.deepEqual(disposed, ["cursor", "model"]);
});
