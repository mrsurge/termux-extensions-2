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

test("goes directly to the first definition without replacing the drawer projection", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const calls = [];
  const opens = [];
  const projections = [];
  const notifications = [];
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/main.rs",
    editorWorkbenchCall: async (method, params) => {
      calls.push({ method, params });
      return {
        ok: true,
        result: [{
          path: "/workspace/definition.rs",
          uri: "file:///workspace/definition.rs",
          selectionRange: {
            startLineNumber: 17,
            startColumn: 9,
            endLineNumber: 17,
            endColumn: 22,
          },
        }],
      };
    },
    publishProjection: (projection) => {
      projections.push(structuredClone(projection));
      return true;
    },
    replaceHighlights() {},
    openLocation: async (location) => {
      opens.push(structuredClone(location));
      return { ok: true };
    },
    notify: (message) => {
      notifications.push(message);
      return true;
    },
    logError() {},
  });

  runtime.goToDefinition();
  await settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "definition");
  assert.deepEqual(calls[0].params, {
    path: "/workspace/main.rs",
    languageId: "rust",
    lineNumber: 8,
    column: 5,
  });
  assert.equal(projections.length, 0);
  assert.equal(notifications.length, 0);
  assert.equal(opens.length, 1);
  assert.deepEqual(
    {
      path: opens[0].path,
      line: opens[0].line,
      column: opens[0].column,
      focus: opens[0].focus,
      scroll_y: opens[0].scroll_y,
      reason: opens[0].reason,
    },
    {
      path: "/workspace/definition.rs",
      line: 17,
      column: 9,
      focus: false,
      scroll_y: "center",
      reason: "code_inspector_definition",
    },
  );
  assert.match(opens[0].request_id, /^definition_\d+_1$/);
});

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

test("loads the first incoming call scope and switches to outgoing calls", async () => {
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
      if (method === "call_hierarchy_incoming") {
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
      }
      return {
        ok: true,
        result: [{
          sessionId: "session-1",
          itemId: "callee-1",
          name: "callee",
          path: "/workspace/callee.rs",
          uri: "file:///workspace/callee.rs",
          range: {
            startLineNumber: 20,
            startColumn: 1,
            endLineNumber: 21,
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
  const incoming = projections.at(-1);

  assert.deepEqual(methods, [
    "call_hierarchy_prepare",
    "call_hierarchy_incoming",
  ]);
  assert.equal(incoming.summary.direction, "incoming");
  assert.equal(incoming.tree[0].childrenState, "loaded");
  assert.equal(incoming.tree[0].children[0].label, "caller");
  assert.equal(incoming.tree[0].children[0].description, "/workspace/lib.rs");
  assert.equal(incoming.tree[0].children[0].descriptionKind, "path");

  runtime.handleCommand({
    action: "direction",
    requestId: incoming.requestId,
    direction: "outgoing",
  });
  await settle();

  assert.equal(methods.at(-1), "call_hierarchy_outgoing");
  const outgoing = projections.at(-1);
  assert.equal(outgoing.summary.direction, "outgoing");
  assert.equal(outgoing.tree[0].childrenState, "loaded");
  assert.equal(outgoing.tree[0].children[0].label, "callee");
});

test("drops an incoming expansion that completes after an outgoing switch", async () => {
  const { createEditorCodeInspectorRuntime } = await importTypeScript(
    "monaco_editor/editor_code_inspector_runtime.ts",
  );
  const state = createEditorState();
  const projections = [];
  let resolveIncoming;
  const runtime = createEditorCodeInspectorRuntime({
    getEditor: () => state.editor,
    getCurrentPath: () => "/workspace/main.rs",
    editorWorkbenchCall: async (method) => {
      if (method === "call_hierarchy_prepare") {
        return {
          ok: true,
          result: [{
            sessionId: "session-1",
            itemId: "root-1",
            name: "main",
            path: "/workspace/main.rs",
          }],
        };
      }
      if (method === "call_hierarchy_incoming") {
        return new Promise((resolve) => {
          resolveIncoming = resolve;
        });
      }
      return {
        ok: true,
        result: [{
          sessionId: "session-1",
          itemId: "callee-1",
          name: "callee",
          path: "/workspace/callee.rs",
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
  const incoming = projections.at(-1);
  assert.equal(incoming.summary.direction, "incoming");
  assert.equal(incoming.tree[0].childrenState, "loading");

  runtime.handleCommand({
    action: "direction",
    requestId: incoming.requestId,
    direction: "outgoing",
  });
  await settle();
  assert.equal(projections.at(-1).summary.direction, "outgoing");
  assert.equal(projections.at(-1).tree[0].children[0].label, "callee");

  resolveIncoming({
    ok: true,
    result: [{
      sessionId: "session-1",
      itemId: "caller-1",
      name: "stale-caller",
      path: "/workspace/stale.rs",
    }],
  });
  await settle();

  assert.equal(projections.at(-1).summary.direction, "outgoing");
  assert.equal(projections.at(-1).tree[0].children[0].label, "callee");
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
  const root = {
    id: "call:root:session-1:root-1",
    type: "call",
    direction: "incoming",
    sessionId: "session-1",
    itemId: "root-1",
    childrenState: "unloaded",
    children: [],
  };
  runtime.handleCommand({
    action: "expand",
    requestId: "retained-request",
    nodeId: root.id,
    projection: {
      revision: 1,
      requestId: "retained-request",
      requestSequence: 123,
      status: "ready",
      mode: "callHierarchy",
      target: { path: "/workspace/main.rs" },
      summary: { count: 1, direction: "incoming" },
      tree: [root],
      error: null,
    },
  });
  await settle();

  assert.deepEqual(methods, ["call_hierarchy_incoming"]);
  assert.equal(projections.at(-1).requestId, "retained-request");
  assert.equal(
    projections.at(-1).tree[0].childrenState,
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

test("uses no-focus result jumps and tail-preserving path markup", async () => {
  const [source, template, touchMenuSource] = await Promise.all([
    readFile(
      path.join(appRoot, "main_page/frontend/ui/code-inspector.ts"),
      "utf8",
    ),
    readFile(path.join(appRoot, "template.html"), "utf8"),
    readFile(
      path.join(appRoot, "monaco_editor/editor_touch_menu_utils.ts"),
      "utf8",
    ),
  ]);

  assert.match(source, /focus:\s*false,\s*scrollY:\s*'center'/);
  assert.doesNotMatch(source, /splitPathForDisplay/);
  assert.match(template, /\.code-inspector-path\s*\{[^}]*text-overflow:\s*ellipsis[^}]*direction:\s*rtl/s);
  assert.match(template, /\.code-inspector-direction\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(template, /id="code-inspector-direction"[^>]*hidden/);
  assert.match(source, /directionButton\.hidden = mode !== 'callHierarchy'/);
  assert.match(touchMenuSource, /name:\s*'go to definition'/);
  assert.match(touchMenuSource, /stroke="#4ec97a"/);
});
