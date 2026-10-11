import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../app/apps/file_explorer/src/properties.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { createPropertiesController, modeToPermissions, permissionsToMode } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const template = await readFile(new URL('../app/apps/file_explorer/src/template.html', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const entry = path => ({ path, name: path.split('/').pop(), type: 'file' });
const metadata = path => ({ ...entry(path), is_directory: false, is_symlink: false, size: 1, mtime: 0, mode_int: 420, mode_octal: '644', owner: 0, group: 0, permissions: modeToPermissions(420) });
function fixture(overrides = {}) {
  const window = new Window(); window.document.body.innerHTML = template;
  const root = window.document.querySelector('[data-app-root]'); const notifications = [], calls = [];
  let identity = 'tab:/';
  const files = { properties: async path => metadata(path), rename: async (path, name) => { calls.push(['rename', path, name]); }, chmod: async (...args) => { calls.push(['chmod', ...args]); }, chown: async (...args) => { calls.push(['chown', ...args]); }, ...overrides };
  const controller = createPropertiesController({ container: root, files, selectedEntry: () => entry('/a'), currentDirectory: () => '/', refreshDirectory: async path => calls.push(['refresh', path]), notify: text => notifications.push(text), parentPath: () => '/', joinPath: (parent, name) => parent + name, getContextKey: () => identity });
  const input = role => root.querySelector(`[data-role="${role}"]`);
  const modal = root.querySelector('[data-modal="properties"]');
  return { controller, input, modal, calls, notifications, window, changeIdentity: value => { identity = value; } };
}
test('permission bits roundtrip every rwx combination', () => { for (let mode = 0; mode < 512; mode++) assert.equal(permissionsToMode(modeToPermissions(mode)), mode); assert.equal(permissionsToMode(modeToPermissions('755')), 493); });
test('zero numeric identities display and symlink directories disallow recursion', async () => {
  const f = fixture({ properties: async path => ({ ...metadata(path), is_directory: true, is_symlink: true }) });
  await f.controller.openSelected(); assert.equal(f.input('properties-owner-input').value, '0'); assert.equal(f.input('properties-group-current').textContent, '0'); assert.equal(f.input('properties-recurse').disabled, true); f.controller.dispose();
});
test('newer properties request wins and close suppresses pending reopen', async () => {
  const a = deferred(), b = deferred(); const f = fixture({ properties: path => path === '/a' ? a.promise : b.promise });
  const first = f.controller.show(entry('/a')), second = f.controller.show(entry('/b'));
  b.resolve(metadata('/b')); await second; a.resolve(metadata('/a')); await first; assert.equal(f.input('properties-name').value, 'b');
  const c = deferred(); const g = fixture({ properties: () => c.promise }); const pending = g.controller.openSelected(); g.controller.close(); c.resolve(metadata('/a')); await pending; assert.equal(g.modal.dataset.open, undefined); f.controller.dispose(); g.controller.dispose();
});
test('close cancels delayed focus and parent identity suppresses fetched response', async () => {
  const f = fixture(); await f.controller.openSelected(); f.controller.close(); await new Promise(resolve => setTimeout(resolve, 55)); assert.notEqual(f.window.document.activeElement, f.input('properties-name'));
  const d = deferred(); const g = fixture({ properties: () => d.promise }); const pending = g.controller.openSelected(); g.changeIdentity('other'); d.resolve(metadata('/a')); await pending; assert.equal(g.modal.dataset.open, undefined); f.controller.dispose(); g.controller.dispose();
});
test('apply mutation order uses renamed target and preserves one-shot duplicate guard', async () => {
  const gate = deferred(); const f = fixture({ rename: async (path, name) => { f.calls.push(['rename', path, name]); await gate.promise; } });
  await f.controller.openSelected(); f.input('properties-name').value = 'b'; f.input('perm-owner-exec').checked = true; f.input('properties-owner-input').value = 'alice';
  const first = f.controller.apply(); await f.controller.apply(); assert.equal(f.calls.length, 1); gate.resolve(); await first;
  assert.deepEqual(f.calls, [['rename', '/a', 'b'], ['chmod', '/b', '744', false], ['chown', '/b', 'alice', ''], ['refresh', '/']]); assert.equal(f.modal.dataset.open, undefined); f.controller.dispose();
});
test('close during issued mutation stops subsequent operations without undo or changing new dialog', async () => {
  const gate = deferred(); const f = fixture({ rename: async (...args) => { f.calls.push(['rename', ...args]); await gate.promise; } });
  await f.controller.openSelected(); f.input('properties-name').value = 'renamed'; f.input('perm-owner-exec').checked = true; const pending = f.controller.apply();
  f.controller.close(); await f.controller.show(entry('/new')); gate.resolve(); await pending;
  assert.deepEqual(f.calls, [['rename', '/a', 'renamed']]); assert.equal(f.input('properties-name').value, 'new'); assert.equal(f.modal.dataset.open, 'true'); f.controller.dispose();
});
test('failed mutation halts pipeline, reports error, and releases applying UI', async () => {
  const f = fixture({ rename: async () => { throw new Error('rename denied'); } }); await f.controller.openSelected(); f.input('properties-name').value = 'b'; f.input('perm-owner-exec').checked = true;
  await f.controller.apply(); assert.deepEqual(f.calls, []); assert.equal(f.notifications.at(-1), 'rename denied'); assert.equal(f.modal.querySelector('[data-action="properties-apply"]').disabled, false); f.controller.dispose();
});
test('unchanged apply leaves dialog open and emits no mutation', async () => {
  const f = fixture(); await f.controller.openSelected(); await f.controller.apply(); assert.deepEqual(f.calls, []); assert.equal(f.notifications.at(-1), 'No changes to apply'); assert.equal(f.modal.dataset.open, 'true'); f.controller.dispose();
});
