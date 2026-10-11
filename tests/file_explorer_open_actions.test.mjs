import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
const { outputFiles } = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/open_actions.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', write: false });
const { createOpenActions } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(overrides = {}) {
  let key = 'tab:cwd:1', selection = { path: '/a.txt', name: 'a.txt', type: 'file', size: 2 };
  const calls = [];
  const actions = createOpenActions({
    files: { resolveSymlink: async path => ({ path, target: path, is_symlink: false }), properties: async () => ({ size: 2 }) },
    snapshot: () => ({ selected: selection, path: '/cwd', showHidden: true }), contextKey: () => key,
    intentsReady: Promise.resolve({ openFile: async path => calls.push(['file', path]), openProject: async path => calls.push(['project', path]), openTerminal: async path => calls.push(['terminal', path]) }),
    loadDirectory: async path => { calls.push(['directory', path]); }, notify: text => calls.push(text), closeMenus() {},
    isArchive: path => path.endsWith('.zip'), isEditableFile: path => path.endsWith('.txt'), maxEditorSize: 100,
    picker: () => ({ openDirectory: async () => ({ path: '/dest' }) }), hasJobSupport: () => true,
    submitExtraction: async (entry, path) => { calls.push(['extract', entry.path, path]); },
    fetch: async () => new Response(JSON.stringify({ ok: true, data: { app_url: '/archive' } })), navigate: url => calls.push(['navigate', url]),
    ...overrides,
  });
  return { actions, calls, change: () => { key = 'tab:cwd:2'; }, select: entry => { selection = entry; } };
}
test('pending intent keeps captured file and refuses obsolete context', async () => {
  const ready = deferred(), calls = [];
  const f = fixture({ intentsReady: ready.promise });
  const opened = f.actions.openSelected(); f.select({ path: '/new.txt', name: 'new.txt', type: 'file', size: 2 });
  ready.resolve({ openFile: async path => calls.push(path) }); await opened;
  assert.deepEqual(calls, ['/a.txt']);
  const wait = deferred(), stale = fixture({ intentsReady: wait.promise });
  const pending = stale.actions.openSelected(); stale.change(); wait.resolve({ openFile: async path => calls.push(path) }); await pending;
  assert.deepEqual(calls, ['/a.txt']);
});
test('stale symlink/properties reads never open or navigate a newer context', async () => {
  const response = deferred();
  const f = fixture({ files: { resolveSymlink: () => response.promise, properties: async () => ({ size: 2 }) } });
  const pending = f.actions.followSymlink({ path: '/link', type: 'symlink' }); f.change();
  response.resolve({ path: '/link', target: '/target', is_symlink: true, target_exists: true, target_type: 'directory' }); await pending;
  assert.deepEqual(f.calls, []);
  const meta = deferred(), g = fixture({ files: { properties: () => meta.promise } });
  g.select({ path: '/unknown.txt', name: 'unknown.txt', type: 'file' });
  const edit = g.actions.openSelectedInEditor(); g.change(); meta.resolve({ size: 2 }); await edit;
  assert.deepEqual(g.calls, []);
});
test('non-symlink resolution accepts missing target_type and editor enforces size/archive restrictions', async () => {
  const f = fixture(); f.select({ path: '/link', name: 'link', type: 'symlink' });
  await f.actions.openSelectedInEditor(); assert.deepEqual(f.calls, [['file', '/link']]);
  f.select({ path: '/large.txt', name: 'large.txt', type: 'file', size: 101 }); await f.actions.openSelectedInEditor();
  assert.equal(f.calls.at(-1), 'File is too large to open in the editor');
  f.select({ path: '/a.zip', name: 'a.zip', type: 'file', size: 1 }); await f.actions.openSelectedInEditor();
  assert.equal(f.calls.at(-1), 'Open archives with the Archive Manager');
});
test('stale picker drops extraction and uncertain job errors never retry through HTTP', async () => {
  const dest = deferred(), f = fixture({ picker: () => ({ openDirectory: () => dest.promise }) });
  const pending = f.actions.extractArchive({ path: '/a.zip', name: 'a.zip', type: 'file' }); f.change(); dest.resolve({ path: '/dest' }); await pending;
  assert.deepEqual(f.calls, []);
  let requests = 0, submissions = 0;
  const g = fixture({ submitExtraction: async () => { submissions++; throw new Error('unknown outcome'); }, fetch: async () => { requests++; } });
  await g.actions.extractArchive({ path: '/a.zip', name: 'a.zip', type: 'file' });
  assert.equal(submissions, 1); assert.equal(requests, 0); assert.deepEqual(g.calls, ['unknown outcome']);
});
test('archive launch guards late navigation and sends captured directory/show-hidden metadata', async () => {
  const result = deferred(); let payload;
  const f = fixture({ fetch: async (_url, options) => { payload = JSON.parse(options.body); return result.promise; } });
  const launched = f.actions.launchArchiveManager('/a.zip', { internal: 'folder' }); f.change();
  result.resolve(new Response(JSON.stringify({ data: { app_url: '/archive' } }))); await launched;
  assert.deepEqual(payload, { archive_path: '/a.zip', filesystem_path: '/cwd', show_hidden: true, internal: 'folder' });
  assert.deepEqual(f.calls, []);
  const g = fixture(); await g.actions.launchArchiveManager('/a.zip'); assert.deepEqual(g.calls, [['navigate', '/archive']]);
  g.actions.dispose(); await g.actions.openInEditor('/gone.txt'); assert.equal(g.calls.length, 1);
});
