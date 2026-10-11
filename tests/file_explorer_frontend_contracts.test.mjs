import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';

const bundle = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/frontend_contracts.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const contracts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
function runtime(t, value) {
  const previous = globalThis.window;
  globalThis.window = value;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
}

test('host adapter preserves receivers and optional state capabilities', () => {
  const saved = [];
  const raw = { id: 'file_explorer', loadState(seed) { assert.equal(this, raw); assert.equal(seed, null); return { path: '/project' }; }, saveState(state) { assert.equal(this, raw); saved.push(state); } };
  const host = contracts.hostContract(raw);
  assert.deepEqual(host.loadState(), { path: '/project' });
  host.saveState({ path: '/next' }); assert.deepEqual(saved, [{ path: '/next' }]);
  assert.equal(contracts.hostContract(null).loadState(), null);
  assert.equal(contracts.hostContract(null).toast('optional'), false);
});

test('API adapter validates capabilities and performs one request without changing payload', async () => {
  const calls = [], raw = { get(endpoint) { assert.equal(this, raw); calls.push(endpoint); return { data: 1 }; }, post(endpoint, body) { assert.equal(this, raw); calls.push([endpoint, body]); throw new Error('uncertain mutation'); } };
  const api = contracts.apiContract(raw);
  assert.deepEqual(await api.get('list'), { data: 1 });
  await assert.rejects(api.post('delete', { path: '/file' }), /uncertain mutation/);
  assert.equal(calls.length, 2); assert.throws(() => contracts.apiContract({ get() {} }), /unavailable/);
});

test('dialogs preserve shared intent confirmation options and reject malformed results', async t => {
  const calls = [], dialog = { confirm(...args) { assert.equal(this, dialog); calls.push(args); return true; }, prompt() { return 'name'; } };
  runtime(t, { teUI: { dialog } });
  const adapter = contracts.dialogContract();
  assert.equal(await adapter.confirm('Switch?', { title: 'Project', detail: '/project' }), true);
  assert.deepEqual(calls, [['Switch?', { title: 'Project', detail: '/project' }]]);
  dialog.confirm = () => 'yes'; await assert.rejects(adapter.confirm('Switch?'), /Invalid confirmation/);
  dialog.prompt = () => 42; await assert.rejects(adapter.prompt('Name'), /Invalid prompt/);
});

test('picker discovery remains dynamic and validates unknown returned paths', async t => {
  runtime(t, {}); assert.equal(contracts.pickerContract(), undefined);
  const picker = { openDirectory() { assert.equal(this, picker); return { path: '/dest' }; } };
  window.teFilePicker = picker;
  const adapter = contracts.pickerContract();
  assert.deepEqual(await adapter.openDirectory({ title: 'Directory', startPath: '/' }), { path: '/dest' });
  picker.openDirectory = () => ({ path: 7 });
  await assert.rejects(adapter.openDirectory({ title: 'Directory', startPath: '/' }), /Invalid file picker/);
});

test('notifications use the public dismiss capability', t => {
  const calls = [], ui = { notify(value) { assert.equal(this, ui); calls.push(['notify', value]); }, dismiss(id) { assert.equal(this, ui); calls.push(['dismiss', id]); } };
  runtime(t, { teUI: ui });
  contracts.uiNotification({ id: 'job' }); contracts.dismissNotification('job');
  assert.deepEqual(calls, [['notify', { id: 'job' }], ['dismiss', 'job']]);
});

test('Socket.IO adapter preserves callbacks, receiver, send buffer, and exact options', async t => {
  const calls = [], buffer = [], listener = () => {}, raw = { connected: true, sendBuffer: buffer };
  for (const name of ['on', 'off', 'once', 'emit', 'connect', 'disconnect']) raw[name] = function (...args) { assert.equal(this, raw); calls.push([name, ...args]); };
  runtime(t, { io(namespace, options) { calls.push(['io', namespace, options]); return raw; } });
  const io = await contracts.ensureSocketIoLoaded(), options = { auth: { codec: 'msgpack-v1' } }, socket = io('/tabs', options);
  assert.equal(socket.connected, true); assert.equal(socket.sendBuffer, buffer);
  socket.on('event', listener); socket.off('event', listener); socket.once('event', listener); socket.connect(); socket.disconnect();
  assert.equal(calls[0][2], options); assert.equal(calls[1][2], listener); assert.equal(calls[2][2], listener);
  raw.connected = false; assert.equal(socket.connected, false);
});

test('preferences retain embedded path fencing and validated view/sort defaults', () => {
  const value = { path: '/saved', view: 'invalid', sortBy: 'invalid', sortAsc: false, showHidden: true };
  assert.deepEqual(contracts.preferenceDto(value, null, true), { path: '~', view: 'list', sortBy: 'name', sortAsc: false, showHidden: true });
  assert.equal(contracts.preferenceDto(value, '/query', false).path, '/query');
  assert.equal(contracts.preferenceDto(value, null, false).path, '/saved');
});
