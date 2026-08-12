import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

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
