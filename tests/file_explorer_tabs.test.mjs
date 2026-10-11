import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
const bundle = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/tab_client.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { mountIntent, tabUrl, createTabClient } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
import { packObject, unpackObject } from '../app/static/js/file_explorer_codec.js';

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
    emit(event, raw, ack) {
      assert.ok(raw instanceof Uint8Array);
      const payload = unpackObject(raw);
      calls.push({ payload, ack: reply => ack(packObject({ id: payload.id, ...reply })) });
    },
    event(name, payload) { return handlers.get(name)?.(payload ? packObject(payload) : undefined); },
  };
}

test('MessagePack rejects text and non-object frames; requests reject mismatched correlation', async () => {
  assert.throws(() => unpackObject('{}'));
  assert.throws(() => unpackObject(packObject([1, 2])));
  assert.throws(() => unpackObject(packObject(new Uint8Array([1]))));
  const wire = socket();
  wire.emit = (_event, raw, ack) => {
    const request = unpackObject(raw);
    ack(packObject({ id: request.id + 1, ok: true, result: {} }));
  };
  const client = createTabClient(wire, () => {}, () => {});
  await assert.rejects(client.request('tabs.list'), /id mismatch/);
  client.dispose();
});

test('relative Sidebar publication saves a restorable tab reference or identity-free splash', () => {
  for (const base of ['http://127.0.0.1:64926/app/file_explorer', 'http://localhost:8089/app/file_explorer']) {
    const pathUrl = '/app/file_explorer?embed=1&path=%2Fproject&te2_host_id=slot&te2_token_id=file_explorer';
    const restored = tabUrl(pathUrl, 'existing', base);
    assert.equal(restored.origin, new URL(base).origin);
    assert.equal(restored.searchParams.get('te2_host_id'), 'slot');
    assert.equal(restored.searchParams.has('path'), false);
    assert.deepEqual(mountIntent(restored), { kind: 'attach', tabId: 'existing' });
    const splash = tabUrl(pathUrl, '', base);
    assert.deepEqual(mountIntent(splash), { kind: 'splash' });
  }
});
const options = { showHidden: false, view: 'list', sortBy: 'name', sortAsc: true };
const record = (revision = 1) => ({ id: 'tab', path: '/project', revision, options: { ...options }, shellId: null, directoryLocked: true, shellTrackingId: null });

test('terminal association ACK advances the shared mutation lane before path updates', async () => {
  const wire = socket(), seen = [];
  const client = createTabClient(wire, value => seen.push(value), () => {});
  const mounting = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await mounting;
  const start = client.terminal('terminal.start');
  const update = client.update('/next', options);
  await Promise.resolve();
  assert.equal(wire.calls[1].payload.params.revision, 1);
  wire.calls[1].ack({ ok: true, result: { tab: { ...record(2), shellId: 'shell' } } }); await start;
  await new Promise(setImmediate);
  assert.equal(wire.calls[2].payload.params.revision, 2);
  wire.calls[2].ack({ ok: true, result: { tab: { ...record(3), shellId: 'shell' } } }); await update;
  assert.equal(seen[0].shellId, 'shell');
  const closing = client.close(client.tab, true);
  assert.equal(wire.calls[3].payload.params.closeTerminal, true);
  wire.calls[3].ack({ ok: true, result: { closedId: 'tab' } }); await closing;
  client.dispose();
});

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
  const updating = client.update('/new', options);
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
  const update = client.update('/new', options);
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
  const first = client.update('/uncertain', options).catch(error => error);
  const queued = client.update('/queued', options).catch(error => error);
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
  const update = client.update('/new', options);
  await Promise.resolve();
  wire.event('tab_snapshot', { tab: record(3) });
  wire.calls[1].ack({ ok: true, result: { tab: record(2) } });
  assert.equal((await update).revision, 3);
  assert.equal(client.tab.revision, 3);
  assert.equal(seen.length, 1);
  client.dispose();
});

test('a stale concurrent mount ACK cannot replace the newer active tab', async () => {
  const wire = socket(), client = createTabClient(wire, () => {}, () => {});
  const older = client.mount({ kind: 'attach', tabId: 'old' }).catch(error => error);
  const newer = client.mount({ kind: 'attach', tabId: 'new' });
  wire.calls[1].ack({ ok: true, result: { tab: { ...record(), id: 'new' } } });
  await newer;
  wire.calls[0].ack({ ok: true, result: { tab: { ...record(), id: 'old' } } });
  assert.match((await older).message, /selection changed/);
  assert.equal(client.tab.id, 'new'); client.dispose();
});

test('closing the active tab fences pending same-identity mount completion', async () => {
  const wire = socket(), client = createTabClient(wire, () => {}, () => {});
  const initial = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await initial;
  const pending = client.mount({ kind: 'attach', tabId: 'tab' }).catch(error => error);
  wire.event('tab_snapshot', { tab: null, closedId: 'tab' });
  wire.calls[1].ack({ ok: true, result: { tab: record() } });
  assert.match((await pending).message, /selection changed/);
  assert.equal(client.tab, null); client.dispose();
});

test('null create and attach results are valid but incomplete records are rejected', async () => {
  const wire = socket(), errors = [], client = createTabClient(wire, () => {}, error => errors.push(error));
  const creation = client.mount({ kind: 'create', path: '/project' }, options, 'once');
  wire.calls[0].ack({ ok: true, result: { tab: null } }); assert.equal(await creation, null);
  const attachment = client.mount({ kind: 'attach', tabId: 'missing' });
  wire.calls[1].ack({ ok: true, result: { tab: null } }); assert.equal(await attachment, null);
  const invalid = client.mount({ kind: 'attach', tabId: 'bad' });
  wire.calls[2].ack({ ok: true, result: { tab: { id: 'bad', path: '/bad', revision: 1, options: {} } } });
  await assert.rejects(invalid, /Invalid/);
  wire.event('tab_snapshot', {}); assert.equal(errors.length, 1); assert.equal(client.tab, null);
  client.dispose();
});

test('same-tab remount fences an older in-flight mutation ACK without replay', async () => {
  const wire = socket(), seen = [], client = createTabClient(wire, value => seen.push(value), () => {});
  const firstMount = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[0].ack({ ok: true, result: { tab: record() } }); await firstMount;
  const update = client.update('/old-intent', options).catch(error => error);
  await Promise.resolve();
  const remount = client.mount({ kind: 'attach', tabId: 'tab' });
  wire.calls[2].ack({ ok: true, result: { tab: record(3) } }); await remount;
  wire.calls[1].ack({ ok: true, result: { tab: record(4) } });
  assert.match((await update).message, /selection changed/);
  assert.equal(client.tab.revision, 3); assert.equal(wire.calls.length, 3); assert.equal(seen.length, 0);
  client.dispose();
});

test('synchronous emit failures reject immediately and leave no pending request timer', async () => {
  const wire = socket(), client = createTabClient(wire, () => {}, () => {});
  wire.emit = () => { throw new Error('emit failed'); };
  await assert.rejects(client.request('tabs.list'), /emit failed/); client.dispose();
});
