import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importRuntime() {
  const result = await build({
    entryPoints: [path.join(appRoot, "monaco_editor/editor_extension_navigation_runtime.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("frontend applies extension selections and acknowledges the exact operation", async () => {
  const { createEditorExtensionNavigationRuntime } = await importRuntime();
  const selections = [];
  const reveals = [];
  const calls = [];
  const runtime = createEditorExtensionNavigationRuntime({
    getCurrentPath: () => "/workspace/main.ts",
    getEditor: () => ({
      setSelections: (value) => selections.push(value),
      revealRangeInCenterIfOutsideViewport: (value) => reveals.push(value),
    }),
    rpcCall: async (method, params) => {
      calls.push({ method, params });
      return { ok: true };
    },
  });
  await runtime.handle({
    operationId: "op-1",
    operation: "setSelections",
    path: "/workspace/main.ts",
    selections: [{
      startLineNumber: 2,
      startColumn: 4,
      endLineNumber: 2,
      endColumn: 7,
    }],
    revealSelection: true,
  });
  assert.equal(selections.length, 1);
  assert.equal(reveals.length, 1);
  assert.deepEqual(calls, [{
    method: "vscode.editorOperation.complete",
    params: { operationId: "op-1", ok: true },
  }]);
});
