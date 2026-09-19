import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { ClientOperationGate } from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/client-operation-gate.mjs";
import { provideDocumentSymbols } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/structure.mjs";
import { getSemanticTokensLegend, provideSemanticTokens, provideSemanticTokensRange } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/semantic-tokens.mjs";

function runtime() {
  return {
    ensureConnected() {},
    defaultAuthority: () => "localhost",
    documentScheme: () => "file",
    languageIdFromPath: () => "yaml",
    getDocumentVersion: () => 1,
    getActiveGeneration: () => 1,
    selectorGroupsSummary: () => "python",
    findAllProviderHandles: () => [],
    findSemanticFullHandles: () => [],
    findSemanticRangeHandles: () => [],
    getProjection: () => null,
    log() {},
    timeLabel: () => "test",
    waitFor() { assert.fail("Missing providers must never poll inside the editor queue"); },
  };
}

test("missing YAML symbols release the gate before a Python cache read", async () => {
  const gate = new ClientOperationGate();
  const rt = runtime();
  const missing = gate.run("client_test", () => provideDocumentSymbols(rt, {
    path: "/a.yaml", languageId: "yaml",
  }), { label: "symbols", timeoutMs: 1000 });
  const cached = { type: "full", data: [0, 0, 3, 0, 0], resultId: "1" };
  const python = gate.run("client_test", () => provideSemanticTokens({
    ...rt, getProjection: () => cached,
    findSemanticFullHandles() { assert.fail("Python must use the retained projection"); },
  }, { path: "/a.py", languageId: "python" }), { label: "tokens", timeoutMs: 1000 });
  assert.equal((await missing).ok, false);
  assert.deepEqual((await python).result, cached);
});

test("missing full/range providers and legends return without polling", async () => {
  const rt = runtime();
  assert.equal(await getSemanticTokensLegend(rt, "yaml"), null);
  assert.equal((await provideSemanticTokens(rt, { path: "/a.yaml" })).ok, false);
  assert.equal((await provideSemanticTokensRange(rt, {
    path: "/a.yaml", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 },
  })).ok, false);
});

test("late symbol registrations reach the editor retry callback", async () => {
  const source = new URL("../monaco_editor/editor_wba_runtime_handlers.ts", import.meta.url);
  // Bun can load TypeScript directly; Node uses the frontend's esbuild compiler.
  let moduleUrl = source.href;
  if (!process.versions.bun) {
    const built = await build({
      entryPoints: [source.pathname],
      bundle: true, platform: "node", format: "esm", write: false,
    });
    moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`;
  }
  const { registerEditorWbaRuntimeHandlers } = await import(moduleUrl);
  const handlers = new Map();
  const retries = [];
  registerEditorWbaRuntimeHandlers({ onNotification(name, fn) { handlers.set(name, fn); return () => {}; } }, {
    onDocumentSymbolsProviderRegistered: (language) => retries.push(language),
  });
  handlers.get("te2.event")({ type: "provider/documentSymbols", language: "python" });
  handlers.get("te2.event")({ type: "provider/documentSymbols" });
  assert.deepEqual(retries, ["python"]);
});
