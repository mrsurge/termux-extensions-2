import assert from "node:assert/strict";
import test from "node:test";

import {
  SemanticTokenProjectionManager,
  semanticTextFingerprint,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/semantic-token-projections.mjs";
import {
  provideSemanticTokens,
  provideSemanticTokensRange,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/semantic-tokens.mjs";
import {
  dispatchJsonRpcRequest,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs";

function document(path, overrides = {}) {
  return {
    path,
    versionId: 1,
    contentIdentity: `identity:${path}`,
    languageId: "rust",
    textFingerprint: semanticTextFingerprint(`fn ${path}() {}`),
    projectGeneration: 4,
    role: "background",
    ...overrides,
  };
}

function fullResult(id, data) {
  return {
    type: "full",
    resultId: String(id),
    data,
    dto: { id, type: "full", data },
    legend: {
      tokenTypes: ["function"],
      tokenModifiers: [],
    },
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
}

test("projection hits require exact document and text identity", () => {
  const documents = new Map([
    ["/workspace/a.rs", document("/workspace/a.rs")],
  ]);
  const manager = new SemanticTokenProjectionManager({
    getDocument: (path) => documents.get(path) ?? null,
    listBackgroundPaths: () => [],
    async compute() {},
  });
  const snapshot = { ...documents.get("/workspace/a.rs") };
  assert.equal(
    manager.store(snapshot, fullResult(7, [0, 0, 2, 0, 0])),
    true,
  );
  assert.deepEqual(
    manager.get(
      snapshot.path,
      snapshot.languageId,
      snapshot.textFingerprint,
    )?.data,
    [0, 0, 2, 0, 0],
  );
  assert.equal(manager.get(snapshot.path, snapshot.languageId, "wrong"), null);

  manager.store(snapshot, fullResult(8, [0, 0, 2, 0, 0]));
  documents.set(snapshot.path, { ...snapshot, versionId: 2 });
  assert.equal(
    manager.get(snapshot.path, snapshot.languageId, snapshot.textFingerprint),
    null,
  );
  assert.equal(manager.size, 0);
});

test("provider invalidation ignores range providers and refreshes full providers", async () => {
  const path = "/workspace/a.rs";
  const documents = new Map([[path, document(path)]]);
  let computed = 0;
  const manager = new SemanticTokenProjectionManager({
    getDocument: (candidate) => documents.get(candidate) ?? null,
    listBackgroundPaths: () => [path],
    async compute() {
      computed += 1;
    },
  });
  const snapshot = documents.get(path);
  manager.store(snapshot, fullResult(1, [0, 0, 1, 0, 0]));
  const staleProviderGeneration = manager.generation;

  manager.providerChanged(true);
  assert.ok(manager.get(path, "rust", snapshot.textFingerprint));

  manager.providerChanged(false);
  assert.equal(
    manager.store(
      snapshot,
      fullResult(2, [0, 0, 1, 0, 0]),
      staleProviderGeneration,
    ),
    false,
  );
  assert.equal(manager.get(path, "rust", snapshot.textFingerprint), null);
  await waitFor(() => computed === 1);
});

test("prewarm scheduling is serialized and waits for foreground opens", async () => {
  const paths = ["/workspace/a.rs", "/workspace/b.rs", "/workspace/c.rs"];
  const documents = new Map(paths.map((path) => [path, document(path)]));
  let canRun = false;
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  const manager = new SemanticTokenProjectionManager({
    getDocument: (path) => documents.get(path) ?? null,
    listBackgroundPaths: () => paths,
    canRun: () => canRun,
    async compute() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      completed += 1;
    },
  });

  manager.scheduleAll();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(completed, 0);
  canRun = true;
  await waitFor(() => completed === paths.length);
  assert.equal(maxActive, 1);
});

test("memory pressure evicts complete least-recently-used projections", () => {
  const first = document("/workspace/a.rs");
  const second = document("/workspace/b.rs");
  const documents = new Map([
    [first.path, first],
    [second.path, second],
  ]);
  const released = [];
  const manager = new SemanticTokenProjectionManager({
    getDocument: (path) => documents.get(path) ?? null,
    listBackgroundPaths: () => [],
    async compute() {},
    maxBytes: 24,
    releaseResult(providerHandle, resultId) {
      released.push([providerHandle, resultId]);
    },
  });

  manager.store(
    first,
    { ...fullResult(1, [0, 0, 1, 0, 0]), providerHandle: 41 },
  );
  manager.store(
    second,
    { ...fullResult(2, [0, 0, 1, 0, 0]), providerHandle: 42 },
  );
  assert.equal(manager.size, 1);
  assert.deepEqual(released, [[41, "1"]]);
  assert.equal(manager.get(first.path, "rust", first.textFingerprint), null);
  assert.deepEqual(
    manager.get(second.path, "rust", second.textFingerprint)?.data,
    [0, 0, 1, 0, 0],
  );
});

test("full requests can return a projection without syncing or invoking a provider", async () => {
  const path = "/workspace/a.rs";
  const text = "fn a() {}";
  const projected = fullResult(11, [0, 0, 2, 0, 0]);
  let projectionReads = 0;
  const runtime = {
    ensureConnected() {},
    languageFeaturesRpcId: 1,
    defaultAuthority: () => "",
    documentScheme: () => "file",
    languageIdFromPath: () => "rust",
    didChange() {
      throw new Error("didChange should not run on a projection hit");
    },
    findAllProviderHandles: () => [],
    findSemanticFullHandles: () => {
      throw new Error("provider lookup should not run on a projection hit");
    },
    findSemanticRangeHandles: () => [],
    getProjectionDocument: () => null,
    getProjection(candidatePath, languageId, fingerprint) {
      projectionReads += 1;
      assert.equal(candidatePath, path);
      assert.equal(languageId, "rust");
      assert.equal(fingerprint, semanticTextFingerprint(text));
      return projected;
    },
    storeProjection() {
      throw new Error("projection hit must not be stored again");
    },
    releaseResult() {
      throw new Error("projection hit must not release provider results");
    },
    async waitFor() {
      return false;
    },
    uriForPath() {
      throw new Error("URI lookup should not run on a projection hit");
    },
    sendExtPending() {
      throw new Error("provider request should not run on a projection hit");
    },
    getProvider: () => undefined,
    log() {},
    warn() {},
    timeLabel: () => "",
  };

  const response = await provideSemanticTokens(runtime, {
    path,
    languageId: "rust",
    text,
    modelVersionId: 9,
  });
  assert.equal(projectionReads, 1);
  assert.equal(response.projected, true);
  assert.deepEqual(response.result.data, projected.data);
});

test("multi-provider full requests release non-winning provider results", async () => {
  const path = "/workspace/a.rs";
  const snapshot = document(path);
  const released = [];
  let stored = null;
  const runtime = {
    ensureConnected() {},
    languageFeaturesRpcId: 1,
    defaultAuthority: () => "",
    documentScheme: () => "file",
    languageIdFromPath: () => "rust",
    didChange() {
      throw new Error("no text was supplied");
    },
    findAllProviderHandles: () => [1, 2],
    findSemanticFullHandles: () => [1, 2],
    findSemanticRangeHandles: () => [],
    getProjectionDocument: () => snapshot,
    getProjection: () => null,
    getProjectionGeneration: () => 6,
    storeProjection(documentSnapshot, result) {
      stored = { documentSnapshot, result };
      return true;
    },
    releaseResult(providerHandle, resultId) {
      released.push([providerHandle, resultId]);
    },
    async waitFor() {
      return true;
    },
    uriForPath(candidatePath) {
      return { path: candidatePath };
    },
    sendExtPending(_rpcId, _method, args) {
      const handle = args[0];
      const data =
        handle === 1
          ? [0, 0, 1, 0, 0]
          : [0, 0, 1, 0, 0, 0, 2, 1, 0, 0];
      return {
        promise: Promise.resolve({
          type: 9,
          result: { id: handle + 10, type: "full", data },
        }),
      };
    },
    getProvider: () => ({
      legend: { tokenTypes: ["function"], tokenModifiers: [] },
    }),
    log() {},
    warn() {},
    timeLabel: () => "",
  };

  const response = await provideSemanticTokens(runtime, {
    path,
    languageId: "rust",
  });
  assert.equal(response.ok, true);
  assert.equal(stored.result.providerHandle, 2);
  assert.deepEqual(released, [[1, "11"]]);
});

test("range requests remain live provider calls and never touch projections", async () => {
  const calls = [];
  const runtime = {
    ensureConnected() {},
    languageFeaturesRpcId: 1,
    defaultAuthority: () => "",
    documentScheme: () => "file",
    languageIdFromPath: () => "rust",
    didChange() {
      throw new Error("no text was supplied");
    },
    findAllProviderHandles: () => [],
    findSemanticFullHandles: () => [],
    findSemanticRangeHandles: () => [22],
    getProjectionDocument() {
      throw new Error("range request inspected full projection state");
    },
    getProjection() {
      throw new Error("range request read full projection cache");
    },
    storeProjection() {
      throw new Error("range request wrote full projection cache");
    },
    releaseResult() {
      throw new Error("range request released full projection state");
    },
    async waitFor() {
      return true;
    },
    uriForPath(path) {
      return { path };
    },
    sendExtPending(_rpcId, method, args) {
      calls.push({ method, args });
      return {
        promise: Promise.resolve({
          type: 9,
          result: {
            id: 5,
            type: "full",
            data: [0, 0, 2, 0, 0],
          },
        }),
      };
    },
    getProvider() {
      return { legend: { tokenTypes: ["function"], tokenModifiers: [] } };
    },
    log() {},
    warn() {},
    timeLabel: () => "",
  };

  const response = await provideSemanticTokensRange(runtime, {
    path: "/workspace/a.rs",
    languageId: "rust",
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5,
    },
  });
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "$provideDocumentRangeSemanticTokens");
});

test("JSON-RPC dispatch preserves Monaco model versions for both token methods", async () => {
  const calls = [];
  const runtime = {
    wb: {
      async runClientDocumentOperation(_params, _label, operation) {
        return await operation();
      },
      resolveLanguageId: () => "rust",
      async activateLanguage() {
        return { ok: true };
      },
      async semanticTokens(params) {
        calls.push(["full", params]);
        return { ok: true };
      },
      async semanticTokensRange(params) {
        calls.push(["range", params]);
        return { ok: true };
      },
    },
    defaultRemoteAuthority: "",
    normalizePathParam: (params) => String(params.path ?? ""),
    normalizeAuthorityParam: (params, fallback) =>
      String(params.authority ?? fallback ?? ""),
    log() {},
  };
  const shared = {
    path: "/workspace/a.rs",
    languageId: "rust",
    text: "fn a() {}",
    modelVersionId: 73,
  };

  await dispatchJsonRpcRequest(runtime, {
    id: 1,
    method: "vscode.semanticTokens",
    params: shared,
  });
  await dispatchJsonRpcRequest(runtime, {
    id: 2,
    method: "vscode.semanticTokensRange",
    params: {
      ...shared,
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5,
      },
    },
  });

  assert.equal(calls[0][1].modelVersionId, 73);
  assert.equal(calls[1][1].modelVersionId, 73);
});
