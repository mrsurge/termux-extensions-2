import assert from "node:assert/strict";
import test from "node:test";

import { provideCompletions } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/completions.mjs";
import { ProviderRegistry } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/provider-registry.mjs";

test("completion dispatch includes every provider matching the exact document", async () => {
  const registry = new ProviderRegistry();
  registry.registerFromRequest("$registerCompletionsProvider", [
    24,
    [
      {
        scheme: "vscode-remote",
        pattern: "**/*.{css,scss,less,sass,styl}",
      },
    ],
    ["#", "."],
    false,
  ]);
  registry.registerFromRequest("$registerCompletionsProvider", [
    26,
    [{ language: "css", scheme: "vscode-remote", isBuiltin: true }],
    [":", "-"],
    false,
  ]);

  const calls = [];
  const runtime = {
    ensureConnected() {},
    languageFeaturesRpcId: 94,
    defaultAuthority: () => "remote",
    documentScheme: () => "vscode-remote",
    languageIdFromPath: () => "css",
    didChange: async () => ({ ok: true }),
    findAllProviderHandles: (kind, document) =>
      registry.findAllProviderHandlesForDocument(kind, document),
    waitFor: async () => true,
    uriForPath: (filePath, authority) => ({
      scheme: "vscode-remote",
      authority,
      path: filePath,
    }),
    sendExtPending: (_rpcId, method, args) => {
      calls.push({ method, args });
      return { promise: Promise.resolve({ type: 7 }) };
    },
    log() {},
    warn() {},
  };

  const result = await provideCompletions(runtime, {
    authority: "remote",
    path: "/home/mrsurge/test/test/static/styles.css",
    languageId: "css",
    lineNumber: 1,
    column: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    [24, 26],
  );
  assert.ok(calls.every((call) => call.method === "$provideCompletionItems"));
});

test("path-only selectors do not leak onto nonmatching documents", () => {
  const registry = new ProviderRegistry();
  registry.registerFromRequest("$registerHoverProvider", [
    40,
    [{ scheme: "vscode-remote", pattern: "**/*.css" }],
  ]);
  registry.registerFromRequest("$registerHoverProvider", [
    41,
    [{ language: "css", scheme: "vscode-remote", isBuiltin: true }],
  ]);

  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("hover", {
      languageId: "css",
      scheme: "vscode-remote",
      authority: "remote",
      path: "/workspace/styles.css",
    }),
    [40, 41],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("hover", {
      languageId: "css",
      scheme: "vscode-remote",
      authority: "remote",
      path: "/workspace/index.js",
    }),
    [41],
  );
});
