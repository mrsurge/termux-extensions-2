import assert from "node:assert/strict";
import test from "node:test";

import {
  CallHierarchySessionStore,
  prepareCallHierarchy,
  provideDefinitions,
  provideDocumentHighlights,
  provideImplementations,
  provideIncomingCalls,
  provideOutgoingCalls,
  provideReferences,
  releaseCallHierarchy,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/code-navigation.mjs";
import { ProviderRegistry } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/provider-registry.mjs";
import {
  dispatchJsonRpcRequest,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs";

function location(path, line, column) {
  return {
    uri: { scheme: "file", path },
    range: {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column + 1,
    },
  };
}

function createRuntime(
  replies,
  calls = [],
  readTextFile = async (filePath) =>
    Array.from(
      { length: 32 },
      (_value, index) => `line ${index + 1} from ${filePath}`,
    ).join("\n"),
) {
  const sessions = new CallHierarchySessionStore();
  return {
    ensureConnected() {},
    languageFeaturesRpcId: 94,
    defaultAuthority: () => "remote",
    documentScheme: () => "file",
    languageIdFromPath: () => "rust",
    findAllProviderHandles: (_kind, document) => {
      assert.equal(document.scheme, "file");
      assert.equal(document.languageId, "rust");
      return [12, 13];
    },
    waitFor: async () => true,
    uriForPath: (filePath) => ({ scheme: "file", path: filePath }),
    sendExtPending: (_rpcId, method, args, cancellable) => {
      calls.push({ method, args, cancellable });
      const reply = replies.shift();
      return { promise: Promise.resolve(reply) };
    },
    sendExt: (_rpcId, method, args) => {
      calls.push({ method, args });
    },
    readTextFile,
    sessions,
    log() {},
  };
}

test("registers exact navigation methods and filters document selectors", () => {
  const registry = new ProviderRegistry();
  assert.equal(
    registry.registerFromRequest("$registerDefinitionSupport", [
      20,
      [{ language: "rust", scheme: "file", pattern: "**/*.rs" }],
    ]).handled,
    true,
  );
  assert.equal(
    registry.registerFromRequest("$registerReferenceSupport", [
      21,
      [{ language: "rust", scheme: "file", pattern: "**/*.rs" }],
    ]).handled,
    true,
  );
  registry.registerFromRequest("$registerImplementationSupport", [
    22,
    ["rust"],
  ]);
  registry.registerFromRequest("$registerCallHierarchyProvider", [
    23,
    [{ language: "rust", scheme: "vscode-remote" }],
  ]);
  registry.registerFromRequest("$registerDocumentHighlightProvider", [
    25,
    [{ language: "rust", scheme: "file" }],
  ]);
  registry.registerFromRequest("$registerReferenceSupport", [
    24,
    [{
      language: "rust",
      scheme: "file",
      pattern: {
        baseUri: { scheme: "file", path: "/workspace" },
        pattern: "{src,tests}/**/*.rs",
      },
    }],
  ]);
  registry.registerFromRequest("$registerReferenceSupport", [
    26,
    [{ language: "rust", scheme: "file", isBuiltin: true }],
  ]);

  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("documentHighlights", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/workspace/src/main.rs",
    }),
    [25],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("definitions", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/workspace/src/main.rs",
    }),
    [20],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("references", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/workspace/src/main.rs",
    }),
    [24, 21, 26],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("references", {
      languageId: "rust",
      scheme: "vscode-remote",
      authority: "remote",
      path: "/workspace/src/main.rs",
    }),
    [],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("implementations", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/workspace/src/main.rs",
    }),
    [22],
  );
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("references", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/other/src/main.rs",
    }),
    [21, 26],
  );
});

test("merges and deduplicates document highlights from matching providers", async () => {
  const calls = [];
  const range = {
    startLineNumber: 4,
    startColumn: 3,
    endLineNumber: 4,
    endColumn: 7,
  };
  const runtime = createRuntime(
    [
      { type: 9, result: [{ range, kind: 2 }] },
      { type: 9, result: [{ range, kind: 2 }] },
    ],
    calls,
  );

  const result = await provideDocumentHighlights(runtime, {
    path: "/workspace/main.rs",
    languageId: "rust",
    lineNumber: 4,
    column: 3,
  });

  assert.deepEqual(result.result, [{ range, kind: 2 }]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, "$provideDocumentHighlights");
    assert.equal(call.cancellable, true);
    assert.equal(call.args.length, 3);
  }
});

test("resolves definitions without reading source previews", async () => {
  const calls = [];
  const reads = [];
  const runtime = createRuntime([
    {
      type: 9,
      result: [location("/workspace/z.rs", 14, 3)],
    },
    {
      type: 9,
      result: [location("/workspace/a.rs", 2, 7)],
    },
  ], calls, async (filePath) => {
    reads.push(filePath);
    return "unused";
  });

  const result = await provideDefinitions(runtime, {
    path: "/workspace/main.rs",
    languageId: "rust",
    lineNumber: 4,
    column: 3,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.result.map((entry) => [
      entry.path,
      entry.range.startLineNumber,
      entry.range.startColumn,
    ]),
    [
      ["/workspace/a.rs", 2, 7],
      ["/workspace/z.rs", 14, 3],
    ],
  );
  assert.deepEqual(reads, []);
  for (const call of calls) {
    assert.equal(call.method, "$provideDefinition");
    assert.equal(call.cancellable, true);
    assert.equal(call.args.length, 3);
  }
});

test("dispatches definition requests after activating the document language", async () => {
  const calls = [];
  const runtime = {
    defaultRemoteAuthority: "remote",
    normalizePathParam: (params) => params.path || "",
    normalizeAuthorityParam: (params, fallback) =>
      params.authority || fallback,
    wb: {
      async runClientDocumentOperation(_params, _label, operation) {
        return await operation();
      },
      resolveLanguageId: (_path, _text, languageId) =>
        languageId || "rust",
      async activateLanguage(languageId) {
        calls.push(["activate", languageId]);
      },
      async definitions(params) {
        calls.push(["definitions", params]);
        return { ok: true, result: [] };
      },
    },
  };

  const response = await dispatchJsonRpcRequest(runtime, {
    id: 55,
    method: "vscode.definition",
    params: {
      path: "/workspace/main.rs",
      languageId: "rust",
      lineNumber: 4,
      column: 3,
    },
  });

  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 55,
    result: { ok: true, result: [] },
  });
  assert.deepEqual(calls, [
    ["activate", "rust"],
    ["definitions", {
      path: "/workspace/main.rs",
      authority: "remote",
      languageId: "rust",
      lineNumber: 4,
      column: 3,
      timeoutMs: undefined,
      generation: undefined,
    }],
  ]);
});

test("matching exclusive document selectors suppress ordinary providers", () => {
  const registry = new ProviderRegistry();
  registry.registerFromRequest("$registerCallHierarchyProvider", [
    31,
    [{ language: "rust", scheme: "file" }],
  ]);
  registry.registerFromRequest("$registerCallHierarchyProvider", [
    32,
    [{ language: "rust", scheme: "file", exclusive: true }],
  ]);
  assert.deepEqual(
    registry.findAllProviderHandlesForDocument("callHierarchy", {
      languageId: "rust",
      scheme: "file",
      authority: "",
      path: "/workspace/main.rs",
    }),
    [32],
  );
});

test("merges, sorts, and deduplicates references from every provider", async () => {
  const calls = [];
  const reads = [];
  const duplicate = location("/workspace/b.rs", 9, 4);
  const runtime = createRuntime([
    {
      type: 9,
      result: [duplicate, location("/workspace/a.rs", 2, 1)],
    },
    {
      type: 9,
      result: [duplicate, location("/workspace/b.rs", 3, 2)],
    },
  ], calls, async (filePath) => {
    reads.push(filePath);
    return Array.from(
      { length: 12 },
      (_value, index) => `preview line ${index + 1} from ${filePath}`,
    ).join("\n");
  });

  const result = await provideReferences(runtime, {
    path: "/workspace/main.rs",
    languageId: "rust",
    lineNumber: 4,
    column: 3,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.result.map((entry) => [
      entry.path,
      entry.range.startLineNumber,
      entry.range.startColumn,
    ]),
    [
      ["/workspace/a.rs", 2, 1],
      ["/workspace/b.rs", 3, 2],
      ["/workspace/b.rs", 9, 4],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["$provideReferences", "$provideReferences"],
  );
  for (const call of calls) {
    assert.equal(call.cancellable, true);
    assert.equal(call.args.length, 4);
    assert.deepEqual(call.args.at(-1), { includeDeclaration: true });
  }
  assert.deepEqual(reads.sort(), ["/workspace/a.rs", "/workspace/b.rs"]);
  assert.equal(
    result.result[0].preview,
    "preview line 2 from /workspace/a.rs",
  );
});

test("bounds location previews around the semantic hit", async () => {
  const runtime = createRuntime(
    [{
      type: 9,
      result: [location("/workspace/minified.js", 1, 321)],
    }],
    [],
    async () => `${"a".repeat(320)}target${"b".repeat(400)}`,
  );
  runtime.findAllProviderHandles = () => [12];

  const result = await provideReferences(runtime, {
    path: "/workspace/main.js",
    languageId: "javascript",
    lineNumber: 1,
    column: 1,
  });

  assert.ok(result.result[0].preview.includes("target"));
  assert.ok(result.result[0].preview.length <= 240);
  assert.doesNotMatch(result.result[0].preview, /[\r\n]/);
});

test("retains call hierarchy sessions for lazy expansion and releases them", async () => {
  const calls = [];
  const runtime = createRuntime([
    {
      type: 9,
      result: [{
        _sessionId: "session-1",
        _itemId: "root-1",
        name: "main",
        detail: "fn main",
        uri: { scheme: "file", path: "/workspace/main.rs" },
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 3,
          endColumn: 2,
        },
        selectionRange: {
          startLineNumber: 1,
          startColumn: 4,
          endLineNumber: 1,
          endColumn: 8,
        },
      }],
    },
    {
      type: 9,
      result: [{
        from: {
          _sessionId: "session-1",
          _itemId: "caller-1",
          name: "caller",
          uri: { scheme: "file", path: "/workspace/lib.rs" },
          range: {
            startLineNumber: 7,
            startColumn: 1,
            endLineNumber: 9,
            endColumn: 2,
          },
        },
        fromRanges: [],
      }],
    },
  ], calls);
  runtime.findAllProviderHandles = () => [12];

  const prepared = await prepareCallHierarchy(runtime, {
    path: "/workspace/main.rs",
    lineNumber: 1,
    column: 4,
  });
  assert.equal(prepared.result[0].sessionId, "session-1");
  assert.equal(runtime.sessions.get("session-1").providerHandle, 12);

  const incoming = await provideIncomingCalls(runtime, {
    sessionId: "session-1",
    itemId: "root-1",
  });
  assert.equal(incoming.result[0].name, "caller");
  assert.equal(incoming.result[0].direction, "incoming");

  const released = releaseCallHierarchy(runtime, { sessionId: "session-1" });
  assert.deepEqual(released, { ok: true, released: true });
  assert.equal(runtime.sessions.get("session-1"), null);
  assert.equal(calls.at(-1).method, "$releaseCallHierarchy");
  assert.deepEqual(
    calls.slice(0, 2).map((call) => ({
      method: call.method,
      argCount: call.args.length,
      cancellable: call.cancellable,
    })),
    [
      { method: "$prepareCallHierarchy", argCount: 3, cancellable: true },
      {
        method: "$provideCallHierarchyIncomingCalls",
        argCount: 3,
        cancellable: true,
      },
    ],
  );
});

test("uses the implementation and outgoing-call extension-host methods", async () => {
  const calls = [];
  const runtime = createRuntime([
    {
      type: 9,
      result: [location("/workspace/implementation.rs", 5, 2)],
    },
    {
      type: 9,
      result: [{
        to: {
          _sessionId: "session-2",
          _itemId: "callee-1",
          name: "callee",
          uri: { scheme: "file", path: "/workspace/callee.rs" },
          range: {
            startLineNumber: 14,
            startColumn: 1,
            endLineNumber: 16,
            endColumn: 2,
          },
        },
        fromRanges: [],
      }],
    },
  ], calls);
  runtime.findAllProviderHandles = () => [12];

  const implementations = await provideImplementations(runtime, {
    path: "/workspace/main.rs",
    languageId: "rust",
    lineNumber: 4,
    column: 3,
  });
  assert.equal(implementations.result[0].path, "/workspace/implementation.rs");

  runtime.sessions.track(12, "session-2");
  const outgoing = await provideOutgoingCalls(runtime, {
    sessionId: "session-2",
    itemId: "root-2",
  });
  assert.equal(outgoing.result[0].name, "callee");
  assert.equal(outgoing.result[0].direction, "outgoing");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["$provideImplementation", "$provideCallHierarchyOutgoingCalls"],
  );
  assert.deepEqual(
    calls.map((call) => ({
      argCount: call.args.length,
      cancellable: call.cancellable,
    })),
    [
      { argCount: 3, cancellable: true },
      { argCount: 3, cancellable: true },
    ],
  );
});
