import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';

const { outputFiles } = await build({
  entryPoints: [new URL('../app/apps/file_explorer/src/frontend_contracts.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'browser', write: false,
});
const contracts = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
function runtime() {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document });
  return window;
}

test('host callbacks retain their receiver and host API returns already-unwrapped data untouched', async () => {
  const calls = [], data = { path: '/already-unwrapped', entries: [], data: 'legitimate application field' };
  const raw = {
    id: 'file_explorer',
    setTitle(value) { assert.equal(this, raw); calls.push(['title', value]); },
    loadState(value) { assert.equal(this, raw); assert.equal(value, null); return data; },
    saveState(value) { assert.equal(this, raw); calls.push(['state', value]); },
    toast(value) { assert.equal(this, raw); calls.push(['toast', value]); },
  };
  const host = contracts.hostContract(raw);
  host.setTitle('Files'); assert.equal(host.loadState(), data); host.saveState(data); assert.equal(host.toast('hello'), true);
  assert.deepEqual(calls, [['title', 'Files'], ['state', data], ['toast', 'hello']]);
  const absent = contracts.hostContract(null);
  assert.equal(absent.id, 'file_explorer'); assert.equal(absent.loadState(), null); assert.equal(absent.toast('ignored'), false);
  absent.setTitle('optional'); absent.saveState({});
  const apiRaw = {
    get(endpoint) { assert.equal(this, apiRaw); assert.equal(endpoint, 'list'); return Promise.resolve(data); },
    post(endpoint, body) { assert.equal(this, apiRaw); assert.equal(endpoint, 'mutate'); assert.equal(body, data); return data; },
  };
  const api = contracts.apiContract(apiRaw);
  assert.equal(await api.get('list'), data); assert.equal(await api.post('mutate', data), data);
  assert.throws(() => contracts.apiContract({ get() {} }), /host API is unavailable/);
});

test('dialogs reject malformed values, preserve cancellation and method receiver', async () => {
  const window = runtime(); let promptValue = null, confirmValue = false;
  const dialog = {
    prompt(message, initial) { assert.equal(this, dialog); assert.equal(message, 'Name'); assert.equal(initial, 'default'); return promptValue; },
    confirm(message) { assert.equal(this, dialog); assert.equal(message, 'Close?'); return confirmValue; },
  };
  window.teUI = { dialog };
  const adapter = contracts.dialogContract();
  assert.equal(await adapter.prompt('Name', 'default'), null); assert.equal(await adapter.confirm('Close?'), false);
  promptValue = undefined; assert.equal(await adapter.prompt('Name', 'default'), null);
  promptValue = 'new'; confirmValue = true; assert.equal(await adapter.prompt('Name', 'default'), 'new'); assert.equal(await adapter.confirm('Close?'), true);
  promptValue = {}; confirmValue = 'true';
  await assert.rejects(adapter.prompt('Name', 'default'), /Invalid prompt response/);
  await assert.rejects(adapter.confirm('Close?'), /Invalid confirmation response/);
  window.teUI = {}; await assert.rejects(adapter.confirm('Close?'), /Missing frontend capability/);
});

test('picker exposes only available capabilities and validates each returned choice', async () => {
  const window = runtime(); assert.equal(contracts.pickerContract(), undefined);
  let choice = { path: '/chosen', unused: true }; const options = { title: 'Pick', startPath: '/home' };
  const picker = { openDirectory(value) { assert.equal(this, picker); assert.equal(value, options); return choice; } };
  window.teFilePicker = picker;
  const adapter = contracts.pickerContract(); assert.equal(adapter.saveFile, undefined);
  assert.deepEqual(await adapter.openDirectory(options), { path: '/chosen' });
  choice = null; assert.equal(await adapter.openDirectory(options), null);
  choice = undefined; assert.equal(await adapter.openDirectory(options), null);
  choice = { path: 9 }; await assert.rejects(adapter.openDirectory(options), /Invalid file picker response/);
  choice = '/raw-string'; await assert.rejects(adapter.openDirectory(options), /Invalid file picker response/);
});

test('preference defaults respect embedded path authority and explicit sort/view options', () => {
  assert.deepEqual(contracts.preferenceDto(null, null, false), { path: '~', showHidden: false, view: 'list', sortBy: 'name', sortAsc: true });
  assert.deepEqual(contracts.preferenceDto({ path: '/saved', view: 'bad', sortBy: 'bad', sortAsc: 0 }, null, false), { path: '/saved', showHidden: false, view: 'list', sortBy: 'name', sortAsc: true });
  const saved = { path: '/saved', view: 'grid', sortBy: 'date', sortAsc: false, showHidden: true };
  assert.deepEqual(contracts.preferenceDto(saved, null, true), { path: '~', showHidden: true, view: 'grid', sortBy: 'date', sortAsc: false });
  assert.equal(contracts.preferenceDto(saved, '/explicit', true).path, '/explicit');
});

test('Socket.IO wrapper preserves receiver, ACK and listener identity; public dismiss uses its manager receiver', async () => {
  const window = runtime(), listeners = new Map(), calls = [], buffer = [];
  const raw = {
    connected: true, sendBuffer: buffer,
    on(name, callback) { assert.equal(this, raw); listeners.set(name, callback); },
    off(name, callback) { assert.equal(this, raw); assert.equal(listeners.get(name), callback); listeners.delete(name); },
    once(name, callback) { assert.equal(this, raw); calls.push(['once', name, callback]); },
    emit(name, payload, ack) { assert.equal(this, raw); calls.push(['emit', name, payload, ack]); ack(payload); },
    connect() { assert.equal(this, raw); calls.push('connect'); },
    disconnect() { assert.equal(this, raw); calls.push('disconnect'); },
  };
  const options = { transports: ['websocket'] };
  window.io = function(namespace, supplied) { assert.equal(this, window); assert.equal(namespace, '/tabs'); assert.equal(supplied, options); return raw; };
  const factory = await contracts.ensureSocketIoLoaded(), socket = factory('/tabs', options);
  const listener = () => {}, packet = new Uint8Array([1, 2]); let acknowledged;
  const ack = value => { acknowledged = value; };
  socket.on('snapshot', listener); socket.off('snapshot', listener); socket.once('ready', listener);
  socket.emit('rpc', packet, ack); socket.connect(); socket.disconnect();
  assert.equal(acknowledged, packet); assert.equal(calls[1][3], ack); assert.equal(calls[0][2], listener);
  assert.equal(socket.sendBuffer, buffer); assert.equal(socket.connected, true); raw.connected = false; assert.equal(socket.connected, false);
  window.io = () => ({ on() {} }); const badFactory = await contracts.ensureSocketIoLoaded();
  assert.throws(() => badFactory('/tabs', {}), /Invalid Socket.IO capability/);
  const dismissed = [], ui = { dismiss(id) { assert.equal(this, ui); dismissed.push(id); } };
  window.teUI = ui; contracts.dismissNotification('notification-1'); assert.deepEqual(dismissed, ['notification-1']);
  window.teUI = {}; contracts.dismissNotification('optional');
});
