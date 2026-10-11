import test from 'node:test';
import assert from 'node:assert/strict';
import { mountIntent, tabUrl, createTabClient } from '../app/static/js/file_explorer_tabs.mjs';

test('launch intent distinguishes framework, sidebar, fresh and restored tabs', () => {
  const url = query => new URL('http://host/app/file_explorer' + query);
  assert.deepEqual(mountIntent(url('?te2_host_id=slot'), 'last'), { kind: 'splash' });
  assert.deepEqual(mountIntent(url(''), 'last'), { kind: 'attach', tabId: 'last' });
  assert.deepEqual(mountIntent(url('')), { kind: 'splash' });
  assert.deepEqual(mountIntent(url('?path=/project')), { kind: 'create', path: '/project' });
  assert.deepEqual(mountIntent(url('?path=/old&tab_id=existing')), { kind: 'attach', tabId: 'existing' });
  const resolved = tabUrl(url('?path=/project&tab_create=once&te2_host_id=slot'), 'tab');
  assert.equal(resolved.searchParams.get('tab_id'), 'tab');
  assert.equal(resolved.searchParams.get('te2_host_id'), 'slot');
  assert.equal(resolved.searchParams.has('path'), false);
  assert.equal(resolved.searchParams.has('tab_create'), false);
  assert.equal(tabUrl(resolved, '').searchParams.has('tab_id'), false);
});

function socket() {
  const handlers = new Map();
  const calls = [];
  return { connected: true, sendBuffer: [], calls,
    on(name, callback) { handlers.set(name, callback); },
    off(name) { handlers.delete(name); }, disconnect() { this.connected = false; },
    emit(event, payload, ack) { calls.push({ payload, ack }); },
    event(name, payload) { return handlers.get(name)?.(payload); },
  };
}
const record = (revision = 1) => ({ id: 'tab', path: '/project', revision, options: {} });

test('dropdown catalog keeps the active tab and receives catalog changes', async () => {
  const wire = socket(); let changed = 0;
  const client = createTabClient(wire, () => {}, () => {}, () => changed++);
  const mount = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.event('tab_catalog', { changed: true });
  assert.equal(changed, 0, 'catalog must not detach a tab while mounting');
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mount;
  const catalog = client.catalog();
  assert.equal(wire.calls[1].payload.method, 'tabs.catalog');
  wire.calls[1].ack({ ok: true, result: { tabs: [record()] } });
  assert.equal((await catalog).length, 1);
  assert.equal(client.tab.id, 'tab');
  wire.event('tab_catalog', { changed: true });
  assert.equal(changed, 1);
  client.dispose();
});

test('author ACK does not remount; peer update and reconnect restore without writes', async () => {
  const wire = socket(), seen = [];
  const client = createTabClient(wire, snapshot => seen.push(snapshot), () => {});
  const mounting = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mounting;
  const updating = client.update('/new', {});
  await Promise.resolve();
  wire.calls[1].ack({ ok: true, result: { tab: record(2) } }); await updating;
  assert.equal(seen.length, 0);
  wire.event('tab_snapshot', { tab: record(3) });
  wire.event('tab_snapshot', { tab: record(2) });
  assert.equal(seen.length, 1);
  const reconnect = wire.event('connect');
  assert.equal(wire.calls[2].payload.method, 'tabs.attach');
  wire.calls[2].ack({ ok: true, result: { tab: null } }); await reconnect;
  assert.equal(seen.at(-1), null);
  client.dispose();
});

test('disconnect rejects uncertain mutation and clears buffered writes', async () => {
  const wire = socket();
  const client = createTabClient(wire, () => {}, () => {});
  const mount = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mount;
  const update = client.update('/new', {});
  await Promise.resolve();
  wire.sendBuffer.push('uncertain');
  wire.connected = false; wire.event('disconnect');
  await assert.rejects(update, /connection lost/);
  assert.equal(wire.sendBuffer.length, 0);
  client.dispose();
});

test('failed mutation reads authority and drops older queued writes without replay', async () => {
  const wire = socket();
  const seen = [];
  const client = createTabClient(wire, value => seen.push(value), () => {});
  const mounting = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mounting;
  const first = client.update('/uncertain', {}).catch(error => error);
  const queued = client.update('/queued', {}).catch(error => error);
  await Promise.resolve();
  wire.calls[1].ack({ ok: false, error: 'stale revision' });
  await new Promise(setImmediate);
  assert.equal(wire.calls[2].payload.method, 'tabs.attach');
  wire.calls[2].ack({ ok: true, result: { tab: record(2) } });
  assert.match((await first).message, /stale revision/);
  assert.match((await queued).message, /selection changed/);
  assert.deepEqual(wire.calls.map(call => call.payload.method), ['tabs.attach', 'tabs.update', 'tabs.attach']);
  assert.equal(seen.at(-1).revision, 2);
  client.dispose();
});

test('a newer peer snapshot cannot be overwritten by an older author ACK', async () => {
  const wire = socket(), seen = [];
  const client = createTabClient(wire, value => seen.push(value), () => {});
  const mounting = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mounting;
  const update = client.update('/new', {});
  await Promise.resolve();
  wire.event('tab_snapshot', { tab: record(3) });
  wire.calls[1].ack({ ok: true, result: { tab: record(2) } });
  assert.equal((await update).revision, 3);
  assert.equal(client.tab.revision, 3);
  assert.equal(seen.length, 1);
  client.dispose();
});
