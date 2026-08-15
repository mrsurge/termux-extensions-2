import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importMenuRuntime() {
  const result = await build({
    entryPoints: [path.join(appRoot, "monaco_editor/editor_extension_menu_runtime.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.clientWidth = 40;
    this.hidden = true;
    this.scrollLeft = 0;
    this.scrollWidth = 120;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute() {}
}

test("extension editor actions scroll horizontally with wheel input", async () => {
  const { createEditorExtensionMenuRuntime } = await importMenuRuntime();
  const root = new FakeElement();
  const documentRef = {
    createElement: () => new FakeElement(),
    getElementById: (id) => id === "fe-extension-editor-actions" ? root : null,
  };
  const runtime = createEditorExtensionMenuRuntime({
    getDocument: () => documentRef,
    getCurrentPath: () => "/workspace/example.json",
    rpcCall: async () => ({ actions: [] }),
    notify() {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });

  runtime.attach({
    getModel: () => ({ getLanguageId: () => "json" }),
  });
  const wheel = new Event("wheel", { cancelable: true });
  Object.defineProperties(wheel, {
    deltaX: { value: 0 },
    deltaY: { value: 48 },
  });
  root.dispatchEvent(wheel);
  assert.equal(root.scrollLeft, 48);
  assert.equal(wheel.defaultPrevented, true);

  runtime.dispose();
  const afterDispose = new Event("wheel", { cancelable: true });
  Object.defineProperties(afterDispose, {
    deltaX: { value: 0 },
    deltaY: { value: 20 },
  });
  root.dispatchEvent(afterDispose);
  assert.equal(root.scrollLeft, 48);
});

test("touch extension context resolves current editor menus only when opened", async (t) => {
  const { createEditorExtensionMenuRuntime } = await importMenuRuntime();
  const window = new Window({ url: "http://127.0.0.1:8089/app/code_te2" });
  t.after(() => window.close());
  window.document.body.innerHTML = '<span id="fe-extension-editor-actions"></span>';
  const calls = [];
  const runtime = createEditorExtensionMenuRuntime({
    getDocument: () => window.document,
    getCurrentPath: () => "/workspace/example.json",
    rpcCall: async (method, params) => {
      calls.push({ method, params: structuredClone(params) });
      if (method === "vscode.extensionMenus.resolve") {
        return params.menu === "editor/title"
          ? { actions: [] }
          : params.menu === "editor/context"
            ? {
                actions: [{
                  command: "chatgpt.addToThread",
                  title: "Add to Thread",
                  category: "Codex",
                  extensionId: "openai.chatgpt",
                  group: "navigation",
                  icon: null,
                  enabled: true,
                  alternate: null,
                }],
              }
            : { actions: [] };
      }
      return { ok: true };
    },
    notify() {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  runtime.attach({
    getModel: () => ({ getLanguageId: () => "json" }),
    getSelection: () => ({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 7,
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "vscode.extensionMenus.resolve")
      .map((entry) => entry.params.menu),
    ["editor/title"],
    "context contributions must not be snapshotted during editor attach",
  );

  let touchMenuClosed = 0;
  const [tool] = runtime.navigationTools({
    closeMenu() {
      touchMenuClosed += 1;
    },
  });
  const anchor = window.document.createElement("button");
  anchor.appendChild(tool.innerHTML);
  window.document.body.appendChild(anchor);
  await tool.action();
  assert.equal(touchMenuClosed, 1);
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "vscode.extensionMenus.resolve")
      .map((entry) => entry.params.menu),
    ["editor/title", "editor/title/context", "editor/context"],
  );
  const command = window.document.querySelector(
    ".fe-extension-editor-context-menu button:not(:disabled)",
  );
  assert.equal(command.textContent, "Codex: Add to Thread");
  command.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const execution = calls.find(
    (entry) => entry.method === "vscode.extensionCommands.execute",
  );
  assert.equal(execution.params.surface, "editor");
  assert.equal(execution.params.command, "chatgpt.addToThread");
  assert.equal(execution.params.path, "/workspace/example.json");
  assert.deepEqual(execution.params.selection, {
    startLineNumber: 2,
    startColumn: 3,
    endLineNumber: 2,
    endColumn: 7,
    selectionStartLineNumber: 2,
    selectionStartColumn: 3,
    positionLineNumber: 2,
    positionColumn: 7,
  });
  runtime.dispose();
});
