import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createEditorState() {
  let version = 4;
  const position = { lineNumber: 8, column: 5 };
  const model = {
    uri: { toString: () => "file:///workspace/main.rs" },
    getLanguageId: () => "rust",
    getVersionId: () => version,
    getWordAtPosition: () => ({ word: "target_symbol" }),
    getLineContent: (lineNumber) =>
      lineNumber === 8 ? "pub fn target_symbol() {}" : `line ${lineNumber}`,
  };
  return {
    editor: {
      getModel: () => model,
      getPosition: () => position,
      getSelection: () => ({ isEmpty: () => true }),
    },
    setVersion(next) {
      version = next;
    },
  };
}

test("publishes loading then grouped reference results", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/main.rs",
    editorWorkbenchCall: async () => ({
      ok: true,
      result: [
        {
          path: "/workspace/lib.rs",
          uri: "file:///workspace/lib.rs",
          range: {
            startLineNumber: 12,
            startColumn: 3,
            endLineNumber: 12,
            endColumn: 7,
          },
          preview: "first reference preview",
        },
        {
          path: "/workspace/lib.rs",
          uri: "file:///workspace/lib.rs",
          range: {
            startLineNumber: 20,
            startColumn: 1,
            endLineNumber: 20,
            endColumn: 5,
          },
          preview: "second reference preview",
        },
      ],
    }),
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights() {},
    logError() {},
  });

  runtime.start("references");
  await settle();

  assert.equal(projections[0].status, "loading");
  assert.equal(projections.at(-1).status, "ready");
  assert.equal(projections.at(-1).target.symbol, "target_symbol");
  assert.equal(projections.at(-1).tree.length, 1);
  assert.equal(projections.at(-1).tree[0].children.length, 2);
  assert.equal(
    projections.at(-1).tree[0].children[0].description,
    "first reference preview",
  );
});

test("uses the live model preview and highlights only the open file", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  const highlights = [];
  let currentPath = "/workspace/main.rs";
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => currentPath,
    editorWorkbenchCall: async () => ({
      ok: true,
      result: [
        {
          path: "/workspace/main.rs",
          uri: "file:///workspace/main.rs",
          range: {
            startLineNumber: 8,
            startColumn: 8,
            endLineNumber: 8,
            endColumn: 21,
          },
          preview: "stale on-disk preview",
        },
        {
          path: "/workspace/lib.rs",
          uri: "file:///workspace/lib.rs",
          range: {
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 5,
          },
          preview: "other file preview",
        },
      ],
    }),
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights: (ranges) => {
      highlights.push(structuredClone(ranges));
    },
    logError() {},
  });

  runtime.start("references");
  await settle();

  const currentFile = projections.at(-1).tree.find(
    (node) => node.path === "/workspace/main.rs",
  );
  assert.equal(
    currentFile.children[0].description,
    "pub fn target_symbol() {}",
  );
  assert.deepEqual(highlights.at(-1), [{
    startLineNumber: 8,
    startColumn: 8,
    endLineNumber: 8,
    endColumn: 21,
  }]);

  currentPath = "/workspace/lib.rs";
  runtime.reapplyHighlights();
  assert.deepEqual(highlights.at(-1), [{
    startLineNumber: 2,
    startColumn: 1,
    endLineNumber: 2,
    endColumn: 5,
  }]);
  runtime.clearHighlights();
  assert.deepEqual(highlights.at(-1), []);
});

test("expands call hierarchy branches against the retained request", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  const methods = [];
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/main.rs",
    editorWorkbenchCall: async (method) => {
      methods.push(method);
      if (method === "call_hierarchy_prepare") {
        return {
          ok: true,
          result: [{
            sessionId: "session-1",
            itemId: "root-1",
            name: "main",
            path: "/workspace/main.rs",
            uri: "file:///workspace/main.rs",
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 2,
              endColumn: 2,
            },
          }],
        };
      }
      return {
        ok: true,
        result: [{
          sessionId: "session-1",
          itemId: "caller-1",
          name: "caller",
          path: "/workspace/lib.rs",
          uri: "file:///workspace/lib.rs",
          range: {
            startLineNumber: 10,
            startColumn: 1,
            endLineNumber: 11,
            endColumn: 2,
          },
        }],
      };
    },
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights() {},
    logError() {},
  });

  runtime.start("callHierarchy");
  await settle();
  const ready = projections.at(-1);
  const direction = ready.tree[0].children[0];
  runtime.handleCommand({
    action: "expand",
    requestId: ready.requestId,
    nodeId: direction.id,
  });
  await settle();

  assert.ok(methods.includes("call_hierarchy_incoming"));
  const expanded = projections.at(-1).tree[0].children[0];
  assert.equal(expanded.childrenState, "loaded");
  assert.equal(expanded.children[0].label, "caller");
});

test("drops a provider result after the model version changes", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  let resolveRequest;
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/main.rs",
    editorWorkbenchCall: () => new Promise((resolve) => {
      resolveRequest = resolve;
    }),
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights() {},
    logError() {},
  });

  runtime.start("implementations");
  state.setVersion(5);
  resolveRequest({ ok: true, result: [] });
  await settle();

  assert.equal(projections.length, 1);
  assert.equal(projections[0].status, "loading");
});

test("rehydrates a retained hierarchy projection before lazy expansion", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  const methods = [];
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/result.rs",
    editorWorkbenchCall: async (method) => {
      methods.push(method);
      return { ok: true, result: [] };
    },
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights() {},
    logError() {},
  });
  const direction = {
    id: "call:root:session-1:root-1:incoming",
    type: "direction",
    direction: "incoming",
    sessionId: "session-1",
    itemId: "root-1",
    childrenState: "unloaded",
    children: [],
  };
  runtime.handleCommand({
    action: "expand",
    requestId: "retained-request",
    nodeId: direction.id,
    projection: {
      revision: 1,
      requestId: "retained-request",
      requestSequence: 123,
      status: "ready",
      mode: "callHierarchy",
      target: { path: "/workspace/main.rs" },
      summary: { count: 1 },
      tree: [{
        id: "call:root:session-1:root-1",
        type: "call",
        sessionId: "session-1",
        itemId: "root-1",
        children: [direction],
      }],
      error: null,
    },
  });
  await settle();

  assert.deepEqual(methods, ["call_hierarchy_incoming"]);
  assert.equal(projections.at(-1).requestId, "retained-request");
  assert.equal(
    projections.at(-1).tree[0].children[0].childrenState,
    "loaded",
  );
});

test("keeps Code Inspector and contents-search decorations independent", async () => {
  const {
    clearCodeInspectorHighlights,
    clearSearchHighlight,
    handleSearchHighlight,
    replaceCodeInspectorHighlights,
  } = await importTypeScript(
    "monaco_editor/editor_search_highlight_runtime.ts",
  );
  const collections = [];
  const editor = {
    createDecorationsCollection() {
      const collection = {
        decorations: [],
        set(decorations) {
          this.decorations = decorations;
        },
        clear() {
          this.decorations = [];
        },
      };
      collections.push(collection);
      return collection;
    },
    getOption() {
      return null;
    },
  };
  const searchRange = {
    startLineNumber: 3,
    startColumn: 2,
    endLineNumber: 3,
    endColumn: 8,
  };
  const inspectorRange = {
    startLineNumber: 7,
    startColumn: 4,
    endLineNumber: 7,
    endColumn: 10,
  };
  handleSearchHighlight(
    {
      active: true,
      projectPath: "/workspace",
      query: "target",
      isRegex: false,
      isCaseSensitive: false,
      isWholeWords: false,
    },
    {
      getCurrentPath: () => "/workspace/main.rs",
      getEditor: () => editor,
      getModel: () => ({
        findMatches: () => [{ range: searchRange }],
      }),
      schedule: (callback) => callback(),
    },
  );
  replaceCodeInspectorHighlights(editor, [inspectorRange]);

  assert.equal(collections.length, 2);
  assert.deepEqual(collections[0].decorations[0].range, searchRange);
  assert.deepEqual(collections[1].decorations[0].range, inspectorRange);
  assert.equal(collections[1].decorations[0].options.className, "findMatch");

  clearCodeInspectorHighlights();
  assert.equal(collections[1].decorations.length, 0);
  assert.equal(collections[0].decorations.length, 1);
  clearSearchHighlight(editor);
});

test("styles the Code Inspector collapse control with the drawer controls", async () => {
  const template = await readFile(
    path.join(appRoot, "template.html"),
    "utf8",
  );
  assert.match(
    template,
    /\.extension-log-header \.console-clear-btn,\s*\.code-inspector-header \.console-clear-btn/,
  );
});
