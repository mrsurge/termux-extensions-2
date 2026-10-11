import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../app/apps/file_explorer/src/api.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false });
const { directoryListingDto, symlinkResolutionDto, filePropertiesDto, createFileExplorerApi } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const entry = { name: 'a', path: '/a', type: 'unknown', size: null, mtime: null, mode: null, owner: null, group: 1000 };
test('listing accepts host-unwrapped DTO and legacy array; normalizes null without narrowing unknown kind', () => {
  const expected = { name: 'a', path: '/a', type: 'unknown', group: 1000 };
  assert.deepEqual(directoryListingDto({ path: '/', entries: [entry] }, '/ignored'), { path: '/', entries: [expected] });
  assert.deepEqual(directoryListingDto([entry], '/requested'), { path: '/requested', entries: [expected] });
  assert.throws(() => directoryListingDto({ ok: true, data: { path: '/', entries: [] } }, '/'), /expected entries/);
});
test('malformed DTOs are errors, not silently empty directories', () => {
  for (const raw of [null, [], { path: '/', entries: {} }, { path: '/', entries: [{ name: 'bad', path: 4, type: 'file' }] }, { path: '/', entries: [{ ...entry, size: '10' }] }]) {
    if (Array.isArray(raw)) continue; // Empty legacy listings are valid.
    assert.throws(() => directoryListingDto(raw, '/'), /Invalid/);
  }
});
test('symlink discriminant accepts real non-link response and requires linked target facts', () => {
  assert.deepEqual(symlinkResolutionDto({ path: '/a', target: '/a', is_symlink: false }), { path: '/a', target: '/a', is_symlink: false });
  const linked = { path: '/a', target: '/b', is_symlink: true, target_exists: false, target_type: 'unknown' };
  assert.deepEqual(symlinkResolutionDto(linked), linked);
  assert.throws(() => symlinkResolutionDto({ path: '/a', target: '/b', is_symlink: true }), /target_exists/);
});
test('properties validates nested permission booleans and numeric identities', () => {
  const bits = { read: true, write: false, exec: false };
  const raw = { path: '/a', name: 'a', type: 'file', is_directory: false, is_symlink: false, size: 1, mtime: 0, mode_octal: '644', mode_int: 420, owner: 1000, group: 'users', permissions: { owner: bits, group: bits, others: bits } };
  assert.deepEqual(filePropertiesDto(raw), raw);
  assert.throws(() => filePropertiesDto({ ...raw, permissions: { ...raw.permissions, owner: { ...bits, read: 1 } } }), /permission read/);
  assert.throws(() => filePropertiesDto({ ...raw, mtime: Infinity }), /finite number/);
});
test('facade encodes query, consumes unwrapped data and sends mutations exactly once', async () => {
  const calls = []; const failure = new Error('uncertain mutation failure');
  const api = createFileExplorerApi({ get: async endpoint => { calls.push(endpoint); return { path: '/a b', entries: [] }; }, post: async (endpoint, body) => { calls.push([endpoint, body]); throw failure; } });
  assert.deepEqual(await api.list('/a b', true), { path: '/a b', entries: [] });
  assert.equal(calls[0], 'list?path=%2Fa%20b&hidden=1');
  await assert.rejects(api.delete('/a'), error => error === failure); assert.deepEqual(calls[1], ['delete', { path: '/a' }]); assert.equal(calls.length, 2);
});
test('chown preserves user request field; chmod/sidebar response validates once', async () => {
  const calls = []; const api = createFileExplorerApi({ get: async () => { throw new Error('unused'); }, post: async (endpoint, body) => {
    calls.push([endpoint, body]);
    if (endpoint === 'chown') return { path: '/a', owner: 'alice', group: 'users' };
    if (endpoint === 'chmod') return { path: '/a', mode: '644', recursive: false };
    return { sidebar: { ok: true } };
  } });
  await api.chown('/a', 'alice', 'users'); assert.deepEqual(calls[0], ['chown', { path: '/a', user: 'alice', group: 'users' }]);
  await api.chmod('/a', '644', false); assert.deepEqual(calls[1], ['chmod', { path: '/a', mode: '644', recursive: false }]);
  assert.deepEqual(await api.sidebarState({ opaque: true }), { sidebar: { ok: true } });
});
