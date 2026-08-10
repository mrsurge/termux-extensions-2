import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { WebviewRuntime } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/webview-runtime.mjs';
import {
  decodeExtHostRpc,
  encodeExtRequestMixedArgs,
  serializableBuffersArgument,
} from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/wire-encoding.mjs';

const RPC = {
  MainThreadWebviews: 44,
  MainThreadWebviewPanels: 45,
  MainThreadWebviewViews: 46,
  ExtHostWebviews: 120,
  ExtHostWebviewPanels: 121,
  ExtHostWebviewViews: 123,
};

test('mixed extension-host request uses the Code OSS one-byte argument count', () => {
  const encoded = encodeExtRequestMixedArgs({
    req: 7,
    rpcId: RPC.ExtHostWebviews,
    method: '$onMessage',
    args: [
      'handle',
      '{"value":true}',
      serializableBuffersArgument([{"$$ref$$": 0}], [new Uint8Array([1, 2])]),
    ],
  });
  const decoded = decodeExtHostRpc(encoded, {
    shouldParseArgsForMethod: () => true,
  });
  assert.equal(decoded.method, '$onMessage');
  assert.equal(decoded.args.length, 3);
  assert.equal(decoded.args[0], 'handle');
  assert.deepEqual(decoded.args[2], [{"$$ref$$": 0}]);
});

test('activity-bar webview contribution resolves through one workspace surface', async () => {
  const projectPath = process.cwd();
  const lifecycle = [];
  const notifications = [];
  const extSends = [];
  let runtime;

  runtime = new WebviewRuntime({
    rpcIds: RPC,
    getWorkspaceFolder: () => projectPath,
    getExtensions: () => [{
      id: 'example.webview',
      extensionLocation: {
        scheme: 'vscode-remote',
        authority: 'localhost',
        path: projectPath,
      },
      contributes: {
        viewsContainers: {
          activitybar: [{ id: 'exampleContainer', title: 'Example', icon: './icon.svg' }],
        },
        views: {
          exampleContainer: [{ id: 'example.view', name: 'Example View', type: 'webview' }],
        },
      },
    }],
    activateByEvent: async (event) => {
      assert.equal(event, 'onView:example.view');
      const result = runtime.handleMainThreadRequest({
        kind: 'ext',
        type: 1,
        req: 1,
        rpcId: RPC.MainThreadWebviewViews,
        method: '$registerWebviewViewProvider',
        args: [
          {
            id: { value: 'example.webview' },
            location: {
              scheme: 'vscode-remote',
              authority: 'localhost',
              path: projectPath,
            },
          },
          'example.view',
          { retainContextWhenHidden: true, serializeBuffersForPostMessage: true },
        ],
      });
      assert.equal(result.handled, true);
    },
    sendExtAwaitTerminalReply: (rpcId, method, args, cancellable) => {
      extSends.push({ rpcId, method, args, cancellable });
      queueMicrotask(() => {
        const [handle] = args;
        runtime.handleMainThreadRequest({
          kind: 'ext',
          type: 1,
          req: 2,
          rpcId: RPC.MainThreadWebviews,
          method: '$setOptions',
          args: [handle, {
            enableScripts: true,
            localResourceRoots: [{
              scheme: 'vscode-remote',
              authority: 'localhost',
              path: projectPath,
            }],
          }],
        });
        runtime.handleMainThreadRequest({
          kind: 'ext',
          type: 1,
          req: 3,
          rpcId: RPC.MainThreadWebviews,
          method: '$setHtml',
          args: [handle, `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.vscode-cdn.net"><base href="https://vscode-remote%2Blocalhost.vscode-resource.vscode-cdn.net${projectPath}/"></head><body><img src="https://vscode-remote%2Blocalhost.vscode-resource.vscode-cdn.net${projectPath}/icon.svg?revision=2#mark"><img src="https://vscode-remote+remote-002bauthority.vscode-resource.vscode-cdn.net${projectPath}/remote.svg"><script src="index.js"></script></body></html>`],
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
    onClientNotification: (method, params) => notifications.push({ method, params }),
    log: () => {},
  });

  await runtime.activatePrimaryViews();
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.surfaces.length, 1);
  const surface = snapshot.surfaces[0];
  assert.equal(surface.projectPath, projectPath);
  assert.equal(surface.extensionId, 'example.webview');
  assert.equal(surface.viewId, 'example.view');
  assert.equal(surface.surfaceKind, 'view');
  assert.match(surface.iconUrl, /icon\.svg$/);
  assert.equal(surface.serializeBuffersForPostMessage, true);
  assert.match(surface.url, /^\/api\/app\/code_te2\/services\/wba\/webview\//);

  const resolve = extSends.find((entry) => entry.method === '$resolveWebviewView');
  assert.equal(resolve.rpcId, RPC.ExtHostWebviewViews);
  assert.equal(resolve.cancellable, true);
  assert.equal(resolve.args.length, 4);

  const attached = runtime.attach({ surfaceId: surface.surfaceId });
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
  assert.match(wrapper, /te2\.extension-webview\.storage\.v1/);
  assert.match(wrapper, /window\.location\.origin/);
  const document = runtime.document(surface.surfaceId, 'http://127.0.0.1:8089');
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
  assert.match(document, /\/services\/wba\/webview\/vsix%3A.*\/resource\/vscode-remote\/localhost/);
  assert.match(document, /\/resource\/vscode-remote\/remote%2Bauthority/);
  assert.doesNotMatch(document, /__TE2_WEBVIEW_RESOURCE_ORIGIN__/);
  assert.match(document, /http:\/\/127\.0\.0\.1:8089/);
  assert.doesNotMatch(document, /icon\.svg%3Frevision/);
  assert.doesNotMatch(document, /https:\/\/\*\.vscode-cdn\.net/);

  const resource = await runtime.resource(
    surface.surfaceId,
    'vscode-remote',
    'localhost',
    path.join(projectPath, 'package.json').replace(/^\//, ''),
  );
  assert.equal(resource.contentType, 'application/json; charset=utf-8');
  assert.ok(resource.body.byteLength > 0);

  runtime.receiveBrowserMessage({
    surfaceId: surface.surfaceId,
    jsonMessage: '{"hello":"world"}',
    buffers: [new Uint8Array([1, 2, 3])],
  });
  const browserMessage = extSends.at(-1);
  assert.equal(browserMessage.rpcId, RPC.ExtHostWebviews);
  assert.equal(browserMessage.method, '$onMessage');
  assert.equal(browserMessage.mixed, true);

  const handle = resolve.args[0];
  const postResult = runtime.handleMainThreadRequest({
    kind: 'ext',
    type: 3,
    req: 4,
    rpcId: RPC.MainThreadWebviews,
    method: '$postMessage',
    args: [handle, '{"ok":true}', new Uint8Array([9])],
  });
  assert.deepEqual(postResult, { handled: true, replyResult: true });
  assert.equal(notifications.at(-1).params.event, 'message');
  assert.ok(lifecycle.some((event) => event.type === 'webview/snapshot'));
});

test('webview panel uses the shared secure surface and disposes through ExtHostWebviewPanels', async () => {
  const projectPath = process.cwd();
  const lifecycle = [];
  const notifications = [];
  const extSends = [];
  const runtime = new WebviewRuntime({
    rpcIds: RPC,
    getWorkspaceFolder: () => projectPath,
    getExtensions: () => [],
    activateByEvent: async () => undefined,
    sendExtAwaitTerminalReply: () => ({ req: 1, promise: Promise.resolve({ type: 7 }) }),
    sendExt: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable });
      return extSends.length;
    },
    sendExtMixed: (rpcId, method, args, cancellable = false) => {
      extSends.push({ rpcId, method, args, cancellable, mixed: true });
      return extSends.length;
    },
    onLifecycleEvent: (event) => lifecycle.push(event),
    onClientNotification: (method, params) => notifications.push({ method, params }),
    log: () => {},
  });

  const create = runtime.handleMainThreadRequest({
    kind: 'ext',
    type: 1,
    req: 1,
    rpcId: RPC.MainThreadWebviewPanels,
    method: '$createWebviewPanel',
    args: [
      {
        id: { value: 'AykutSarac.jsoncrack-vscode' },
        location: {
          scheme: 'vscode-remote',
          authority: 'localhost',
          path: projectPath,
        },
      },
      'panel-handle',
      'jsoncrack-vscode',
      {
        title: 'JSON Crack',
        panelOptions: { retainContextWhenHidden: true },
        webviewOptions: { enableScripts: true },
        serializeBuffersForPostMessage: true,
      },
      { viewColumn: -2, preserveFocus: false },
    ],
  });
  assert.deepEqual(create, { handled: true });

  const html = runtime.handleMainThreadRequest({
    kind: 'ext',
    type: 1,
    req: 2,
    rpcId: RPC.MainThreadWebviews,
    method: '$setHtml',
    args: [
      'panel-handle',
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self' https://*.vscode-cdn.net blob:; script-src 'unsafe-eval' 'unsafe-inline' https://*.vscode-cdn.net; worker-src https://*.vscode-cdn.net blob: data:"></head><body><div id="jsoncrack"></div></body></html>`,
    ],
  });
  assert.deepEqual(html, { handled: true });

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.surfaces.length, 1);
  const surface = snapshot.surfaces[0];
  assert.equal(surface.surfaceKind, 'panel');
  assert.equal(surface.extensionId, 'AykutSarac.jsoncrack-vscode');
  assert.equal(surface.title, 'JSON Crack');
  assert.equal(surface.viewColumn, 0);
  assert.equal(surface.retainContextWhenHidden, true);
  const panelDocument = runtime.document(surface.surfaceId, 'http://127.0.0.1:8089');
  assert.match(panelDocument, /id="jsoncrack"/);
  assert.match(panelDocument, /script-src 'unsafe-eval' 'unsafe-inline' http:\/\/127\.0\.0\.1:8089/);
  assert.match(panelDocument, /worker-src http:\/\/127\.0\.0\.1:8089 blob: data:/);
  assert.doesNotMatch(panelDocument, /__TE2_WEBVIEW_RESOURCE_ORIGIN__/);

  const initialViewState = extSends.find(
    (entry) => entry.method === '$onDidChangeWebviewPanelViewStates',
  );
  assert.equal(initialViewState.args[0]['panel-handle'].position, 0);

  runtime.setVisibility({ surfaceId: surface.surfaceId, visible: false });
  const viewState = extSends.findLast((entry) => entry.method === '$onDidChangeWebviewPanelViewStates');
  assert.equal(viewState.rpcId, RPC.ExtHostWebviewPanels);
  assert.equal(viewState.args[0]['panel-handle'].visible, false);

  assert.deepEqual(runtime.dispose({ surfaceId: surface.surfaceId }), { ok: true });
  assert.equal(runtime.snapshot().surfaces.length, 0);
  assert.equal(extSends.at(-1).rpcId, RPC.ExtHostWebviewPanels);
  assert.equal(extSends.at(-1).method, '$onDidDisposeWebviewPanel');
  assert.equal(notifications.at(-1).params.event, 'dispose');
  assert.ok(lifecycle.some((event) => event.type === 'webview/snapshot'));
});
