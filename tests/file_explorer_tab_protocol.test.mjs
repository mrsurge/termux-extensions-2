import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
const bundle = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/tab_protocol.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const protocol = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const options = { showHidden: false, view: 'list', sortBy: 'name', sortAsc: true };
const tab = { id: 'tab', path: '/', revision: 1, options, shellId: null, directoryLocked: true, shellTrackingId: null };

test('tab protocol validates DTO fields rather than trusting object shape', () => {
  assert.deepEqual(protocol.decodeTabRecord(tab), tab);
  for (const invalid of [null, [], { ...tab, revision: true }, { ...tab, revision: 0 }, { ...tab, revision: 1.5 }, { ...tab, options: { ...options, view: 'other' } }, { ...tab, directoryLocked: 'true' }, { ...tab, shellTrackingId: 'a'.repeat(32) }, { ...tab, shellId: 'shell', shellTrackingId: 'z'.repeat(32) }]) {
    assert.throws(() => protocol.decodeTabRecord(invalid));
  }
  assert.equal(protocol.decodeTabRecord({ ...tab, shellId: 'shell', shellTrackingId: 'a'.repeat(32) }).shellTrackingId, 'a'.repeat(32));
});

test('method DTOs distinguish nullable mounts, definite updates and catalog records', () => {
  assert.deepEqual(protocol.decodeMethodResult('tabs.create', { tab: null }), { tab: null });
  assert.deepEqual(protocol.decodeMethodResult('tabs.attach', { tab: null }), { tab: null });
  assert.throws(() => protocol.decodeMethodResult('tabs.update', { tab: null }));
  assert.deepEqual(protocol.decodeMethodResult('tabs.catalog', { tabs: [tab] }), { tabs: [tab] });
  assert.throws(() => protocol.decodeMethodResult('tabs.list', { tabs: [{}] }));
  assert.throws(() => protocol.decodeMethodResult('tabs.defaultPath', { path: '' }));
});

test('snapshot closes require an explicit identity and replies require boolean status', () => {
  assert.deepEqual(protocol.decodeSnapshot({ tab: null, closedId: 'tab' }), { tab: null, closedId: 'tab' });
  assert.throws(() => protocol.decodeSnapshot({ tab: null }));
  assert.throws(() => protocol.decodeResponse({ id: 1, ok: 'yes', result: { tabs: [] } }, 1, 'tabs.list'));
  assert.throws(() => protocol.decodeResponse({ id: 2, ok: true, result: { tabs: [] } }, 1, 'tabs.list'), /id mismatch/);
});

test('terminal DTOs enforce method-specific result fields and binary checkpoint content', () => {
  assert.deepEqual(protocol.decodeMethodResult('terminal.start', { tab }), { tab });
  assert.throws(() => protocol.decodeMethodResult('terminal.start', {}));
  assert.throws(() => protocol.decodeMethodResult('terminal.stream', { shellId: 'shell' }));
  const checkpoint = { shellId: 'shell', ansi: '', pendingBytes: new Uint8Array(), outputOffset: 0, columns: 80, rows: 24, directoryTracking: { state: 'ready', path: '' } };
  assert.deepEqual(protocol.decodeMethodResult('terminal.checkpoint', checkpoint), checkpoint);
  assert.throws(() => protocol.decodeMethodResult('terminal.checkpoint', { ...checkpoint, pendingBytes: 'base64' }));
  assert.throws(() => protocol.decodeMethodResult('terminal.unknown', {}));
});
