import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['src/contracts.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const contracts = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('shell DTOs preserve command arrays and optional fields', () => {
  assert.deepEqual(contracts.shellsFrom([{ id: 'shell/1', command: ['bash', '-l'], pid: null }]), [{ id: 'shell/1', command: ['bash', '-l'], pid: null }]);
  assert.throws(() => contracts.shellsFrom({}), /Invalid/);
  assert.throws(() => contracts.shellsFrom([{ id: 1 }]), /Invalid/);
});
test('extension DTOs reject malformed ingress', () => {
  assert.deepEqual(contracts.extensionsFrom([{ name: 'Terminal', _ext_dir: 'apps', ignored: true }]), [{ name: 'Terminal', _ext_dir: 'apps' }]);
  assert.throws(() => contracts.extensionsFrom([null]), /Invalid/);
});
test('settings objects preserve unknown framework-owned fields', () => {
  const settings = { extensionOrder: ['extension-apps'], future: { enabled: true } };
  assert.equal(contracts.record(settings), settings);
  assert.equal(contracts.record([]), null);
});
test('build has the same public mount, no split chunks', async () => {
  const bundle = await readFile('main.js', 'utf8');
  assert.match(bundle, /export\{/);
  assert.doesNotMatch(bundle, /import\s*\(/);
  assert.match(bundle, /\/api\/settings/);
  assert.match(bundle, /X-Framework-Key/);
});
test('settings saves serialize caller body, not empty RequestInit body', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  assert.match(source, /JSON\.stringify\(options\.body\)/);
  assert.match(source, /headers\.set\('Content-Type', 'application\/json'\)/);
  assert.match(source, /persistSettingsPatch\(\{ extensionOrder: newOrder \}\)/);
  assert.match(source, /cell\.textContent = String\(value\)/);
});
test('mount restores token and integration toggle; saves preserve framework fields', async () => {
  const bundle = await readFile('main.js', 'utf8');
  const { default: init } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
  const previousFetch = globalThis.fetch;
  const calls = [];
  const handlers = new Map();
  const token = { value: '' };
  const toggle = { checked: false };
  const settings = { persistent_network_notification: true, futureSetting: 'preserved' };
  const root = { querySelector(selector) {
    if (selector === '#framework-token') return token;
    if (selector === '#setting-persistent-network') return toggle;
    if (selector.includes('data-action')) return { addEventListener(event, handler) { handlers.set(selector, handler); } };
    return null;
  } };
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const data = url === '/api/settings' ? (opts.method === 'POST' ? JSON.parse(opts.body) : settings) : [];
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  };
  try {
    init(root, {}, { loadState: () => ({ frameworkToken: 'test-token' }), toast() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(token.value, 'test-token');
    assert.equal(toggle.checked, true);
    assert.equal(calls[0].opts.headers.get('X-Framework-Key'), 'test-token');
    toggle.checked = false;
    await handlers.get('[data-action="save-integration-settings"]')();
    const save = calls.find(call => call.opts.method === 'POST');
    assert.equal(save.opts.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(save.opts.body), { persistent_network_notification: false, futureSetting: 'preserved' });
  } finally { globalThis.fetch = previousFetch; }
});
