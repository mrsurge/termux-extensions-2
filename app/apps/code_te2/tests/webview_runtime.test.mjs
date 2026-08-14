import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Window } from "happy-dom";

import { WebviewRuntime } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/webview-runtime.mjs";
import {
  decodeWbaRpcMessage,
  encodeWbaRpcMessage,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/messagepack-codec.mjs";
import {
  decodeExtHostRpc,
  encodeExtRequestMixedArgs,
  serializableBuffersArgument,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/wire-encoding.mjs";

const RPC = {
  MainThreadWebviews: 44,
  MainThreadWebviewPanels: 45,
  MainThreadWebviewViews: 46,
  ExtHostWebviews: 120,
  ExtHostWebviewPanels: 121,
  ExtHostWebviewViews: 123,
};

async function reconstructionStorage(t) {
  const base =
    process.env.TEMPDIR ||
    process.env.TMPDIR ||
    path.join(process.cwd(), ".scratch");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "te2-webview-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function waitFor(predicate, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function wrapperModuleSource(wrapper) {
  const match = /<script type="module">\s*([\s\S]*?)<\/script>\s*<\/body>/.exec(
    wrapper,
  );
  assert.ok(match, "wrapper module script must be present");
  return match[1].replace(
    /^import \{encodeWbaRpcMessage,decodeWbaRpcMessage\} from '[^']+';\s*/,
    "const {encodeWbaRpcMessage,decodeWbaRpcMessage}=globalThis.__te2WbaCodec;\n",
  );
}

test("mixed extension-host request uses the Code OSS one-byte argument count", () => {
  const encoded = encodeExtRequestMixedArgs({
    req: 7,
    rpcId: RPC.ExtHostWebviews,
    method: "$onMessage",
    args: [
      "handle",
      '{"value":true}',
      serializableBuffersArgument([{ $$ref$$: 0 }], [new Uint8Array([1, 2])]),
    ],
  });
  const decoded = decodeExtHostRpc(encoded, {
    shouldParseArgsForMethod: () => true,
  });
  assert.equal(decoded.method, "$onMessage");
  assert.equal(decoded.args.length, 3);
  assert.equal(decoded.args[0], "handle");
  assert.deepEqual(decoded.args[2], [{ $$ref$$: 0 }]);
});

test("activity-bar webview contribution resolves through one workspace surface", async (t) => {
  const projectPath = process.cwd();
  const lifecycle = [];
  const notifications = [];
  const extSends = [];
  let runtime;

  runtime = new WebviewRuntime({
    reconstructionStoragePath: await reconstructionStorage(t),
    rpcIds: RPC,
    getWorkspaceFolder: () => projectPath,
    getExtensions: () => [
      {
        id: "example.webview",
        extensionLocation: {
          scheme: "vscode-remote",
          authority: "localhost",
          path: projectPath,
        },
        contributes: {
          viewsContainers: {
            activitybar: [
              { id: "exampleContainer", title: "Example", icon: "./icon.svg" },
            ],
          },
          views: {
            exampleContainer: [
              { id: "example.view", name: "Example View", type: "webview" },
            ],
          },
        },
      },
    ],
    activateByEvent: async (event) => {
      assert.equal(event, "onView:example.view");
      const result = runtime.handleMainThreadRequest({
        kind: "ext",
        type: 1,
        req: 1,
        rpcId: RPC.MainThreadWebviewViews,
        method: "$registerWebviewViewProvider",
        args: [
          {
            id: { value: "example.webview" },
            location: {
              scheme: "vscode-remote",
              authority: "localhost",
              path: projectPath,
            },
          },
          "example.view",
          {
            retainContextWhenHidden: true,
            serializeBuffersForPostMessage: true,
          },
        ],
      });
      assert.equal(result.handled, true);
    },
    sendExtAwaitTerminalReply: (rpcId, method, args, cancellable) => {
      extSends.push({ rpcId, method, args, cancellable });
      queueMicrotask(() => {
        const [handle] = args;
        runtime.handleMainThreadRequest({
          kind: "ext",
          type: 1,
          req: 2,
          rpcId: RPC.MainThreadWebviews,
          method: "$setOptions",
          args: [
            handle,
            {
              enableScripts: true,
              localResourceRoots: [
                {
                  scheme: "vscode-remote",
                  authority: "localhost",
                  path: projectPath,
                },
              ],
            },
          ],
        });
        runtime.handleMainThreadRequest({
          kind: "ext",
          type: 1,
          req: 3,
          rpcId: RPC.MainThreadWebviews,
          method: "$setHtml",
          args: [
            handle,
            `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.vscode-cdn.net"><base href="https://vscode-remote%2Blocalhost.vscode-resource.vscode-cdn.net${projectPath}/"></head><body><img src="https://vscode-remote%2Blocalhost.vscode-resource.vscode-cdn.net${projectPath}/icon.svg?revision=2#mark"><img src="https://vscode-remote+remote-002bauthority.vscode-resource.vscode-cdn.net${projectPath}/remote.svg"><script src="index.js"></script></body></html>`,
          ],
        });
      });
      return { req: 10, promise: Promise.resolve({ type: 7 }) };
    },
    sendExt: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable });
      return extSends.length;
    },
    sendExtMixed: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable, mixed: true });
      return extSends.length;
    },
    onLifecycleEvent: (event) => lifecycle.push(event),
    onClientNotification: (method, params) =>
      notifications.push({ method, params }),
    log: () => {},
  });

  await runtime.activatePrimaryViews();
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.surfaces.length, 1);
  const surface = snapshot.surfaces[0];
  assert.equal(surface.projectPath, projectPath);
  assert.equal(surface.extensionId, "example.webview");
  assert.equal(surface.viewId, "example.view");
  assert.equal(surface.surfaceKind, "view");
  assert.match(surface.iconUrl, /icon\.svg$/);
  assert.equal(surface.serializeBuffersForPostMessage, true);
  assert.match(surface.url, /^\/api\/app\/code_te2\/services\/wba\/webview\//);

  const resolve = extSends.find(
    (entry) => entry.method === "$resolveWebviewView",
  );
  assert.equal(resolve.rpcId, RPC.ExtHostWebviewViews);
  assert.equal(resolve.cancellable, true);
  assert.equal(resolve.args.length, 4);

  const attached = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_browseridentity0001",
    windowId: "window_browseridentity0001",
    presentationId: "presentation_inline0001",
  });
  assert.equal(attached.htmlRevision, 2);
  const wrapper = runtime.wrapper(surface.surfaceId);
  assert.match(wrapper, /msgpack-v1/);
  assert.match(wrapper, /src="\.\/runtime\/socket\.io\.min\.js"/);
  assert.doesNotMatch(wrapper, /\/static\/vendor\/socket\.io\.min\.js/);
  assert.match(wrapper, /from '\.\/runtime\/messagepack-codec\.mjs'/);
  assert.doesNotMatch(wrapper, /from '\.\.\/runtime\/messagepack-codec\.mjs'/);
  assert.match(wrapper, /frame\.src=documentUrl\.href/);
  assert.doesNotMatch(wrapper, /frame\.srcdoc/);
  assert.match(wrapper, /resourceOrigin/);
  assert.match(wrapper, /#te2-status\[hidden\]\{display:none\}/);
  assert.match(wrapper, /background:#010409/);
  assert.match(wrapper, /te2\.extension-webview\.window\.v1/);
  assert.match(wrapper, /clientInstanceId=requiredIdentity/);
  assert.match(wrapper, /presentationId=requiredIdentity/);
  assert.match(wrapper, /bootstrapToken/);
  assert.match(wrapper, /socket\.emit\('rpc'/);
  assert.doesNotMatch(wrapper, /socket\.volatile\.emit/);
  assert.match(wrapper, /window\.location\.origin/);
  const document = runtime.document(
    surface.surfaceId,
    "http://127.0.0.1:8089",
    attached.bootstrapToken,
  );
  assert.match(document, /acquireVsCodeApi/);
  assert.match(document, /createStorage/);
  assert.match(document, /Object\.defineProperty\(window,'localStorage'/);
  assert.match(document, /Object\.defineProperty\(window,'sessionStorage'/);
  assert.match(document, /data-te2-webview-theme/);
  assert.match(document, /--vscode-sideBar-background:#010409/);
  assert.match(document, /--vscode-editor-foreground:#e6edf3/);
  assert.match(document, /class="vscode-dark"/);
  assert.match(document, /data-vscode-theme-kind="vscode-dark"/);
  assert.match(document, /data-vscode-theme-name="GitHub Dark Default"/);
  assert.match(document, /data-vscode-theme-id="github-dark-default"/);
  assert.match(document, /origin:window\.location\.origin/);
  assert.match(document, /source:window/);
  assert.match(
    document,
    /\/services\/wba\/webview\/vsix%3A.*\/resource\/vscode-remote\/localhost/,
  );
  assert.match(document, /\/resource\/vscode-remote\/remote%2Bauthority/);
  assert.doesNotMatch(document, /__TE2_WEBVIEW_RESOURCE_ORIGIN__/);
  assert.match(document, /http:\/\/127\.0\.0\.1:8089/);
  assert.doesNotMatch(document, /icon\.svg%3Frevision/);
  assert.doesNotMatch(document, /https:\/\/\*\.vscode-cdn\.net/);
  assert.throws(
    () =>
      runtime.document(
        surface.surfaceId,
        "http://127.0.0.1:8089",
        attached.bootstrapToken,
      ),
    /bootstrap token is invalid or expired/,
  );

  const firstWrite = await runtime.setBrowserState({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_browseridentity0001",
    writerLease: attached.reconstruction.writerLease,
    revision: attached.reconstruction.revision + 1,
    vscodeState: { conversation: "thread-7" },
    localStorage: [["draft", "saved"]],
  });
  assert.equal(firstWrite.accepted, true);
  const reattached = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_browseridentity0001",
    windowId: "window_detachedidentity01",
    presentationId: "presentation_detached01",
  });
  assert.deepEqual(reattached.reconstruction.vscodeState, {
    conversation: "thread-7",
  });
  assert.deepEqual(reattached.reconstruction.localStorage, [
    ["draft", "saved"],
  ]);
  assert.notEqual(
    reattached.reconstruction.writerLease,
    attached.reconstruction.writerLease,
  );
  const staleWrite = await runtime.setBrowserState({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_browseridentity0001",
    writerLease: attached.reconstruction.writerLease,
    revision: reattached.reconstruction.revision + 1,
    vscodeState: { conversation: "stale" },
    localStorage: [],
  });
  assert.equal(staleWrite.accepted, false);
  const independentClient = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_independent000001",
    windowId: "window_independent000001",
    presentationId: "presentation_independent1",
  });
  assert.equal(independentClient.reconstruction.vscodeState, null);
  assert.deepEqual(independentClient.reconstruction.localStorage, []);
  const restoredDocument = runtime.document(
    surface.surfaceId,
    "http://127.0.0.1:8089",
    reattached.bootstrapToken,
  );
  assert.match(restoredDocument, /let apiState=\{"conversation":"thread-7"\}/);
  assert.match(
    restoredDocument,
    /createStorage\(true,\[\["draft","saved"\]\]\)/,
  );
  await runtime.resetClientState({
    clientInstanceId: "client_browseridentity0001",
  });
  const resetAttachment = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_browseridentity0001",
    windowId: "window_browseridentity0001",
    presentationId: "presentation_inline0002",
  });
  assert.equal(resetAttachment.reconstruction.revision, 0);
  assert.equal(resetAttachment.reconstruction.vscodeState, null);
  assert.deepEqual(resetAttachment.reconstruction.localStorage, []);

  const resource = await runtime.resource(
    surface.surfaceId,
    "vscode-remote",
    "localhost",
    path.join(projectPath, "package.json").replace(/^\//, ""),
  );
  assert.equal(resource.contentType, "application/json; charset=utf-8");
  assert.ok(resource.body.byteLength > 0);

  runtime.receiveBrowserMessage({
    surfaceId: surface.surfaceId,
    jsonMessage: '{"hello":"world"}',
    buffers: [new Uint8Array([1, 2, 3])],
  });
  const browserMessage = extSends.at(-1);
  assert.equal(browserMessage.rpcId, RPC.ExtHostWebviews);
  assert.equal(browserMessage.method, "$onMessage");
  assert.equal(browserMessage.mixed, true);

  const handle = resolve.args[0];
  const postResult = runtime.handleMainThreadRequest({
    kind: "ext",
    type: 3,
    req: 4,
    rpcId: RPC.MainThreadWebviews,
    method: "$postMessage",
    args: [handle, '{"ok":true}', new Uint8Array([9])],
  });
  assert.deepEqual(postResult, { handled: true, replyResult: true });
  assert.equal(notifications.at(-1).params.event, "message");
  assert.ok(lifecycle.some((event) => event.type === "webview/snapshot"));
});

test("wrapper preserves its live document across transport resume and reloads only at boundaries", async (t) => {
  const projectPath = process.cwd();
  const attachRequests = [];
  const attachResults = [];
  const browserRpcRequests = [];
  const stateWrites = [];
  const heldMethods = new Set();
  let socket = null;
  const runtime = new WebviewRuntime({
    reconstructionStoragePath: await reconstructionStorage(t),
    rpcIds: RPC,
    getWorkspaceFolder: () => projectPath,
    getExtensions: () => [],
    activateByEvent: async () => undefined,
    sendExtAwaitTerminalReply: () => ({
      req: 1,
      promise: Promise.resolve({ type: 7 }),
    }),
    sendExt: () => 1,
    sendExtMixed: () => 1,
    onLifecycleEvent: () => {},
    onClientNotification: (method, params) => {
      if (!socket?.connected) return;
      queueMicrotask(() =>
        socket.trigger(
          "rpc",
          encodeWbaRpcMessage({
            jsonrpc: "2.0",
            method,
            params,
          }),
        ),
      );
    },
    log: () => {},
  });

  assert.deepEqual(
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 1,
      req: 1,
      rpcId: RPC.MainThreadWebviewPanels,
      method: "$createWebviewPanel",
      args: [
        {
          id: { value: "example.resume" },
          location: {
            scheme: "vscode-remote",
            authority: "localhost",
            path: projectPath,
          },
        },
        "resume-panel-handle",
        "example.resume",
        {
          title: "Resume Test",
          panelOptions: { retainContextWhenHidden: true },
          webviewOptions: { enableScripts: true },
          serializeBuffersForPostMessage: false,
        },
        { viewColumn: 0 },
      ],
    }),
    { handled: true },
  );
  assert.deepEqual(
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 1,
      req: 2,
      rpcId: RPC.MainThreadWebviews,
      method: "$setHtml",
      args: [
        "resume-panel-handle",
        "<!doctype html><html><body>first</body></html>",
      ],
    }),
    { handled: true },
  );

  const surface = runtime.snapshot().surfaces[0];
  const window = new Window({
    url: `http://127.0.0.1:8089${surface.url}?clientInstanceId=client_resumeidentity0001&windowId=window_resumeidentity0001&presentationId=presentation_resume0001`,
  });
  t.after(() => window.close());
  window.document.body.innerHTML = [
    '<div id="te2-status">Loading extension view…</div>',
    '<iframe id="te2-webview" title="Extension view" hidden></iframe>',
  ].join("");

  const handlers = new Map();
  socket = {
    connected: false,
    sendBuffer: [],
    emit(event, payload) {
      assert.equal(event, "rpc");
      const request = decodeWbaRpcMessage(payload);
      browserRpcRequests.push(structuredClone(request));
      if (heldMethods.has(request.method)) return;
      queueMicrotask(async () => {
        try {
          let result;
          if (request.method === "vscode.webview.attach") {
            attachRequests.push(structuredClone(request.params));
            result = await runtime.attach(request.params);
            attachResults.push(structuredClone(result));
          } else if (request.method === "vscode.webview.state") {
            stateWrites.push(structuredClone(request.params));
            result = await runtime.setBrowserState(request.params);
          } else if (request.method === "vscode.webview.message") {
            result = runtime.receiveBrowserMessage(request.params);
          } else {
            throw new Error(`unexpected wrapper RPC: ${request.method}`);
          }
          socket.trigger(
            "rpc",
            encodeWbaRpcMessage({
              jsonrpc: "2.0",
              id: request.id,
              result,
            }),
          );
        } catch (error) {
          socket.trigger(
            "rpc",
            encodeWbaRpcMessage({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32000, message: error.message },
            }),
          );
        }
      });
    },
    on(event, handler) {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler);
      handlers.set(event, listeners);
      return this;
    },
    trigger(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
  window.io = () => socket;
  window.__te2WbaCodec = { encodeWbaRpcMessage, decodeWbaRpcMessage };
  window.eval(wrapperModuleSource(runtime.wrapper(surface.surfaceId)));

  const frame = window.document.getElementById("te2-webview");
  socket.connected = true;
  socket.trigger("connect");
  await waitFor(
    () => attachResults.length === 1 && frame.src.includes("/document?"),
    "initial wrapper attachment did not load its extension document",
  );
  const initialDocumentUrl = frame.src;
  const initialFrameWindow = frame.contentWindow;
  initialFrameWindow.__te2LiveDomSentinel = { preserved: true };
  const deliveredToDocument = [];
  initialFrameWindow.postMessage = (message) =>
    deliveredToDocument.push(message);
  assert.equal(attachResults[0].action, "reload");
  assert.equal(attachResults[0].reason, "initial_attach");
  assert.ok(attachResults[0].bootstrapToken);
  assert.equal(attachRequests[0].serverEpoch, undefined);

  const dispatchFrameMessage = (kind, value) => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: frame.contentWindow,
        data: { __te2ExtensionWebview: true, kind, value },
      }),
    );
  };
  dispatchFrameMessage("ready", null);
  heldMethods.add("vscode.webview.message");
  dispatchFrameMessage("message", { interactive: "do-not-replay" });
  await waitFor(
    () =>
      browserRpcRequests.filter(
        (request) => request.method === "vscode.webview.message",
      ).length === 1,
    "interactive browser message did not enter the pending RPC set",
  );

  socket.connected = false;
  socket.trigger("disconnect");
  assert.equal(frame.src, initialDocumentUrl);
  assert.equal(frame.isConnected, true);
  dispatchFrameMessage("state", { offlineDraft: "retained" });
  dispatchFrameMessage("storage", [["offline-key", "offline-value"]]);
  assert.deepEqual(
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 3,
      req: 3,
      rpcId: RPC.MainThreadWebviews,
      method: "$postMessage",
      args: ["resume-panel-handle", '{"replayed":true}'],
    }),
    { handled: true, replyResult: true },
  );

  socket.connected = true;
  socket.trigger("connect");
  await waitFor(
    () => attachResults.length === 2,
    "wrapper did not reconcile after reconnect",
  );
  assert.equal(attachResults[1].action, "replay");
  assert.equal(attachResults[1].reason, "event_replay");
  assert.equal(attachResults[1].replayEvents.length, 1);
  assert.equal(attachResults[1].replayEvents[0].event, "message");
  assert.equal(attachResults[1].bootstrapToken, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(deliveredToDocument)), [
    {
      __te2ExtensionWebviewHost: true,
      kind: "message",
      value: { replayed: true },
    },
  ]);
  assert.equal(frame.src, initialDocumentUrl);
  assert.equal(window.document.getElementById("te2-webview"), frame);
  assert.equal(frame.contentWindow, initialFrameWindow);
  assert.deepEqual(frame.contentWindow.__te2LiveDomSentinel, {
    preserved: true,
  });
  await waitFor(
    () => stateWrites.length === 1,
    "coalesced offline reconstruction state did not flush after reconnect",
  );
  assert.deepEqual(stateWrites[0].vscodeState, { offlineDraft: "retained" });
  assert.deepEqual(stateWrites[0].localStorage, [
    ["offline-key", "offline-value"],
  ]);
  assert.equal(
    stateWrites[0].writerLease,
    attachResults[1].reconstruction.writerLease,
  );
  assert.notEqual(
    attachResults[1].reconstruction.writerLease,
    attachResults[0].reconstruction.writerLease,
  );
  assert.equal(
    browserRpcRequests.filter(
      (request) => request.method === "vscode.webview.message",
    ).length,
    1,
  );
  const staleWriter = await runtime.setBrowserState({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_resumeidentity0001",
    writerLease: attachResults[0].reconstruction.writerLease,
    revision: stateWrites[0].revision + 1,
    vscodeState: { stale: true },
    localStorage: [],
  });
  assert.equal(staleWriter.accepted, false);
  heldMethods.delete("vscode.webview.message");

  socket.connected = false;
  socket.trigger("disconnect");
  socket.connected = true;
  socket.trigger("connect");
  await waitFor(
    () => attachResults.length === 3,
    "wrapper did not perform a current resume",
  );
  assert.equal(attachResults[2].action, "resume");
  assert.equal(attachResults[2].reason, "current");
  assert.equal(attachResults[2].bootstrapToken, undefined);
  assert.equal(frame.src, initialDocumentUrl);

  assert.deepEqual(
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 1,
      req: 4,
      rpcId: RPC.MainThreadWebviews,
      method: "$setHtml",
      args: [
        "resume-panel-handle",
        "<!doctype html><html><body>generating</body></html>",
      ],
    }),
    { handled: true },
  );
  assert.deepEqual(
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 1,
      req: 5,
      rpcId: RPC.MainThreadWebviews,
      method: "$setHtml",
      args: [
        "resume-panel-handle",
        "<!doctype html><html><body>second</body></html>",
      ],
    }),
    { handled: true },
  );
  await waitFor(
    () => attachResults.length === 4 && frame.src !== initialDocumentUrl,
    "authoritative HTML burst did not reload the final extension document",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    attachResults.length,
    4,
    "a stale buffered HTML revision started another attach",
  );
  const revisedDocumentUrl = frame.src;
  assert.equal(attachResults[3].action, "reload");
  assert.equal(attachResults[3].reason, "html_revision_changed");
  assert.equal(
    attachResults[3].htmlRevision,
    runtime.snapshot().surfaces[0].htmlRevision,
  );
  assert.ok(attachResults[3].bootstrapToken);
  assert.equal(window.document.getElementById("te2-status").hidden, true);

  socket.connected = false;
  socket.trigger("disconnect");
  for (let index = 0; index < 257; index += 1) {
    runtime.handleMainThreadRequest({
      kind: "ext",
      type: 3,
      req: 6 + index,
      rpcId: RPC.MainThreadWebviews,
      method: "$postMessage",
      args: ["resume-panel-handle", JSON.stringify({ index })],
    });
  }
  socket.connected = true;
  socket.trigger("connect");
  await waitFor(
    () => attachResults.length === 5 && frame.src !== revisedDocumentUrl,
    "event-journal gap did not force a document reload",
  );
  assert.equal(attachResults[4].action, "reload");
  assert.equal(attachResults[4].reason, "event_replay_gap");
  assert.ok(attachResults[4].bootstrapToken);

  const epochDecision = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_resumeidentity0001",
    windowId: "window_resumeidentity0001",
    presentationId: "presentation_resume0001",
    serverEpoch: "stale-wba-process-epoch",
    surfaceGeneration: attachResults[4].surfaceGeneration,
    loadedHtmlRevision: attachResults[4].htmlRevision,
    lastServerSequence: attachResults[4].eventSequence,
  });
  assert.equal(epochDecision.action, "reload");
  assert.equal(epochDecision.reason, "server_epoch_changed");
  assert.ok(epochDecision.bootstrapToken);

  assert.deepEqual(runtime.dispose({ surfaceId: surface.surfaceId }), {
    ok: true,
  });
  await waitFor(
    () => !frame.isConnected,
    "authoritative dispose did not remove the iframe",
  );
});

test("webview panel uses the shared secure surface and disposes through ExtHostWebviewPanels", async (t) => {
  const projectPath = process.cwd();
  const lifecycle = [];
  const notifications = [];
  const extSends = [];
  const runtime = new WebviewRuntime({
    reconstructionStoragePath: await reconstructionStorage(t),
    rpcIds: RPC,
    getWorkspaceFolder: () => projectPath,
    getExtensions: () => [],
    activateByEvent: async () => undefined,
    sendExtAwaitTerminalReply: () => ({
      req: 1,
      promise: Promise.resolve({ type: 7 }),
    }),
    sendExt: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable });
      return extSends.length;
    },
    sendExtMixed: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable, mixed: true });
      return extSends.length;
    },
    onLifecycleEvent: (event) => lifecycle.push(event),
    onClientNotification: (method, params) =>
      notifications.push({ method, params }),
    log: () => {},
  });

  const create = runtime.handleMainThreadRequest({
    kind: "ext",
    type: 1,
    req: 1,
    rpcId: RPC.MainThreadWebviewPanels,
    method: "$createWebviewPanel",
    args: [
      {
        id: { value: "AykutSarac.jsoncrack-vscode" },
        location: {
          scheme: "vscode-remote",
          authority: "localhost",
          path: projectPath,
        },
      },
      "panel-handle",
      "jsoncrack-vscode",
      {
        title: "JSON Crack",
        panelOptions: { retainContextWhenHidden: true },
        webviewOptions: { enableScripts: true },
        serializeBuffersForPostMessage: true,
      },
      { viewColumn: -2, preserveFocus: false },
    ],
  });
  assert.deepEqual(create, { handled: true });

  const html = runtime.handleMainThreadRequest({
    kind: "ext",
    type: 1,
    req: 2,
    rpcId: RPC.MainThreadWebviews,
    method: "$setHtml",
    args: [
      "panel-handle",
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self' https://*.vscode-cdn.net blob:; script-src 'unsafe-eval' 'unsafe-inline' https://*.vscode-cdn.net; worker-src https://*.vscode-cdn.net blob: data:"></head><body><div id="jsoncrack"></div></body></html>`,
    ],
  });
  assert.deepEqual(html, { handled: true });

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.surfaces.length, 1);
  const surface = snapshot.surfaces[0];
  assert.equal(surface.surfaceKind, "panel");
  assert.equal(surface.extensionId, "AykutSarac.jsoncrack-vscode");
  assert.equal(surface.title, "JSON Crack");
  assert.equal(surface.viewColumn, 0);
  assert.equal(surface.retainContextWhenHidden, true);
  const panelAttachment = await runtime.attach({
    surfaceId: surface.surfaceId,
    clientInstanceId: "client_panelidentity00001",
    windowId: "window_panelidentity00001",
    presentationId: "presentation_panel00001",
  });
  const panelDocument = runtime.document(
    surface.surfaceId,
    "http://127.0.0.1:8089",
    panelAttachment.bootstrapToken,
  );
  assert.match(panelDocument, /id="jsoncrack"/);
  assert.match(
    panelDocument,
    /script-src 'unsafe-eval' 'unsafe-inline' http:\/\/127\.0\.0\.1:8089/,
  );
  assert.match(
    panelDocument,
    /worker-src http:\/\/127\.0\.0\.1:8089 blob: data:/,
  );
  assert.doesNotMatch(panelDocument, /__TE2_WEBVIEW_RESOURCE_ORIGIN__/);

  const initialViewState = extSends.find(
    (entry) => entry.method === "$onDidChangeWebviewPanelViewStates",
  );
  assert.equal(initialViewState.args[0]["panel-handle"].position, 0);

  runtime.setVisibility({ surfaceId: surface.surfaceId, visible: false });
  const viewState = extSends.findLast(
    (entry) => entry.method === "$onDidChangeWebviewPanelViewStates",
  );
  assert.equal(viewState.rpcId, RPC.ExtHostWebviewPanels);
  assert.equal(viewState.args[0]["panel-handle"].visible, false);

  assert.deepEqual(runtime.dispose({ surfaceId: surface.surfaceId }), {
    ok: true,
  });
  assert.equal(runtime.snapshot().surfaces.length, 0);
  assert.equal(extSends.at(-1).rpcId, RPC.ExtHostWebviewPanels);
  assert.equal(extSends.at(-1).method, "$onDidDisposeWebviewPanel");
  assert.equal(notifications.at(-1).params.event, "dispose");
  assert.ok(lifecycle.some((event) => event.type === "webview/snapshot"));
});
