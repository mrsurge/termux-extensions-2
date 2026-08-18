import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

class FakeSocket {
  connected = false;
  connectCalls = 0;
  rawEmits = [];
  volatileEmits = [];
  sendBuffer = [];
  handlers = new Map();
  ackResponse = null;

  volatile = {
    emit: (event, payload, ack) => {
      this.volatileEmits.push({ event, payload });
      if (ack && this.ackResponse) ack(this.ackResponse);
    },
  };

  emit(event, payload, ack) {
    this.rawEmits.push({ event, payload });
    if (ack && this.ackResponse) ack(this.ackResponse);
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  connect() {
    this.connectCalls += 1;
  }

  disconnect() {
    this.trigger('disconnect', 'client disconnect');
  }

  trigger(event, payload) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('all app-worker namespaces use one canonical path while WBA stays direct', async () => {
  const topology = await importTypeScript('src/rpc/socketio-topology.ts');
  const appPath = '/api/app/code_te2/socket.io';

  assert.equal(topology.SOCKET_IO_PATHS.editor, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.explorer, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.terminal, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.uiIpc, appPath);
  assert.equal(
    topology.SOCKET_IO_PATHS.wba,
    '/api/app/code_te2/services/wba/socket.io',
  );
  assert.equal(topology.SOCKET_IO_PATHS.te2Console, '/te2_console_ws/socket.io');
});

test('shared RPC transport delivers connected calls reliably without replaying reconnect-era work', async () => {
  const { createSocketIoJsonRpcClient } = await importTypeScript('src/rpc/transport.ts');
  const socket = new FakeSocket();
  socket.ackResponse = { jsonrpc: '2.0', id: 'ignored-by-client', result: { ok: true } };
  const client = createSocketIoJsonRpcClient({
    namespace: '/rpc/test',
    path: '/api/app/code_te2/socket.io',
    ensureSocketIoLoaded: async () => () => socket,
  });

  const initialRequest = client.request('initial.get', {});
  await settlePromises();
  assert.equal(socket.volatileEmits.length, 0);
  socket.trigger('connect');
  assert.deepEqual(await initialRequest, { ok: true });
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 0);

  socket.ackResponse = null;
  const inFlight = client.request('active.get', {}, 5000);
  assert.equal(socket.rawEmits.length, 2);
  socket.sendBuffer.push({ stale: true });
  socket.trigger('disconnect', 'transport close');
  await assert.rejects(inFlight, /RPC socket disconnected/);
  assert.equal(socket.sendBuffer.length, 0);

  client.notify('state.changed', {});
  await assert.rejects(client.request('reconnect.get', {}), /RPC socket disconnected/);
  assert.equal(socket.rawEmits.length, 2);
  assert.equal(socket.volatileEmits.length, 0);
  assert.equal(socket.connectCalls, 2);

  socket.trigger('connect');
  assert.equal(socket.rawEmits.length, 2);
  assert.equal(socket.volatileEmits.length, 0);
  client.notify('state.changed', {});
  assert.equal(socket.volatileEmits.length, 1);
});

test('Sidebar registration and presentation RPCs are reliable across reconnects', async () => {
  const { createUiIpcConnections } = await importTypeScript(
    'main_page/frontend/connections/ui-ipc.ts',
  );
  const previousWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent: () => true,
  };
  try {
    const socket = new FakeSocket();
    socket.ackResponse = {
      jsonrpc: '2.0',
      id: 'sidebar-ack',
      result: { ok: true },
    };
    let registered = 0;
    const connections = createUiIpcConnections({
      ensureSocketIoLoaded: async () => (_namespace, options) => {
        assert.equal(options.path, '/api/app/code_te2/socket.io');
        return socket;
      },
      initConsoleBridge: () => ({}),
      getClientId: () => 'client-a',
      onSidebarConnected: () => {
        registered += 1;
      },
    });

    connections.connectSidebarIPC();
    await settlePromises();
    socket.trigger('connect');
    connections.emitSidebarRpcRequest(
      'sidebar.window.presentation.update',
      { hostId: 'host-a', presentationId: 'frame-a' },
    );

    assert.equal(registered, 1);
    assert.deepEqual(
      socket.rawEmits.map((entry) => entry.payload.method),
      [
        'sidebar.register',
        'sidebar.windows.list',
        'sidebar.window.presentation.update',
      ],
    );
    assert.equal(socket.volatileEmits.length, 0);

    connections.emitSidebarRpcNotification('sidebar.cwd.set', { cwd: '/workspace' });
    assert.equal(socket.volatileEmits.length, 1);

    socket.trigger('disconnect', 'transport close');
    socket.trigger('connect');
    assert.equal(registered, 2);
    assert.deepEqual(
      socket.rawEmits.slice(-2).map((entry) => entry.payload.method),
      ['sidebar.register', 'sidebar.windows.list'],
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test('UI IPC requests host resync only after a genuine reconnect', async () => {
  const { createUiIpcConnections } = await importTypeScript(
    'main_page/frontend/connections/ui-ipc.ts',
  );
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { dispatchEvent: () => true };
  globalThis.document = { dispatchEvent: () => true };
  try {
    const socket = new FakeSocket();
    let resyncs = 0;
    const connections = createUiIpcConnections({
      ensureSocketIoLoaded: async () => () => socket,
      initConsoleBridge: () => ({}),
      getClientId: () => 'client-a',
      getConsoleWorkerId: () => 'main_page:test',
      onHostStateResync: () => {
        resyncs += 1;
      },
    });

    const connecting = connections.connectUIIPC();
    await settlePromises();
    socket.trigger('connect');
    await connecting;
    await settlePromises();
    assert.equal(resyncs, 0);

    socket.trigger('disconnect', 'transport close');
    socket.trigger('connect');
    await settlePromises();
    assert.equal(resyncs, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('WBA delivers connected calls reliably and never queues reconnect calls', async () => {
  const { createEditorWbaRpcTransport } = await importTypeScript(
    'monaco_editor/editor_wba_rpc_transport.ts',
  );
  const socket = new FakeSocket();
  const transport = createEditorWbaRpcTransport({
    getSocket: () => socket,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  transport.attachSocket(socket);

  const initialCall = transport.call('vscode.openFile', {}, { timeoutMs: 5000 });
  await settlePromises();
  assert.equal(socket.volatileEmits.length, 0);
  socket.trigger('connect');
  await settlePromises();
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 0);

  socket.sendBuffer.push({ stale: true });
  socket.trigger('disconnect', 'transport close');
  await assert.rejects(initialCall, /wba rpc socket disconnected/);
  assert.equal(socket.sendBuffer.length, 0);
  await assert.rejects(
    transport.call('vscode.hover', {}, { timeoutMs: 5000 }),
    /wba rpc socket disconnected/,
  );
  assert.equal(socket.rawEmits.length, 1);

  socket.trigger('connect');
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 0);
  assert.equal(transport.notify('vscode.didChange', {}), true);
  assert.equal(socket.volatileEmits.length, 1);
});

test('maps the editor definition action onto the WBA definition method', async () => {
  const { editorWorkbenchMethodToWbaMethod } = await importTypeScript(
    'monaco_editor/editor_wba_rpc_transport.ts',
  );
  assert.equal(
    editorWorkbenchMethodToWbaMethod('definition'),
    'vscode.definition',
  );
  assert.equal(editorWorkbenchMethodToWbaMethod('resync'), 'te2.resync');
});

test('editor RPC calls are reliable while notifications remain volatile', async () => {
  const { createEditorRpcTransport } = await importTypeScript(
    'monaco_editor/editor_rpc_transport.ts',
  );
  const socket = new FakeSocket();
  socket.connected = true;
  const transport = createEditorRpcTransport({
    getSocket: () => socket,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  transport.attachSocket(socket);

  const inFlight = transport.call('editor.agentEdits.documentState.get', {}, { timeoutMs: 5000 });
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 0);
  assert.equal(transport.notify('editor.modelReady.publish', {}), true);
  assert.equal(socket.volatileEmits.length, 1);

  socket.sendBuffer.push({ stale: true });
  socket.trigger('disconnect', 'transport close');
  await assert.rejects(inFlight, /editor rpc socket disconnected/);
  assert.equal(socket.sendBuffer.length, 0);

  socket.trigger('connect');
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 1);
});

test('required editor publications use request-response transport without volatile replay', async () => {
  const { createEditorRpcTransport } = await importTypeScript(
    'monaco_editor/editor_rpc_transport.ts',
  );
  const socket = new FakeSocket();
  socket.connected = true;
  const publishErrors = [];
  const transport = createEditorRpcTransport({
    getSocket: () => socket,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    onReliablePublishError: (method, error) => {
      publishErrors.push({ method, error });
    },
  });
  transport.attachSocket(socket);

  assert.equal(
    transport.publishReliable(
      'editor.openComplete.publish',
      { request_id: 'open-1', path: '/workspace/main.rs' },
      { timeoutMs: 5000 },
    ),
    true,
  );
  assert.equal(socket.rawEmits.length, 1);
  assert.equal(socket.volatileEmits.length, 0);

  socket.trigger('disconnect', 'transport close');
  await settlePromises();
  assert.equal(publishErrors.length, 1);
  assert.equal(publishErrors[0].method, 'editor.openComplete.publish');
  assert.match(publishErrors[0].error.message, /editor rpc socket disconnected/);

  const editorSource = fs.readFileSync(
    path.join(appRoot, 'monaco_editor/m_editor_app.ts'),
    'utf8',
  );
  assert.match(
    editorSource,
    /eventName === "editor_open_complete"[\s\S]{0,300}publishReliable\([\s\S]{0,200}openCompletePublish/,
  );
});

test('rapid WBA model opens run single-flight and retain only the latest document', async () => {
  const { createEditorWorkbenchRuntime } = await importTypeScript(
    'monaco_editor/editor_workbench_runtime.ts',
  );
  let currentPath = '/workspace/first.py';
  let model = {
    uri: { toString: () => `file://${currentPath}` },
    getLanguageId: () => 'python',
    getVersionId: () => 1,
    getValue: () => '',
  };
  const calls = [];
  const openAcks = [];
  const runtime = createEditorWorkbenchRuntime({
    getWindow: () => ({ __te2AdapterReady: true }),
    getMonaco: () => null,
    getEditor: () => ({ getModel: () => model }),
    getModel: () => model,
    getCurrentPath: () => currentPath,
    emitToHost: () => {},
    absPathFromVscodeUri: (uri) => String(uri).replace(/^file:\/\//, ''),
    languageFromPath: () => 'python',
    isLanguageContextCurrent: () => true,
    getLanguageBridge: () => ({ hoverSeq: 0 }),
    setDebugDiag: () => {},
    requestBreadcrumbSymbols: () => {},
    languageWorkersEnabled: () => false,
    isWbaRpcConnected: () => true,
    wbaRpcCall: (method, params) => {
      const call = deferred();
      calls.push({ method, params, call });
      return call.promise;
    },
    wbaRpcNotify: () => true,
    onActiveEditorOpenAck: (path) => openAcks.push(path),
    clearTimeoutFn: clearTimeout,
    setTimeoutFn: setTimeout,
  });

  const firstGeneration = runtime.wbBumpGeneration(currentPath, 'test-first');
  const firstOpen = runtime.wbOpenFileFlow({
    path: currentPath,
    languageId: 'python',
    uri: `file://${currentPath}`,
    requestId: 'first',
    generation: firstGeneration,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.path, '/workspace/first.py');

  currentPath = '/workspace/latest.rs';
  model = {
    uri: { toString: () => `file://${currentPath}` },
    getLanguageId: () => 'rust',
    getVersionId: () => 1,
    getValue: () => '',
  };
  const latestGeneration = runtime.wbBumpGeneration(currentPath, 'test-latest');
  let latestSettled = false;
  const latestOpen = runtime.wbOpenFileFlow({
    path: currentPath,
    languageId: 'rust',
    uri: `file://${currentPath}`,
    requestId: 'latest',
    generation: latestGeneration,
  }).then((result) => {
    latestSettled = true;
    return result;
  });
  await settlePromises();
  assert.equal(latestSettled, false);
  assert.equal(calls.length, 1);

  calls[0].call.resolve({ ok: true });
  await firstOpen;
  await settlePromises();
  assert.deepEqual(openAcks, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.path, '/workspace/latest.rs');

  calls[1].call.resolve({ ok: true });
  await latestOpen;
  await settlePromises();
  assert.equal(latestSettled, true);
  assert.deepEqual(openAcks, ["/workspace/latest.rs"]);
});

test('diagnostic links are revived as Monaco URIs before marker projection', async () => {
  const { createEditorWorkbenchRuntime } = await importTypeScript(
    'monaco_editor/editor_workbench_runtime.ts',
  );
  const currentPath = '/workspace/package.json';
  const model = {
    uri: { toString: () => `file://${currentPath}` },
    getLanguageId: () => 'json',
    getVersionId: () => 1,
    getValue: () => '{}',
  };
  const markerBatches = [];
  const parseUri = (value) => {
    const parsed = new URL(value);
    return {
      scheme: parsed.protocol.slice(0, -1),
      authority: parsed.host,
      path: parsed.pathname,
      toString: () => value,
    };
  };
  const runtime = createEditorWorkbenchRuntime({
    getWindow: () => ({ __te2AdapterReady: true }),
    getMonaco: () => ({
      Uri: { parse: parseUri },
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: {
        getModelMarkers: () => [],
        setModelMarkers: (_model, owner, markers) => markerBatches.push({ owner, markers }),
      },
    }),
    getEditor: () => ({ getModel: () => model }),
    getModel: () => model,
    getCurrentPath: () => currentPath,
    emitToHost: () => {},
    absPathFromVscodeUri: (uri) => String(uri).replace(/^file:\/\//, ''),
    languageFromPath: () => 'json',
    isLanguageContextCurrent: () => true,
    getLanguageBridge: () => ({ hoverSeq: 0 }),
    setDebugDiag: () => {},
    requestBreadcrumbSymbols: () => {},
    languageWorkersEnabled: () => false,
    isWbaRpcConnected: () => true,
    wbaRpcCall: async () => ({ ok: true }),
    wbaRpcNotify: () => true,
    clearTimeoutFn: clearTimeout,
    setTimeoutFn: setTimeout,
  });

  runtime.applyDiagnosticsUpdate({
    type: 'diagnostics/changeMany',
    args: ['json', [[
      { scheme: 'file', authority: '', path: currentPath },
      [{
        message: 'Unable to load schema',
        severity: 4,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        code: {
          value: 'schema',
          target: { scheme: 'https', authority: 'example.test', path: '/schema' },
        },
        relatedInformation: [{
          resource: { scheme: 'vscode', authority: 'schemas', path: '/vscode-extensions' },
          message: 'Schema source',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        }],
      }],
    ]]],
  });

  assert.equal(markerBatches.length, 1);
  const marker = markerBatches[0].markers[0];
  assert.equal(marker.relatedInformation[0].resource.path, '/vscode-extensions');
  assert.equal(marker.relatedInformation[0].resource.scheme, 'vscode');
  assert.equal(marker.code.target.path, '/schema');
  assert.equal(marker.code.target.scheme, 'https');
});

test('editor scroll state publishes the top visible line separately from the cursor', async () => {
  const { buildScrollStatePayload } = await importTypeScript(
    'monaco_editor/editor_scroll_publisher_payload_utils.ts',
  );
  const payload = buildScrollStatePayload({
    getPosition: () => ({ lineNumber: 47, column: 9 }),
    getVisibleRanges: () => [{
      startLineNumber: 31,
      endLineNumber: 55,
    }],
    getScrollTop: () => 620.5,
  }, '/workspace/active.rs');

  assert.deepEqual(payload, {
    path: '/workspace/active.rs',
    line: 31,
    top: 620.5,
    column: 9,
    cursorLine: 47,
  });
});

test('editor scroll publisher flushes the outgoing viewport before a path switch', async () => {
  const { installScrollPublisherRuntime } = await importTypeScript(
    'monaco_editor/editor_scroll_publisher_runtime.ts',
  );
  let scrollListener = null;
  let currentPath = '/workspace/old.rs';
  let topLine = 18;
  const sent = [];

  const runtime = installScrollPublisherRuntime({
    getEditor: () => ({
      onDidScrollChange: (listener) => {
        scrollListener = listener;
      },
      onDidChangeCursorPosition: () => {},
    }),
    getCurrentPath: () => currentPath,
    getModel: () => ({}),
    canInstall: () => true,
    setInstalled: () => {},
    buildScrollStatePayload: () => ({
      path: currentPath,
      line: topLine,
      top: topLine * 20,
      column: 1,
      cursorLine: topLine + 4,
    }),
    updateBreadcrumbCursor: () => {},
    notifyEditorRpc: (_method, payload) => {
      sent.push(payload);
      return true;
    },
    shouldSendImmediately: () => false,
    scheduleSend: (callback) => setTimeout(callback, 20),
  });

  scrollListener();
  assert.equal(runtime.flush(), true);
  currentPath = '/workspace/new.rs';
  topLine = 1;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/workspace/old.rs');
  assert.equal(sent[0].line, 18);
});

test('stored top-line restoration does not move the cursor or focus Monaco', async () => {
  const { applyJumpToLine } = await importTypeScript(
    'monaco_editor/editor_jump_utils.ts',
  );
  let scrollTop = null;
  let positionCalls = 0;
  let focusCalls = 0;

  applyJumpToLine({
    getTopForLineNumber: (line) => line * 24,
    setScrollTop: (value) => {
      scrollTop = value;
    },
    setPosition: () => {
      positionCalls += 1;
    },
    focus: () => {
      focusCalls += 1;
    },
  }, {
    getLineCount: () => 200,
    getLineMaxColumn: () => 80,
  }, {
    line: 73,
    focus: false,
    scroll_to_top: true,
  });

  assert.equal(scrollTop, 1752);
  assert.equal(positionCalls, 0);
  assert.equal(focusCalls, 0);
});

test('visible editor open completion does not await WBA or agent hydration', async () => {
  const { runEditorOpenTransaction } = await importTypeScript(
    'monaco_editor/editor_open_transaction_runner_main.ts',
  );
  const { createEditorOpenTransactionStore } = await importTypeScript(
    'monaco_editor/editor_open_transaction_state.ts',
  );
  let currentPath = null;
  const modelLifecycleOrder = [];
  const oldModel = {
    uri: { toString: () => 'file:///workspace/old.py' },
    getValue: () => 'old\n',
    getLanguageId: () => 'python',
    dispose: () => modelLifecycleOrder.push('dispose:old'),
  };
  let model = oldModel;
  const editor = {
    setModel: (nextModel) => {
      modelLifecycleOrder.push('editor:setModel');
      model = nextModel;
    },
    getModel: () => model,
  };
  const wbaOpen = deferred();
  const agentHydration = deferred();
  let wbaOpenCalls = 0;
  let agentHydrationCalls = 0;
  const switchOrder = [];
  const baselineRequests = [];

  const openPromise = runEditorOpenTransaction({
    getWindow: () => ({ monaco: {} }),
    getCurrentPath: () => currentPath,
    setCurrentPath: (pathValue) => {
      switchOrder.push(`path:${pathValue}`);
      currentPath = pathValue;
    },
    getBaseSha256: () => null,
    setBaseSha256: () => {},
    getLastContentSha256: () => null,
    setLastContentSha256: () => {},
    getEditor: () => editor,
    getDiffEditor: () => null,
    getModel: () => model,
    setModel: (nextModel) => {
      model = nextModel;
    },
    ensureEditorWithPrefs: async () => {},
    languageFromPath: () => 'python',
    monacoFileUri: (_monaco, pathValue) => ({ toString: () => `file://${pathValue}` }),
    applyLanguageToModel: () => {},
    createFileModel: (content, languageId, pathValue) => ({
      uri: { toString: () => `file://${pathValue}` },
      getValue: () => content,
      getLanguageId: () => languageId,
    }),
    installMirrorPublisher: () => {},
    installScrollPublisher: () => {},
    flushScrollState: () => {
      switchOrder.push('flush');
      return true;
    },
    applyLineNumberSizing: () => {},
    ensureTouchSelection: () => {},
    syncDiagnosticsForCurrentModel: () => {},
    emitToHost: () => {},
    emitModelReady: () => true,
    requestDraftDiff: () => {},
    clearDraftDiffDecorations: () => {},
    requestGitBaselines: (payload) => baselineRequests.push(payload),
    clearDiagnosticsForLeavingModel: () => {},
    wbCurrentGeneration: () => 0,
    wbBumpGeneration: () => 1,
    bcUpdatePath: () => {},
    queueDidChange: () => {},
    queueSymbols: () => {},
    openFileFlow: () => {
      wbaOpenCalls += 1;
      return wbaOpen.promise;
    },
    absPathFromVscodeUri: (uri) => String(uri).replace(/^file:\/\//, ''),
    applyJumpToLine: () => {},
    coercePositiveInt: (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
    shouldRecreateOpenModel: () => false,
    applyOpenModelTextSafely: () => {},
    emitOpenCacheState: () => {},
    queueBackendWorkbenchOpen: () => {},
    requestAgentEditDocumentState: () => {
      agentHydrationCalls += 1;
      return agentHydration.promise;
    },
    setApplyingRemote: () => {},
    openTransactionStore: createEditorOpenTransactionStore(),
  }, {
    path: '/workspace/fast.py',
    content: 'print("ready")\n',
    request_id: 'rapid-open',
  });

  const outcome = await Promise.race([
    openPromise.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
  ]);
  assert.equal(outcome, 'resolved');
  assert.equal(currentPath, '/workspace/fast.py');
  assert.deepEqual(switchOrder.slice(0, 2), ['flush', 'path:/workspace/fast.py']);
  assert.equal(wbaOpenCalls, 1);
  assert.equal(agentHydrationCalls, 1);
  assert.deepEqual(baselineRequests, [{ immediate: true, reason: 'open' }]);
  assert.ok(
    modelLifecycleOrder.indexOf('editor:setModel') <
      modelLifecycleOrder.indexOf('dispose:old'),
  );

  wbaOpen.resolve({ ok: true });
  agentHydration.resolve({ ok: true });
  await settlePromises();
});

test('modelReady is backend notification rather than WBA open or resync', () => {
  const frontendSource = fs.readFileSync(
    path.join(appRoot, 'monaco_editor/m_editor_app.ts'),
    'utf8',
  );
  const frontendBody = frontendSource.match(
    /function emitModelReady[\s\S]*?\n  function requestGitBaselines/,
  )?.[0];
  assert.ok(frontendBody, 'frontend modelReady handler must remain present');
  assert.match(frontendBody, /EDITOR_RPC_METHODS\.modelReady/);
  assert.doesNotMatch(frontendBody, /wbFlushActiveModelOpen/);
  assert.doesNotMatch(frontendBody, /hydrateWorkbenchProviderSnapshot/);

  const reconnectBody = frontendSource.match(
    /function handleWbaSocketReadyForEditor[\s\S]*?\n  function _clearEditorDecorationStateRuntime/,
  )?.[0];
  assert.ok(reconnectBody, 'WBA reconnect handler must remain present');
  assert.match(reconnectBody, /editorWorkbenchCall\("resync"/);
  assert.match(reconnectBody, /hydrateWorkbenchProviderSnapshot/);

  const backendSource = fs.readFileSync(
    path.join(appRoot, 'monaco_editor/editor_ws.py'),
    'utf8',
  );
  const backendBody = backendSource.match(
    /async def editor_runtime_handle_model_ready[\s\S]*?\n\nasync def editor_runtime_handle_issues_dump_response/,
  )?.[0];
  assert.ok(backendBody, 'backend modelReady handler must remain present');
  assert.doesNotMatch(backendBody, /adapter_rpc/);
  assert.doesNotMatch(backendBody, /te2\.resync/);
});

test('TextMate catalog and factory initialization are shared across concurrent callers', async () => {
  const { createEditorTextmateRuntime } = await importTypeScript(
    'monaco_editor/editor_textmate_runtime.ts',
  );
  const wasm = fs.readFileSync(path.join(appRoot, 'monaco_editor/textmate/onig.wasm'));
  let grammarListCalls = 0;
  let wasmFetches = 0;
  const windowLike = {
    monaco: {
      editor: { getModels: () => [] },
      languages: {
        setColorMap: () => {},
        getLanguages: () => [],
        register: () => {},
        setTokensProvider: () => {},
        getEncodedLanguageId: () => 1,
      },
    },
  };
  const runtime = createEditorTextmateRuntime({
    getWindow: () => windowLike,
    getApiBase: () => '',
    fetchFn: async () => {
      wasmFetches += 1;
      return new Response(wasm);
    },
    fetchJsonWithBase: async () => ({}),
    buildUiUrl: (value) => value,
    normalizeLanguage: (value) => String(value || ''),
    editorWorkbenchCall: async (method) => {
      assert.equal(method, 'grammars_list');
      grammarListCalls += 1;
      await settlePromises();
      return { grammars: [] };
    },
  });

  const [first, second] = await Promise.all([
    runtime.ensureTextmateReady(),
    runtime.ensureTextmateReady(),
  ]);
  assert.equal(first, second);
  assert.equal(grammarListCalls, 1);
  assert.equal(wasmFetches, 1);
});

test('Android Gecko keyboard recovery synchronously restores focus', async () => {
  const {
    isAndroidGeckoRuntime,
    recoverAndroidKeyboard,
    resolveAndroidKeyboardRecoveryHost,
  } = await importTypeScript(
    'monaco_editor/editor_android_keyboard_recovery_utils.ts',
  );
  const calls = [];
  const input = {
    disabled: false,
    readOnly: false,
    inputMode: 'text',
    blur: () => { calls.push('blur'); },
    focus: () => { calls.push('focus'); },
  };
  const editor = {
    getDomNode: () => ({
      querySelector: () => input,
    }),
  };
  assert.equal(recoverAndroidKeyboard(editor), true);
  assert.deepEqual(calls, ['blur', 'focus']);

  assert.equal(isAndroidGeckoRuntime('Mozilla/5.0 Android Chrome/140'), false);
  assert.equal(
    isAndroidGeckoRuntime(
      'Mozilla/5.0 (Android 16; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
    ),
    true,
  );

  const stableHost = {};
  const monacoOwnedDom = {
    closest: (selector) => selector === '#editor-frame' ? stableHost : null,
  };
  assert.equal(
    resolveAndroidKeyboardRecoveryHost(monacoOwnedDom),
    stableHost,
  );
});
