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

test("projects independently changed viewport, multi-selection and resolved options", async () => {
  const { createEditorExtensionStateRuntime } = await importTypeScript("monaco_editor/editor_extension_state_runtime.ts");
  const listeners = new Map();
  const timers = new Map();
  let id = 0;
  let path = "/workspace/readme.md";
  let generation = 7;
  let ready = true;
  let connected = true;
  let selections = [{ startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 3 }];
  let ranges = [{ startLineNumber: 20, startColumn: 1, endLineNumber: 40, endColumn: 9 }];
  let options = { tabSize: 2, indentSize: 2, originalIndentSize: "tabSize", insertSpaces: true };
  let renderType = 2;
  const attempts = [];
  const subscribe = name => listener => {
    listeners.set(name, listener);
    return { dispose: () => listeners.delete(name) };
  };
  const editor = {
    getModel: () => ({ getOptions: () => options }),
    getSelection: () => selections[0],
    getSelections: () => selections,
    getVisibleRanges: () => ranges,
    getOption: key => key === 1 ? 1 : { renderType },
    onDidChangeCursorSelection: subscribe("selection"),
    onDidChangeModel: subscribe("model"),
    onDidScrollChange: subscribe("scroll"),
    onDidLayoutChange: subscribe("layout"),
    onDidChangeConfiguration: subscribe("config"),
    onDidChangeModelOptions: subscribe("modelOptions"),
    onDidDispose: subscribe("dispose"),
  };
  const runtime = createEditorExtensionStateRuntime({
    getCurrentPath: () => path, getGeneration: () => generation, canPublish: () => ready,
    getEditorOptionIds: () => ({ cursorStyle: 1, lineNumbers: 2 }),
    notify: (method, params) => { attempts.push({ method, params }); return connected; },
    setTimeoutFn: callback => { timers.set(++id, callback); return id; },
    clearTimeoutFn: id => timers.delete(id),
  });
  const fire = name => listeners.get(name)?.({ source: "keyboard" });
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  runtime.attach(editor);
  assert.equal(runtime.resync("open_ack"), true);
  const first = attempts.at(-1).params;
  assert.deepEqual(first.visibleRanges, ranges);
  assert.equal(first.selections.length, 1);
  assert.deepEqual(first.options, { ...options, cursorStyle: 1, lineNumbers: 2 });
  assert.equal(first.generation, 7);

  ranges = [{ ...ranges[0], startLineNumber: 21 }];
  fire("scroll"); fire("layout");
  assert.equal(timers.size, 1);
  flush();
  const viewport = attempts.at(-1).params;
  assert.deepEqual(viewport.visibleRanges, ranges);
  assert.equal(viewport.selections, undefined);
  assert.equal(viewport.options, undefined);
  assert.deepEqual(viewport.selection, first.selection); // older servers retain a real cursor
  const count = attempts.length;
  fire("scroll"); flush();
  assert.equal(attempts.length, count);

  selections = [...selections, { startLineNumber: 8, startColumn: 2, endLineNumber: 9, endColumn: 3,
    selectionStartLineNumber: 9, selectionStartColumn: 3, positionLineNumber: 8, positionColumn: 2 }];
  fire("selection"); fire("scroll"); flush();
  assert.equal(attempts.at(-1).params.selections.length, 2);
  assert.equal(attempts.at(-1).params.source, "keyboard");
  assert.equal(attempts.at(-1).params.visibleRanges, undefined);
  options = { ...options, tabSize: 8 };
  renderType = 0;
  fire("modelOptions"); fire("config"); flush();
  assert.equal(attempts.at(-1).params.options.tabSize, 8);
  assert.equal(attempts.at(-1).params.options.lineNumbers, 0);
  assert.equal(attempts.at(-1).params.selections, undefined);

  connected = false;
  ranges = [];
  fire("scroll"); flush();
  connected = true;
  assert.equal(runtime.resync("open_ack"), true);
  assert.deepEqual(attempts.at(-1).params.visibleRanges, []);
  assert.equal(timers.size, 0);

  ready = false;
  fire("scroll"); flush();
  assert.equal(attempts.at(-1).params.reason, "open_ack");
  fire("scroll");
  fire("model");
  assert.equal(timers.size, 0);
  path = "/workspace/next.md"; generation = 8; ready = true;
  assert.equal(runtime.resync("open_ack"), true);
  assert.equal(attempts.at(-1).params.path, path);
  assert.equal(attempts.at(-1).params.generation, 8);
  const oldDispose = listeners.get("dispose");
  const oldScroll = listeners.get("scroll");
  fire("scroll");
  runtime.attach(editor);
  assert.equal(timers.size, 0);
  oldDispose(); oldScroll();
  assert.equal(listeners.size, 7);
  assert.equal(timers.size, 0);
  fire("scroll"); fire("dispose");
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(runtime.resync(), false);
});
