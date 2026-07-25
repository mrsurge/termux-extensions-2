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
  const appPath = '/api/app/file_editor_cm6/socket.io';

  assert.equal(topology.SOCKET_IO_PATHS.editor, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.explorer, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.terminal, appPath);
  assert.equal(topology.SOCKET_IO_PATHS.uiIpc, appPath);
  assert.equal(
    topology.SOCKET_IO_PATHS.wba,
    '/api/app/file_editor_cm6/services/wba/socket.io',
  );
  assert.equal(topology.SOCKET_IO_PATHS.te2Console, '/te2_console_ws/socket.io');
});

test('shared RPC transport delivers connected calls reliably without replaying reconnect-era work', async () => {
  const { createSocketIoJsonRpcClient } = await importTypeScript('src/rpc/transport.ts');
  const socket = new FakeSocket();
  socket.ackResponse = { jsonrpc: '2.0', id: 'ignored-by-client', result: { ok: true } };
  const client = createSocketIoJsonRpcClient({
    namespace: '/rpc/test',
    path: '/api/app/file_editor_cm6/socket.io',
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
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.path, '/workspace/latest.rs');

  calls[1].call.resolve({ ok: true });
  await latestOpen;
  await settlePromises();
  assert.equal(latestSettled, true);
});

test('visible editor open completion does not await WBA or agent hydration', async () => {
  const { runEditorOpenTransaction } = await importTypeScript(
    'monaco_editor/editor_open_transaction_runner_main.ts',
  );
  const { createEditorOpenTransactionStore } = await importTypeScript(
    'monaco_editor/editor_open_transaction_state.ts',
  );
  let currentPath = null;
  let model = null;
  const editor = {
    setModel: (nextModel) => {
      model = nextModel;
    },
    getModel: () => model,
  };
  const wbaOpen = deferred();
  const agentHydration = deferred();
  let wbaOpenCalls = 0;
  let agentHydrationCalls = 0;

  const openPromise = runEditorOpenTransaction({
    getWindow: () => ({ monaco: {} }),
    getCurrentPath: () => currentPath,
    setCurrentPath: (pathValue) => {
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
    applyLineNumberSizing: () => {},
    ensureTouchSelection: () => {},
    syncDiagnosticsForCurrentModel: () => {},
    emitToHost: () => {},
    emitModelReady: () => true,
    requestDraftDiff: () => {},
    clearDraftDiffDecorations: () => {},
    requestGitBaselines: () => {},
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
  assert.equal(wbaOpenCalls, 1);
  assert.equal(agentHydrationCalls, 1);

  wbaOpen.resolve({ ok: true });
  agentHydration.resolve({ ok: true });
  await settlePromises();
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
