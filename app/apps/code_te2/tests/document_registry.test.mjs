import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkbenchDocumentRegistry,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/document-registry.mjs";
import {
  openFile,
  switchWorkspace,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/lifecycle.mjs";
import {
  tryOpenDocument,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/document-content.mjs";
import {
  dispatchJsonRpcRequest,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/server/request-dispatch.mjs";

const RPC_IDS = {
  ExtHostDocumentsAndEditors: 1,
  ExtHostDocuments: 2,
  ExtHostEditors: 3,
  ExtHostEditorTabs: 4,
  ExtHostExtensionService: 5,
  ExtHostWorkspace: 6,
};

function uriForPath(path) {
  return {
    $mid: 1,
    scheme: "file",
    fsPath: path,
    path,
    external: `file://${path}`,
  };
}

function uriToString(uri) {
  return uri.external;
}

function createRegistry(
  calls,
  {
    workspacePath = "/workspace",
    activateLanguage = async () => {},
  } = {},
) {
  let req = 0;
  return new WorkbenchDocumentRegistry({
    extRpcIds: RPC_IDS,
    uriToString,
    sendExt(rpcId, method, args, cancellable) {
      calls.push({ rpcId, method, args, cancellable });
      return ++req;
    },
    sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs) {
      calls.push({ rpcId, method, args, cancellable, timeoutMs });
      return {
        req: ++req,
        promise: Promise.resolve({ type: 9, result: null }),
      };
    },
    uriForPath,
    workspacePath: () => workspacePath,
    resolveLanguageId(path, _text, requestedLanguageId) {
      return requestedLanguageId || (path.endsWith(".rs") ? "rust" : "plaintext");
    },
    activateLanguage,
    log() {},
  });
}

function documentDeltas(calls) {
  return calls
    .filter(
      (call) =>
        call.rpcId === RPC_IDS.ExtHostDocumentsAndEditors &&
        call.method === "$acceptDocumentsAndEditorsDelta",
    )
    .map((call) => call.args[0]);
}

function tabModels(calls) {
  return calls
    .filter(
      (call) =>
        call.rpcId === RPC_IDS.ExtHostEditorTabs &&
        call.method === "$acceptEditorTabModel",
    )
    .map((call) => call.args[0][0]);
}

function logicalDescriptor(
  path,
  contentIdentity,
  {
    languageId = "rust",
    baseSha256 = "base-sha",
    dirty = true,
  } = {},
) {
  return {
    path,
    languageId,
    contentIdentity,
    baseSha256,
    dirty,
  };
}

function reconcileParams({
  projectGeneration = 2,
  openStateRevision = 10,
  activePath = "/workspace/active.rs",
  background = [],
} = {}) {
  return {
    projectPath: "/workspace",
    projectGeneration,
    openStateRevision,
    activePath,
    background,
  };
}

function hydrateParams(request, text, overrides = {}) {
  return {
    projectPath: "/workspace",
    projectGeneration: 2,
    openStateRevision: 10,
    expectedActiveEpoch: request.expectedActiveEpoch,
    path: request.path,
    text,
    languageId: request.languageId,
    contentIdentity: request.contentIdentity,
    baseSha256: request.baseSha256,
    dirty: request.dirty,
    ...overrides,
  };
}

function createLifecycleRuntime(files) {
  const calls = [];
  const events = [];
  const reads = [];
  const registry = createRegistry(calls);
  const session = {
    activeEditorId: null,
    activeUriObj: null,
    activeTab: null,
    nextModelNumber: 1,
    documentRegistry: registry,
  };
  const state = {
    workspaceFolder: "/workspace",
    activePath: null,
    activeUri: null,
    activeLanguageId: null,
    lastOpenTs: null,
  };
  const runtime = {
    ensureConnected() {},
    state,
    session,
    watcher: {
      mgmtIpc: null,
      fsWatcherSub: null,
    },
    useRemote: false,
    authority: "",
    extRpcIds: RPC_IDS,
    async readTextFile(path) {
      reads.push(path);
      if (!(path in files)) throw new Error(`missing fixture: ${path}`);
      return files[path];
    },
    uriForPath,
    uriToString,
    resolveLanguageId(path, _text, requestedLanguageId) {
      return requestedLanguageId || (path.endsWith(".rs") ? "rust" : "plaintext");
    },
    async activateLanguage() {},
    sendExt(rpcId, method, args, cancellable) {
      calls.push({ rpcId, method, args, cancellable });
      return calls.length;
    },
    sendExtAwaitTerminalReply(rpcId, method, args, cancellable, timeoutMs) {
      calls.push({ rpcId, method, args, cancellable, timeoutMs });
      return {
        req: calls.length,
        promise: Promise.resolve({ type: 9, result: null }),
      };
    },
    spanTrace(_name, fn) {
      return fn();
    },
    async spanTraceAsync(_name, fn) {
      return await fn();
    },
    logMetrics() {},
    onEvent(payload) {
      events.push(payload);
    },
    clearProjectScopedSwitchState() {
      return {
        rejectedPendingRequests: 0,
        clearedBackgroundDocuments: registry.countBackground(),
      };
    },
    sha1Short() {
      return "abcdef0";
    },
    randomUuid() {
      return "test-session";
    },
    log() {},
    warn() {},
  };
  return { calls, events, reads, registry, runtime, session, state };
}

test("registry retains once, replaces without close/open, and releases once", async () => {
  const calls = [];
  const registry = createRegistry(calls);
  const path = "/workspace/a.rs";
  const uri = uriForPath(path);

  const first = registry.retain({
    path,
    uri,
    text: "fn first() {}\n",
    languageId: "rust",
    role: "background",
    contentIdentity: "one",
    openStateRevision: 4,
    projectGeneration: 2,
  });
  const duplicate = registry.retain({
    path,
    uri,
    text: "ignored",
    languageId: "rust",
  });
  assert.equal(first.added, true);
  assert.equal(duplicate.added, false);
  assert.equal(
    documentDeltas(calls).filter((delta) => delta.addedDocuments).length,
    1,
  );

  const promoted = registry.promote(path);
  assert.equal(promoted.entry.role, "active");
  const replaced = registry.replaceFullText(
    {
      path,
      text: "fn second() {}\n",
      languageId: "rust",
      dirty: true,
      expectedActiveEpoch: promoted.entry.activeEpoch,
      expectedContentIdentity: "one",
    },
    { waitForAck: true, isDirtyEvent: true },
  );
  assert.equal(replaced.ok, true);
  assert.equal(replaced.versionId, 2);
  await replaced.ack.promise;
  assert.equal(
    calls.filter((call) => call.method === "$acceptModelChanged").length,
    1,
  );
  assert.equal(
    documentDeltas(calls).filter((delta) => delta.removedDocuments).length,
    0,
  );

  assert.equal(registry.release(path), true);
  assert.equal(registry.release(path), false);
  const removals = documentDeltas(calls).filter(
    (delta) => delta.removedDocuments,
  );
  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0].removedDocuments, [uri]);
});

test("byte-identical replacement updates metadata without model churn", () => {
  const calls = [];
  const registry = createRegistry(calls);
  const path = "/workspace/steady.rs";
  const text = "fn steady() {}\n";
  const retained = registry.retain({
    path,
    uri: uriForPath(path),
    text,
    languageId: "rust",
    role: "background",
    contentIdentity: "before",
    openGeneration: 1,
    dirty: false,
  });

  const replaced = registry.replaceFullText(
    {
      path,
      text,
      languageId: "rust",
      openGeneration: 2,
      contentIdentity: "after",
      dirty: true,
    },
    { waitForAck: true, isDirtyEvent: true },
  );

  assert.equal(replaced.ok, true);
  assert.equal(replaced.contentChanged, false);
  assert.equal(replaced.previousVersionId, retained.entry.versionId);
  assert.equal(replaced.versionId, retained.entry.versionId);
  assert.equal(replaced.ack, null);
  assert.equal(registry.getByPath(path)?.openGeneration, 2);
  assert.equal(registry.getByPath(path)?.contentIdentity, "after");
  assert.equal(registry.getByPath(path)?.dirty, true);
  assert.equal(
    calls.filter((call) => call.method === "$acceptModelChanged").length,
    0,
  );
  assert.equal(
    calls.filter((call) => call.method === "$acceptDirtyStateChanged").length,
    1,
  );
});

test("active A to B to A transfers editor role without document churn", async () => {
  const fixture = createLifecycleRuntime({
    "/workspace/a.rs": "fn a() {}\n",
    "/workspace/b.rs": "fn b() {}\n",
  });

  await openFile(fixture.runtime, { path: "/workspace/a.rs" });
  await openFile(fixture.runtime, { path: "/workspace/b.rs" });
  await openFile(fixture.runtime, { path: "/workspace/a.rs" });

  assert.deepEqual(fixture.reads, ["/workspace/a.rs", "/workspace/b.rs"]);
  assert.equal(fixture.registry.size, 2);
  assert.equal(fixture.registry.getByPath("/workspace/a.rs").role, "active");
  assert.equal(
    fixture.registry.getByPath("/workspace/b.rs").role,
    "provisional-background",
  );

  const deltas = documentDeltas(fixture.calls);
  assert.equal(
    deltas.filter((delta) => delta.addedDocuments).length,
    2,
  );
  assert.equal(
    deltas.filter((delta) => delta.removedDocuments).length,
    0,
  );
  const editorDeltas = deltas.filter((delta) => delta.addedEditors);
  assert.equal(editorDeltas.length, 3);
  assert.equal(editorDeltas[0].removedEditors, undefined);
  assert.equal(editorDeltas[1].removedEditors.length, 1);
  assert.equal(editorDeltas[2].removedEditors.length, 1);
});

test("$tryOpenDocument shares registry identity with active documents", async () => {
  const calls = [];
  const reads = [];
  const registry = createRegistry(calls);
  const activePath = "/workspace/active.rs";
  registry.retain({
    path: activePath,
    uri: uriForPath(activePath),
    text: "fn active() {}\n",
    languageId: "rust",
    role: "active",
  });
  registry.promote(activePath);
  calls.length = 0;

  const runtime = {
    extConnected: () => true,
    useRemote: false,
    defaultAuthority: "",
    extRpcIds: { ExtHostDocumentContentProviders: 7 },
    documentRegistry: registry,
    async readTextFile(path) {
      reads.push(path);
      return "fn background() {}\n";
    },
    async readBinaryFile() {
      return new Uint8Array();
    },
    async statPath() {
      return {};
    },
    languageIdFromPath() {
      return "rust";
    },
    sendExt() {},
    sendExtPending() {
      throw new Error("unused");
    },
    log() {},
  };

  await tryOpenDocument(runtime, uriForPath(activePath));
  const backgroundUri = uriForPath("/workspace/background.rs");
  await tryOpenDocument(runtime, backgroundUri);
  await tryOpenDocument(runtime, backgroundUri);

  assert.deepEqual(reads, ["/workspace/background.rs"]);
  assert.equal(registry.size, 2);
  assert.equal(
    documentDeltas(calls).filter((delta) => delta.addedDocuments).length,
    1,
  );
});

test("workspace switch removes editor facade then releases every document", async () => {
  const fixture = createLifecycleRuntime({
    "/workspace/a.rs": "fn a() {}\n",
    "/workspace/b.rs": "fn b() {}\n",
  });
  await openFile(fixture.runtime, { path: "/workspace/a.rs" });
  fixture.registry.retain({
    path: "/workspace/b.rs",
    uri: uriForPath("/workspace/b.rs"),
    text: "fn b() {}\n",
    languageId: "rust",
  });
  fixture.calls.length = 0;

  await switchWorkspace(fixture.runtime, "/other");

  assert.equal(fixture.registry.size, 0);
  const deltas = documentDeltas(fixture.calls);
  assert.deepEqual(deltas[0].removedEditors.length, 1);
  assert.equal(deltas[0].removedDocuments, undefined);
  assert.equal(deltas[1].removedDocuments.length, 2);
});

test("active document promotion emits the backend reconciliation fact", async () => {
  const fixture = createLifecycleRuntime({
    "/workspace/a.rs": "fn a() {}\n",
  });

  await openFile(fixture.runtime, { path: "/workspace/a.rs", generation: 7 });

  const activeEvent = fixture.events.find(
    (event) => event.type === "document/activeChanged",
  );
  assert.equal(activeEvent.path, "/workspace/a.rs");
  assert.equal(activeEvent.generation, 7);
  assert.equal(activeEvent.activeEpoch, 1);
  assert.equal(activeEvent.workspaceFolder, "/workspace");
});

test("active switching retains the complete synthetic tab set", async () => {
  const fixture = createLifecycleRuntime({
    "/workspace/a.rs": "fn a() {}\n",
    "/workspace/b.rs": "fn b() {}\n",
  });

  await openFile(fixture.runtime, { path: "/workspace/a.rs" });
  fixture.registry.retain({
    path: "/workspace/b.rs",
    uri: uriForPath("/workspace/b.rs"),
    text: "fn b() {}\n",
    languageId: "rust",
    role: "background",
  });
  fixture.calls.length = 0;

  await openFile(fixture.runtime, { path: "/workspace/b.rs" });
  await openFile(fixture.runtime, { path: "/workspace/a.rs" });

  const tabOperations = fixture.calls.filter(
    (call) =>
      call.rpcId === RPC_IDS.ExtHostEditorTabs &&
      call.method === "$acceptTabOperation",
  );
  assert.equal(tabOperations.length, 0);
  assert.equal(
    documentDeltas(fixture.calls).filter((delta) => delta.removedDocuments)
      .length,
    0,
  );

  const latest = tabModels(fixture.calls).at(-1);
  assert.equal(latest.tabs.length, 2);
  assert.deepEqual(
    latest.tabs.map((tab) => [tab.label, tab.isActive]),
    [
      ["a.rs", true],
      ["b.rs", false],
    ],
  );
});

test("logical reconcile requests only missing or stale background hydration", async () => {
  const calls = [];
  const registry = createRegistry(calls);
  const activePath = "/workspace/active.rs";
  const stalePath = "/workspace/stale.rs";
  const missingPath = "/workspace/missing.rs";
  const orphanPath = "/workspace/orphan.rs";

  registry.retain({
    path: activePath,
    uri: uriForPath(activePath),
    text: "fn active() {}\n",
    languageId: "rust",
    role: "active",
  });
  registry.promote(activePath);
  registry.retain({
    path: stalePath,
    uri: uriForPath(stalePath),
    text: "fn old() {}\n",
    languageId: "rust",
    role: "background",
    contentIdentity: "old-content",
    baseSha256: "old-base",
  });
  registry.retain({
    path: orphanPath,
    uri: uriForPath(orphanPath),
    text: "fn orphan() {}\n",
    languageId: "rust",
    role: "background",
    contentIdentity: "orphan-content",
    baseSha256: "orphan-base",
  });
  calls.length = 0;

  const reconciled = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath,
      background: [
        logicalDescriptor(stalePath, "new-content", {
          baseSha256: "new-base",
        }),
        logicalDescriptor(missingPath, "missing-content", {
          baseSha256: "missing-base",
        }),
      ],
    }),
  );

  assert.equal(reconciled.ok, true);
  assert.deepEqual(
    reconciled.hydration.map(({ path, reason }) => [path, reason]),
    [
      [stalePath, "content_identity_mismatch"],
      [missingPath, "missing"],
    ],
  );
  assert.deepEqual(reconciled.released, [orphanPath]);
  assert.equal(registry.getByPath(activePath).role, "active");
  assert.equal(registry.getByPath(orphanPath), null);

  const [staleRequest, missingRequest] = reconciled.hydration;
  const staleHydration = await registry.hydrateLogicalDocument(
    hydrateParams(staleRequest, "fn new() {}\n"),
  );
  const largeText = `${"const payload = 1;\n".repeat(120_000)}// eof\n`;
  const missingHydration = await registry.hydrateLogicalDocument(
    hydrateParams(missingRequest, largeText),
  );

  assert.deepEqual(
    [staleHydration.action, missingHydration.action],
    ["replaced", "retained"],
  );
  assert.equal(
    registry.getByPath(stalePath).contentIdentity,
    "new-content",
  );
  assert.equal(registry.getByPath(stalePath).baseSha256, "new-base");
  assert.equal(registry.getByPath(missingPath).charCount, largeText.length);
  const deltas = documentDeltas(calls);
  assert.equal(
    deltas.filter((delta) => delta.addedDocuments).length,
    1,
  );
});

test("missing logical documents are retained before language activation", async () => {
  const calls = [];
  const path = "/workspace/background.rs";
  let registry;
  registry = createRegistry(calls, {
    activateLanguage: async (languageId) => {
      calls.push({ method: "activateLanguage", languageId });
      assert.equal(languageId, "rust");
      assert.equal(registry.getByPath(path)?.contentIdentity, "background-content");
    },
  });
  const reconciled = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath: null,
      background: [logicalDescriptor(path, "background-content")],
    }),
  );

  const hydrated = await registry.hydrateLogicalDocument(
    hydrateParams(reconciled.hydration[0], "fn background() {}\n"),
  );

  assert.equal(hydrated.action, "retained");
  const addedIndex = calls.findIndex(
    (call) => documentDeltas([call])[0]?.addedDocuments,
  );
  const activationIndex = calls.findIndex(
    (call) => call.method === "activateLanguage",
  );
  assert.notEqual(addedIndex, -1);
  assert.notEqual(activationIndex, -1);
  assert.ok(addedIndex < activationIndex);
});

test("failed language activation rolls back only provisional hydration", async () => {
  const calls = [];
  const path = "/workspace/background.rs";
  const registry = createRegistry(calls, {
    activateLanguage: async () => {
      throw new Error("activation failed");
    },
  });
  const reconciled = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath: null,
      background: [logicalDescriptor(path, "background-content")],
    }),
  );

  const hydrated = await registry.hydrateLogicalDocument(
    hydrateParams(reconciled.hydration[0], "fn background() {}\n"),
  );

  assert.equal(hydrated.error, "language_activation_failed");
  assert.equal(registry.getByPath(path), null);
  const deltas = documentDeltas(calls);
  assert.equal(
    deltas.filter((delta) => delta.addedDocuments).length,
    1,
  );
  assert.equal(
    deltas.filter((delta) => delta.removedDocuments).length,
    1,
  );
});

test("logical hydration rejects stale revisions, generations, and active epochs", async () => {
  const calls = [];
  const registry = createRegistry(calls);
  const activePath = "/workspace/active.rs";
  const backgroundPath = "/workspace/background.rs";
  registry.retain({
    path: activePath,
    uri: uriForPath(activePath),
    text: "fn active() {}\n",
    languageId: "rust",
    role: "active",
  });
  registry.promote(activePath);

  const accepted = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath,
      background: [logicalDescriptor(backgroundPath, "background-content")],
    }),
  );
  assert.equal(accepted.ok, true);
  assert.equal(
    registry.reconcileLogicalDocuments(
      reconcileParams({
        openStateRevision: 9,
        activePath,
        background: [],
      }),
    ).error,
    "stale_open_state_revision",
  );
  assert.equal(
    registry.reconcileLogicalDocuments(
      reconcileParams({
        projectGeneration: 1,
        openStateRevision: 99,
        activePath,
        background: [],
      }),
    ).error,
    "stale_project_generation",
  );

  const request = accepted.hydration[0];
  assert.equal(
    (
      await registry.hydrateLogicalDocument(
        hydrateParams(request, "fn background() {}\n", {
          projectGeneration: 1,
        }),
      )
    ).error,
    "stale_project_generation",
  );
  assert.equal(
    (
      await registry.hydrateLogicalDocument(
        hydrateParams(request, "fn background() {}\n", {
          openStateRevision: 9,
        }),
      )
    ).error,
    "stale_open_state_revision",
  );
  assert.equal(
    (
      await registry.hydrateLogicalDocument(
        hydrateParams(request, "fn active() {}\n", {
          path: activePath,
        }),
      )
    ).error,
    "active_document_protected",
  );
  registry.promote(activePath);
  assert.equal(
    (
      await registry.hydrateLogicalDocument(
        hydrateParams(request, "fn background() {}\n"),
      )
    ).error,
    "stale_active_epoch",
  );
});

test("one rejected logical document does not abort valid snapshot hydration", async () => {
  const calls = [];
  const registry = createRegistry(calls);
  const validPath = "/workspace/valid.rs";
  const reconciled = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath: null,
      background: [
        {
          path: "/workspace/invalid.rs",
          languageId: "rust",
          baseSha256: "base",
          dirty: true,
        },
        logicalDescriptor(validPath, "valid-content"),
      ],
    }),
  );
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.rejected.length, 1);
  assert.deepEqual(
    reconciled.hydration.map((request) => request.path),
    [validPath],
  );

  const request = reconciled.hydration[0];
  const rejected = await registry.hydrateLogicalDocument(
    hydrateParams(request, "fn wrong() {}\n", {
      contentIdentity: "wrong-content",
    }),
  );
  assert.equal(rejected.error, "hydration_descriptor_mismatch");

  const accepted = await registry.hydrateLogicalDocument(
    hydrateParams(request, "fn valid() {}\n"),
  );
  assert.equal(accepted.action, "retained");
  assert.equal(registry.getByPath(validPath).contentIdentity, "valid-content");
});

test("logical reconciliation resolves omitted language IDs inside WBA", () => {
  const calls = [];
  const registry = createRegistry(calls);
  const path = "/workspace/background.rs";
  const descriptor = logicalDescriptor(path, "background-content");
  delete descriptor.languageId;

  const reconciled = registry.reconcileLogicalDocuments(
    reconcileParams({
      activePath: null,
      background: [descriptor],
    }),
  );

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.hydration.length, 1);
  assert.equal(reconciled.hydration[0].languageId, "rust");
});

test("logical document DTOs round-trip through the existing JSON-RPC dispatcher", async () => {
  const calls = [];
  const runtime = {
    wb: {
      reconcileLogicalDocuments(params) {
        calls.push(["reconcile", params]);
        return { ok: true, hydration: [] };
      },
      async hydrateLogicalDocument(params) {
        calls.push(["hydrate", params]);
        return { ok: true, action: "retained" };
      },
    },
  };
  const reconcile = JSON.parse(
    JSON.stringify({
      id: 41,
      method: "vscode.logicalDocuments.reconcile",
      params: reconcileParams(),
    }),
  );
  const hydrate = JSON.parse(
    JSON.stringify({
      id: 42,
      method: "vscode.logicalDocuments.hydrate",
      params: {
        ...logicalDescriptor("/workspace/a.rs", "content"),
        projectPath: "/workspace",
        projectGeneration: 2,
        openStateRevision: 10,
        expectedActiveEpoch: 1,
        text: "fn a() {}\n",
      },
    }),
  );

  assert.deepEqual(
    await dispatchJsonRpcRequest(runtime, reconcile),
    { jsonrpc: "2.0", id: 41, result: { ok: true, hydration: [] } },
  );
  assert.deepEqual(
    await dispatchJsonRpcRequest(runtime, hydrate),
    {
      jsonrpc: "2.0",
      id: 42,
      result: { ok: true, action: "retained" },
    },
  );
  assert.deepEqual(
    calls.map(([method]) => method),
    ["reconcile", "hydrate"],
  );
});

test("active editor selection updates use the existing WBA dispatcher", async () => {
  const calls = [];
  const params = {
    path: "/workspace/app.js",
    source: "keyboard",
    selection: {
      startLineNumber: 4,
      startColumn: 2,
      endLineNumber: 4,
      endColumn: 8,
      selectionStartLineNumber: 4,
      selectionStartColumn: 2,
      positionLineNumber: 4,
      positionColumn: 8,
    },
  };
  const runtime = {
    wb: {
      extensionEditorStateUpdate(value) {
        calls.push(value);
        return { ok: true, activePath: value.path };
      },
    },
  };

  assert.deepEqual(
    await dispatchJsonRpcRequest(runtime, {
      id: null,
      method: "vscode.editorState.update",
      params,
    }),
    {
      jsonrpc: "2.0",
      id: null,
      result: { ok: true, activePath: "/workspace/app.js" },
    },
  );
  assert.deepEqual(calls, [params]);
});
