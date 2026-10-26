import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  WorkbenchClient,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs";

const ELECTRON_PRIMARY = "client_111111111111";
const ELECTRON_SECONDARY = "client_222222222222";
const MOBILE_PRIMARY = "client_333333333333";
const MOBILE_SECONDARY = "client_444444444444";

test("webview file-link dispatch uses the requesting client facade and existing navigation owner", async () => {
  const { client, root, mainPath, painPath } = await createHarness();
  try {
    await open(client, ELECTRON_PRIMARY, mainPath, "link_a", 1);
    await open(client, MOBILE_PRIMARY, painPath, "link_b", 1);
    const runtime = client._webviews;
    runtime.handleMainThreadRequest({ rpcId: 45, method: "$createWebviewPanel", args: [
      { id: { value: "example.links" }, location: { scheme: "file", path: root } },
      "link-panel", "example.links", { title: "Link", webviewOptions: {} }, {},
    ] });
    const surface = runtime.snapshot().surfaces[0];
    const attached = await runtime.attach({ surfaceId: surface.surfaceId, clientInstanceId: ELECTRON_PRIMARY,
      windowId: "window_browseridentity0001", presentationId: "presentation_links" });
    const seen = [];
    client._extensionEditorNavigation.openFromWorkbenchCommand = async (uri, options) => {
      seen.push({ uri, options, client: client._projectedClientInstanceId });
      return { ok: true };
    };
    const result = await client.webviewOpenLink({ surfaceId: surface.surfaceId, clientInstanceId: ELECTRON_PRIMARY,
      serverEpoch: attached.serverEpoch, surfaceGeneration: attached.surfaceGeneration,
      htmlRevision: attached.htmlRevision, href: `file://${mainPath}#L2C1` });
    assert.deepEqual(result, { ok: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].client, ELECTRON_PRIMARY);
    assert.equal(seen[0].uri.path, mainPath);
    assert.equal(seen[0].options.selection.startLineNumber, 2);
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("editor property deltas preserve client, generation, ranges, selections and options", async () => {
  const { client, calls, root, mainPath, painPath } = await createHarness();
  try {
    await open(client, ELECTRON_PRIMARY, mainPath, "props_a", 7);
    await open(client, MOBILE_PRIMARY, mainPath, "props_b", 8);
    const facades = facadeByClient(client);
    const a = facades.get(ELECTRON_PRIMARY).editorId;
    const b = facades.get(MOBILE_PRIMARY).editorId;
    calls.length = 0;
    const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 };
    const selection = { ...range, selectionStartLineNumber: 2, selectionStartColumn: 1,
      positionLineNumber: 1, positionColumn: 1 };
    const options = { tabSize: 4, indentSize: 4, originalIndentSize: "tabSize",
      insertSpaces: true, cursorStyle: 1, lineNumbers: 2 };
    const request = { clientInstanceId: ELECTRON_PRIMARY, path: mainPath, generation: 7 };
    await client.extensionEditorStateUpdate({ ...request, selections: [selection, selection],
      visibleRanges: [range], options, source: "keyboard" });
    let properties = calls.filter(call => call.method === "$acceptEditorPropertiesChanged");
    assert.equal(properties.length, 1);
    assert.equal(properties[0].args[0], a);
    assert.deepEqual(properties[0].args[1], {
      selections: { selections: [selection, selection], source: "keyboard" }, visibleRanges: [range], options,
    });

    // A viewport-only update must not synthesize another selection event.
    await client.extensionEditorStateUpdate({ ...request, visibleRanges: [], selection });
    properties = calls.filter(call => call.method === "$acceptEditorPropertiesChanged");
    assert.deepEqual(properties.at(-1).args, [a, { selections: null, options: null, visibleRanges: [] }]);
    await client.extensionEditorStateUpdate({ clientInstanceId: MOBILE_PRIMARY, path: mainPath,
      generation: 8, visibleRanges: [range] });
    assert.equal(calls.filter(call => call.method === "$acceptEditorPropertiesChanged").at(-1).args[0], b);

    const count = calls.filter(call => call.method === "$acceptEditorPropertiesChanged").length;
    for (const invalid of [
      { visibleRanges: [{ ...range, startColumn: 0 }] },
      { visibleRanges: [{ ...range, endLineNumber: 0 }], selections: [selection] },
      { selections: [] }, { selections: [selection, null] },
      { visibleRanges: Array(1025).fill(range) }, { visibleRanges: "bad" },
      { options: { ...options, cursorStyle: 7 } },
      { options: { ...options, tabSize: NaN } }, { options: { ...options, insertSpaces: 1 } },
    ]) {
      await assert.rejects(client.extensionEditorStateUpdate({ ...request, ...invalid }));
    }
    assert.equal(calls.filter(call => call.method === "$acceptEditorPropertiesChanged").length, count);
    assert.equal((await client.extensionEditorStateUpdate({ ...request, generation: 6, visibleRanges: [range] })).ok, false);
    assert.equal((await client.extensionEditorStateUpdate({ ...request, path: painPath, visibleRanges: [range] })).ok, false);
    assert.equal((await client.extensionEditorStateUpdate({ ...request, clientInstanceId: ELECTRON_SECONDARY, visibleRanges: [range] })).ok, false);
    assert.equal(calls.filter(call => call.method === "$acceptEditorPropertiesChanged").length, count);

    // Older selection-only publishers still work through the same entrypoint.
    await client.extensionEditorStateUpdate({ ...request, selection, source: "keyboard" });
    assert.deepEqual(calls.filter(call => call.method === "$acceptEditorPropertiesChanged").at(-1).args[1],
      { selections: { selections: [selection], source: "keyboard" }, options: null, visibleRanges: null });
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createHarness() {
  const scratchRoot = process.env.TEMPDIR
    ?? process.env.TMPDIR
    ?? path.resolve(".codex-scratch");
  await fs.mkdir(scratchRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratchRoot, "te2-wba-clients-"));
  const mainPath = path.join(root, "main.py");
  const painPath = path.join(root, "pain.py");
  await Promise.all([
    fs.writeFile(mainPath, "value = 1\n", "utf8"),
    fs.writeFile(painPath, "value = 2\n", "utf8"),
  ]);
  const client = new WorkbenchClient({
    extensionStoragePath: path.join(root, "extension-storage"),
    webviewReconstructionStoragePath: path.join(root, "webview-storage"),
  });
  client.ensureConnected = () => {};
  client.ext = { protocol: {} };
  client.activateLanguage = async () => ({ ok: true });
  const calls = [];
  client._sendExt = (rpcId, method, args) => {
    calls.push({ rpcId, method, args });
    return calls.length;
  };
  client._sendExtAwaitTerminalReply = () => ({
    req: calls.length + 1,
    promise: Promise.resolve({ type: 9, result: null }),
  });
  client.state.workspaceFolder = root;
  client._useRemote = false;
  client._authority = "";
  client._documentRegistry.initializeDocuments({
    projectPath: root, projectGeneration: 1, openStateRevision: 1,
    documents: [[mainPath, "value = 1\n"], [painPath, "value = 2\n"]].map(([path, text]) => {
      const sha = createHash("sha256").update(text).digest("hex");
      return { path, text, contentSha256: sha, contentIdentity: `sha256:${sha}`, baseSha256: null, dirty: false };
    }),
  });
  return { client, calls, root, mainPath, painPath };
}

function facadeByClient(client) {
  return new Map(
    client.status().clientEditorFacades.map((facade) => [
      facade.clientInstanceId,
      facade,
    ]),
  );
}

async function open(
  client,
  clientInstanceId,
  filePath,
  requestId,
  generation = 1,
) {
  return client.openFile({
    clientInstanceId,
    path: filePath,
    languageId: "python",
    generation,
    requestId,
  });
}

test("same URI retains one document and one editor facade per stable client", async () => {
  const { client, root, mainPath, painPath } = await createHarness();
  try {
    await open(client, ELECTRON_PRIMARY, mainPath, "open_electron_primary");
    await open(client, ELECTRON_SECONDARY, mainPath, "open_electron_secondary");
    await open(client, MOBILE_PRIMARY, mainPath, "open_mobile_primary");
    await open(client, MOBILE_SECONDARY, painPath, "open_mobile_secondary");

    const initial = facadeByClient(client);
    assert.equal(initial.size, 4);
    assert.equal(initial.get(ELECTRON_PRIMARY).path, mainPath);
    assert.equal(initial.get(ELECTRON_SECONDARY).path, mainPath);
    assert.equal(initial.get(MOBILE_PRIMARY).path, mainPath);
    assert.equal(initial.get(MOBILE_SECONDARY).path, painPath);
    assert.equal(new Set([
      initial.get(ELECTRON_PRIMARY).editorId,
      initial.get(ELECTRON_SECONDARY).editorId,
      initial.get(MOBILE_PRIMARY).editorId,
    ]).size, 3);
    assert.equal(client._documentRegistry.values().length, 2);

    await open(client, ELECTRON_PRIMARY, painPath, "switch_electron_primary");
    const switched = facadeByClient(client);
    assert.equal(switched.get(ELECTRON_PRIMARY).path, painPath);
    assert.equal(switched.get(ELECTRON_SECONDARY).path, mainPath);
    assert.equal(switched.get(MOBILE_PRIMARY).path, mainPath);
    assert.equal(switched.get(MOBILE_SECONDARY).path, painPath);
    assert.equal(
      switched.get(ELECTRON_SECONDARY).editorId,
      initial.get(ELECTRON_SECONDARY).editorId,
    );
    assert.equal(
      switched.get(MOBILE_PRIMARY).editorId,
      initial.get(MOBILE_PRIMARY).editorId,
    );
    assert.equal(
      switched.get(MOBILE_SECONDARY).editorId,
      initial.get(MOBILE_SECONDARY).editorId,
    );

    const reconciled = client.reconcileLogicalDocuments({
      projectPath: root,
      projectGeneration: 1,
      openStateRevision: 1,
      activePath: null,
      background: [],
    });
    assert.equal(reconciled.ok, true);
    assert.deepEqual(reconciled.released, []);
    assert.equal(client._documentRegistry.values().length, 2);
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resync replays the latest bounded diagnostics snapshot to late clients", async () => {
  const { client, root, mainPath } = await createHarness();
  try {
    const events = [];
    client.onEvent = (event) => events.push(event);
    const resource = {
      scheme: "vscode-remote",
      authority: "localhost",
      path: mainPath,
    };
    const marker = {
      message: 'Import "fastapi" could not be resolved',
      severity: 8,
      startLineNumber: 1,
      startColumn: 8,
      endLineNumber: 1,
      endColumn: 15,
    };

    client._handleWorkbenchEvent({
      type: "diagnostics/changeMany",
      ts_ms: Date.now(),
      args: ["basedpyright", [[resource, [marker]]]],
    });
    events.length = 0;

    const result = client.resync();
    const diagnosticEvents = events.filter(
      (event) => event.type === "diagnostics/changeMany",
    );
    assert.equal(diagnosticEvents.length, 1);
    assert.equal(diagnosticEvents[0].resync, true);
    assert.equal(diagnosticEvents[0].args[0], "basedpyright");
    assert.equal(diagnosticEvents[0].args[1][0][1][0].message, marker.message);
    assert.equal(result.diagnostics.owners, 1);
    assert.equal(result.diagnostics.resources, 1);
    assert.ok(result.diagnostics.bytes > 0);

    client._handleWorkbenchEvent({
      type: "diagnostics/changeMany",
      ts_ms: Date.now(),
      args: ["basedpyright", [[resource, []]]],
    });
    events.length = 0;
    const cleared = client.resync();
    assert.equal(
      events.filter((event) => event.type === "diagnostics/changeMany").length,
      0,
    );
    assert.deepEqual(cleared.diagnostics, { owners: 0, resources: 0, bytes: 0 });
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reopen replays each client facade without sharing its generation", async () => {
  const { client, calls, root, mainPath, painPath } = await createHarness();
  try {
    await open(client, ELECTRON_PRIMARY, mainPath, "a_main_11", 11);
    await open(client, ELECTRON_SECONDARY, mainPath, "b_main_2", 2);
    await open(client, ELECTRON_PRIMARY, painPath, "a_pain_12", 12);
    await open(client, ELECTRON_PRIMARY, mainPath, "a_main_13", 13);

    const facades = facadeByClient(client);
    assert.equal(facades.get(ELECTRON_PRIMARY).path, mainPath);
    assert.equal(facades.get(ELECTRON_PRIMARY).generation, 13);
    assert.equal(facades.get(ELECTRON_SECONDARY).path, mainPath);
    assert.equal(facades.get(ELECTRON_SECONDARY).generation, 2);
    assert.equal(client._documentRegistry.values().length, 2);

    const mainDocumentAdds = calls.filter((call) => {
      if (call.method !== "$acceptDocumentsAndEditorsDelta") return false;
      const added = call.args?.[0]?.addedDocuments;
      return Array.isArray(added)
        && added.some((document) => document?.uri?.fsPath === mainPath);
    });
    assert.equal(mainDocumentAdds.length, 1);

    const projectedSecondary = await client.runClientDocumentOperation(
      { clientInstanceId: ELECTRON_SECONDARY },
      "test:secondary-provider",
      () => ({
        path: client.state.activePath,
        generation: client._activeGeneration,
      }),
    );
    assert.deepEqual(projectedSecondary, { path: mainPath, generation: 2 });

    const secondaryChange = await client.didChange({
      clientInstanceId: ELECTRON_SECONDARY,
      path: mainPath,
      languageId: "python",
      generation: 2,
      text: "value = 3\n",
    });
    assert.equal(secondaryChange.ok, true);

    const projectedPrimary = await client.runClientDocumentOperation(
      { clientInstanceId: ELECTRON_PRIMARY },
      "test:primary-provider",
      () => ({
        path: client.state.activePath,
        generation: client._activeGeneration,
      }),
    );
    assert.deepEqual(projectedPrimary, { path: mainPath, generation: 13 });

    const primarySync = await client.didChange({
      clientInstanceId: ELECTRON_PRIMARY,
      path: mainPath,
      languageId: "python",
      generation: 13,
      text: "value = 3\n",
    });
    assert.equal(primarySync.ok, true);
    assert.equal(primarySync.contentChanged, false);
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("projection trace correlates the requested client with the projected facade", async () => {
  const { client, root, mainPath } = await createHarness();
  try {
    client.projectionTraceConfigure({ enabled: true, clear: true });
    await open(client, ELECTRON_PRIMARY, mainPath, "trace_primary", 17);
    await open(client, ELECTRON_SECONDARY, mainPath, "trace_secondary", 4);

    await client.runClientDocumentOperation(
      {
        clientInstanceId: ELECTRON_PRIMARY,
        path: mainPath,
        generation: 17,
      },
      "trace:hover",
      () => null,
    );

    const snapshot = client.projectionTraceSnapshot({ limit: 256 });
    const projected = snapshot.events.find((event) =>
      event.phase === "projected" && event.label === "trace:hover");
    assert.ok(projected);
    assert.equal(projected.requestClientInstanceId, ELECTRON_PRIMARY);
    assert.equal(projected.requestPath, mainPath);
    assert.equal(projected.requestGeneration, 17);
    assert.equal(projected.projectedClientInstanceId, ELECTRON_PRIMARY);
    assert.equal(projected.activePath, mainPath);
    assert.equal(projected.activeGeneration, 17);
    assert.equal(projected.facade.generation, 17);
    assert.equal(projected.document.path, mainPath);
    assert.equal(typeof projected.document.textFingerprint, "string");

    const beforeDisable = snapshot.sequence;
    client.projectionTraceConfigure({ enabled: false });
    await client.runClientDocumentOperation(
      { clientInstanceId: ELECTRON_SECONDARY, path: mainPath, generation: 4 },
      "trace:disabled",
      () => null,
    );
    assert.equal(client.projectionTraceSnapshot().sequence, beforeDisable);
  } finally {
    client._resetSessionCaches("test_cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});
