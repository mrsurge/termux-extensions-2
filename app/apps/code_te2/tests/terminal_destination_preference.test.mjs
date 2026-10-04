import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let sequence = 0;
async function module(entry) {
  const result = await build({ entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${sequence++}`);
}

test('browser choices are per stable client/framework, cached, resettable and project independent', async () => {
  const { createTerminalDestinationPreference } = await module('main_page/frontend/ui/terminal-destination-preference.ts');
  const previous = globalThis.window;
  const data = new Map(); let reads = 0;
  globalThis.window = { location: { origin: 'http://browser', search: '?project=/a' },
    localStorage: { getItem: key => { reads++; return data.get(key) ?? null; }, setItem: (key, value) => data.set(key, value) } };
  try {
    const first = createTerminalDestinationPreference('client_a');
    assert.equal(await first.read(), 'ask');
    assert.equal(await first.read(), 'ask');
    assert.equal(reads, 1);
    await first.write('drawer');
    window.location.search = '?project=/b';
    assert.equal(await createTerminalDestinationPreference('client_a').read(), 'drawer');
    assert.equal(await createTerminalDestinationPreference('client_b').read(), 'ask');
    window.location.origin = 'http://other';
    assert.equal(await createTerminalDestinationPreference('client_a').read(), 'ask');
    await first.write('ask');
    window.location.origin = 'http://browser';
    assert.equal(await createTerminalDestinationPreference('client_a').read(), 'ask');
  } finally { globalThis.window = previous; }
});

test('Electron uses native storage and never falls back to random relay localStorage', async () => {
  const { createTerminalDestinationPreference } = await module('main_page/frontend/ui/terminal-destination-preference.ts');
  const previous = globalThis.window;
  let saved = 'sidebar';
  globalThis.window = { location: { origin: 'http://127.0.0.1:12345', search: '' },
    localStorage: { getItem: () => { throw new Error('must not read relay'); }, setItem: () => { throw new Error('must not write relay'); } },
    te2Electron: { readTerminalDestination: async () => saved, writeTerminalDestination: async value => { saved = value; } } };
  try {
    const prefs = createTerminalDestinationPreference('client_a');
    assert.equal(await prefs.read(), 'sidebar');
    await prefs.write('ask');
    assert.equal(saved, 'ask');
    window.te2Electron = {};
    await assert.rejects(createTerminalDestinationPreference('client_a').read(), /Update desktop/);
  } finally { globalThis.window = previous; }
});

test('the real host wire parser accepts destination notifications', async () => {
  const { parseUiIpcRpcNotification } = await module('src/ui_ipc/rpc_contract.ts');
  assert.equal(parseUiIpcRpcNotification({ jsonrpc: '2.0', method: 'ui.terminal.destination',
    params: { requestId: 'correlation', directory: '/project' } }).method, 'ui.terminal.destination');
});
