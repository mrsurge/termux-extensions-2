import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function load(source) {
  const result = await build({ entryPoints: [new URL(source, import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('contribution invalidation coalesces, retains changes during a request, and resumes after disconnect', async () => {
  const { createContributionRefresher } = await load('../monaco_editor/editor_contribution_refresh.ts');
  let connected = true, calls = 0, release;
  const errors = [];
  const refresh = createContributionRefresher(() => connected, async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
  }, error => errors.push(error));
  const first = refresh.request();
  await Promise.resolve();
  const second = refresh.request();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  connected = false;
  await refresh.request();
  assert.equal(calls, 2);
  connected = true;
  await refresh.request();
  assert.equal(calls, 3);
  assert.deepEqual(errors, []);
});

test('a failed contribution refresh is visible and a subsequent reconnect can retry', async () => {
  const { createContributionRefresher } = await load('../monaco_editor/editor_contribution_refresh.ts');
  let calls = 0;
  const errors = [];
  const refresh = createContributionRefresher(() => true, async () => {
    if (++calls === 1) throw Error('disconnected');
  }, error => errors.push(error.message));
  await refresh.request();
  await refresh.request();
  assert.equal(calls, 2);
  assert.deepEqual(errors, ['disconnected']);
});

test('editor transport reconciles contributions on reconnect, not first connect', async () => {
  const { createEditorRpcTransport } = await load('../monaco_editor/editor_rpc_transport.ts');
  const handlers = new Map();
  const socket = { connected: false, on: (name, handler) => handlers.set(name, handler) };
  let reconciliations = 0;
  const transport = createEditorRpcTransport({ getSocket: () => socket,
    setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout,
    onReconnect: () => reconciliations++,
  });
  transport.attachSocket(socket);
  socket.connected = true;
  handlers.get('connect')();
  assert.equal(reconciliations, 0);
  socket.connected = false;
  handlers.get('disconnect')();
  socket.connected = true;
  handlers.get('connect')();
  assert.equal(reconciliations, 1);
});

test('manual VSIX install opens configuration without scheduling a page reload', async () => {
  const { createSettingsInstallController } = await load('../main_page/frontend/ui/settings-install.ts');
  const win = new Window();
  const button = win.document.createElement('button');
  const opened = [];
  let reloads = 0;
  createSettingsInstallController({
    installBtn: button, pickerAvailable: () => true, pickFile: async () => '/extension.vsix',
    getStartPath: () => '/', busRequest: async () => ({ ok: true,
      extension: { id: 'example.extension', display_name: 'Example' },
      config_schema: { properties: { 'example.enabled': { type: 'boolean' } } },
    }), refreshExtManager: () => {}, reloadEditorFrame: () => reloads++,
    openExtConfigModal: (...args) => opened.push(args), toast: () => {},
  }).install();
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'example.extension');
  win.close();
});

test('extension operations do not reload the page; runtime mode still may', async () => {
  for (const source of ['settings-install.ts', 'settings-manager.ts', 'settings-config-modal.ts']) {
    const text = await readFile(new URL(`../main_page/frontend/ui/${source}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /deps\.reloadEditorFrame\(\)/);
  }
  const runtime = await readFile(new URL('../src/explorer/rpc/runtime.ts', import.meta.url), 'utf8');
  const restartBlock = runtime.match(/extensionsAdapterRestarting\) \{[^}]*\}/)?.[0];
  assert.ok(restartBlock);
  assert.doesNotMatch(restartBlock, /reloadEditorFrame/);
  const preferences = await readFile(new URL('../main_page/frontend/ui/settings-refresh.ts', import.meta.url), 'utf8');
  assert.equal(preferences.match(/deps\.reloadEditorFrame\(\)/g)?.length, 1);
});
