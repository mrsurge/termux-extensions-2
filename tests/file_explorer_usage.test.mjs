import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';
import { packObject } from '../app/static/js/file_explorer_codec.js';
const { outputFiles } = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/usage.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false });
const { createDirectoryUsage } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const template = await readFile(new URL('../app/apps/file_explorer/src/template.html', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(request) {
  const window = new Window(); window.document.body.innerHTML = template;
  const container = window.document.querySelector('[data-app-root]'), handlers = new Map(), calls = [], notices = [];
  container.querySelector('[data-role="list"]').innerHTML = '<div class="fx-item" data-path="/project/child"><span class="fx-size">1 KiB</span></div>';
  container.querySelector('[data-role="grid"]').innerHTML = '<div class="fx-tile" data-path="/project/child"></div>';
  let current = { tabId: 'tab', path: '/project' };
  const socket = { connected: true, on(name, fn) { handlers.set(name, fn); }, off(name, fn) { if (handlers.get(name) === fn) handlers.delete(name); } };
  const controller = createDirectoryUsage({ container, current: () => current, notify: text => notices.push(text),
    request: async (method, params) => { calls.push({ method, ...params }); return request ? request(method, params) : { scanId: params.scanId, ...(method.endsWith('start') ? { accepted: true } : { cancelled: true }) }; } });
  controller.bindSocket(socket);
  const get = role => container.querySelector(`[data-role="${role}"]`);
  const modal = container.querySelector('[data-role="usage-header"]');
  return { controller, window, container, get, calls, notices, modal, socket, handlers,
    change(value) { current = value; controller.sync(); },
    update(value = {}) { const scanId = calls.findLast(call => call.method.endsWith('start'))?.scanId;
      handlers.get('directory_usage')?.(packObject({ tabId: 'tab', scanId, path: '/project', status: 'complete', mode: 'allocated', totalBytes: 8192, entriesVisited: 3,
        entries: [{ name: '<unsafe>', path: '/project/child', type: 'file', bytes: 4096, complete: true }], complete: true, errorCount: 0, errors: [], ...value })); },
    async dispose() { controller.dispose(); await window.happyDOM.abort(); window.close(); },
  };
}
test('usage is explicit, renders safe totals and preserves a final result preceding the start ACK', async () => {
  const gate = deferred(); const f = fixture((method, params) => method.endsWith('start') ? gate.promise : { scanId: params.scanId, cancelled: true });
  assert.equal(f.calls.length, 0); const starting = f.controller.open();
  f.update(); gate.resolve({ scanId: f.calls[0].scanId, accepted: true }); await starting;
  assert.match(f.get('usage-status').textContent, /complete/);
  assert.equal(f.container.querySelector('.fx-size').textContent, '4 KiB');
  assert.equal(f.container.querySelector('.fx-usage-icon-size').textContent, '4 KiB');
  assert.equal(f.container.querySelector('unsafe'), null); await f.dispose();
});
test('close cancels exact scan and fences its late result and acknowledgement', async () => {
  const gate = deferred(); const f = fixture((method, params) => method.endsWith('start') ? gate.promise : { scanId: params.scanId, cancelled: true });
  const pending = f.controller.open(); const id = f.calls[0].scanId; f.controller.close(); f.update();
  gate.resolve({ scanId: id, accepted: true }); await pending;
  assert.ok(f.calls.filter(call => call.method.endsWith('cancel')).every(call => call.scanId === id));
  assert.equal(f.modal.hidden, true); assert.equal(f.container.querySelector('.fx-size').textContent, '1 KiB'); await f.dispose();
});
test('tab/path changes cancel, stale identities are ignored, and explicit cancellation reaches a terminal UI state', async () => {
  const f = fixture(); await f.controller.open(); f.update({ scanId: 'stale' }); assert.equal(f.container.querySelector('.fx-size').textContent, '…');
  f.container.querySelector('[data-action="usage-cancel"]').click(); await new Promise(resolve => setImmediate(resolve));
  assert.match(f.get('usage-status').textContent, /cancelled/);
  await f.controller.open(); f.change({ tabId: 'other', path: '/elsewhere' });
  assert.equal(f.modal.hidden, true); assert.equal(f.calls.at(-1).method, 'directoryUsage.cancel'); await f.dispose();
});
test('disconnect ends observation without replay and dispose removes socket listeners', async () => {
  const f = fixture(); await f.controller.open(); const count = f.calls.length;
  f.socket.connected = false; f.handlers.get('disconnect')(); f.update();
  assert.match(f.get('usage-status').textContent, /interrupted/); assert.equal(f.calls.length, count);
  await f.dispose(); assert.equal(f.handlers.size, 0);
});
test('malformed current responses cancel rather than display false complete totals; partial result stays labelled', async () => {
  const f = fixture(); await f.controller.open(); f.update({ totalBytes: -1 });
  assert.match(f.get('usage-status').textContent, /Invalid/); assert.equal(f.calls.at(-1).method, 'directoryUsage.cancel');
  await f.controller.open(); f.update({ status: 'partial', complete: false, reason: 'entry_limit', errorCount: 1, errors: [{ path: '/project/denied', message: 'Permission denied' }] });
  assert.match(f.get('usage-status').textContent, /partial/); assert.match(f.get('usage-status').title, /Permission denied/); await f.dispose();
});
test('failed start is not retried and surfaces framework availability error', async () => {
  const f = fixture(async (method, params) => { if (method.endsWith('start')) throw new Error('Method not found'); return { scanId: params.scanId, cancelled: false }; });
  await f.controller.open(); assert.equal(f.calls.filter(call => call.method.endsWith('start')).length, 1); assert.equal(f.get('usage-status').textContent, 'Method not found'); await f.dispose();
});
test('progress updates both views and survives listing rerender without moving focus', async () => {
  const f = fixture(); await f.controller.open();
  const row = f.container.querySelector('.fx-item'); row.tabIndex = 0; row.focus();
  f.update({ status: 'running', complete: false });
  assert.equal(f.container.querySelector('.fx-size').textContent, '4 KiB');
  assert.equal(f.window.document.activeElement, row);
  f.container.querySelector('.fx-size').replaceWith(Object.assign(f.window.document.createElement('span'), { className: 'fx-size', textContent: '1 KiB' }));
  f.controller.refresh(); assert.equal(f.container.querySelector('.fx-size').textContent, '4 KiB');
  assert.equal(f.container.querySelector('[data-action="usage-cancel"]').hidden, false);
  await f.dispose();
});
test('enabled usage persists through navigation while cancellation applies only to its current scan', async () => {
  const f = fixture(); f.controller.toggle(); await new Promise(resolve => setImmediate(resolve));
  const first = f.calls[0].scanId;
  f.change({ tabId: 'tab', path: '/next' }); f.controller.directoryReady(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.isEnabled(), true);
  assert.ok(f.calls.some(call => call.method.endsWith('cancel') && call.scanId === first));
  assert.equal(f.calls.filter(call => call.method.endsWith('start')).length, 2);
  f.container.querySelector('[data-action="usage-cancel"]').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.isEnabled(), true);
  f.change({ tabId: 'tab', path: '/third' }); f.controller.directoryReady(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call.method.endsWith('start')).length, 3);
  assert.equal(f.window.localStorage.getItem('te2:file-explorer:directory-usage:v1'), 'true');
  f.controller.toggle(); assert.equal(f.controller.isEnabled(), false); await f.dispose();
});
