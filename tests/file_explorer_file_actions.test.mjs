import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
const bundle = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/file_actions.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createFileActions } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const entry = { name: 'a.txt', path: '/project/a.txt', type: 'file' };
  let context = { directory: '/project', tabId: 'tab', contextKey: 'tab:1', selected: entry, selectedPaths: new Set([entry.path]), entries: [entry] };
  const calls = [], messages = [], tracking = [];
  const dependencies = { getContext: () => context, files: Object.fromEntries(['mkdir', 'rename', 'delete', 'copy', 'move'].map(name => [name, async (...args) => { calls.push([name, ...args]); return {}; }])),
    dialog: { prompt: async () => 'new-name', confirm: async () => true },
    getPicker: () => picker,
    toast: message => messages.push(message), navigate: url => calls.push(['navigate', url]), download: (...args) => calls.push(['download', ...args]),
    clearSelection: () => calls.push(['clear']), loadDirectory: path => { calls.push(['reload', path]); }, parentPath: path => path.slice(0, path.lastIndexOf('/')) || '/',
  };
  let picker = { openDirectory: async () => ({ path: '/destination' }), saveFile: async () => ({ path: '/destination/copy.txt' }) };
  const controller = createFileActions(dependencies);
  return { controller, dependencies, calls, messages, tracking, get context() { return context; }, set context(value) { context = value; }, get picker() { return picker; }, set picker(value) { picker = value; }, rebuild() { return createFileActions(dependencies); } };
}

test('rename captures the original target while selection changes during prompt', async () => {
  const f = fixture(), prompt = deferred(); f.dependencies.dialog.prompt = () => prompt.promise;
  const pending = f.controller.renameSelected();
  f.context = { ...f.context, selected: { name: 'b.txt', path: '/project/b.txt', type: 'file' }, selectedPaths: new Set(['/project/b.txt']) };
  prompt.resolve('renamed.txt'); await pending;
  assert.deepEqual(f.calls[0], ['rename', '/project/a.txt', 'renamed.txt']);
});

test('tab/directory generation change cancels mutations after dialogs, even after returning', async () => {
  const f = fixture(), prompt = deferred(); f.dependencies.dialog.prompt = () => prompt.promise;
  const pending = f.controller.renameSelected(); f.context = { ...f.context, contextKey: 'tab:3' };
  prompt.resolve('changed'); await pending;
  assert.equal(f.calls.length, 0); assert.match(f.messages[0], /changed/);
});

test('batch delete snapshots targets, reports partial failures, and refreshes origin', async () => {
  const f = fixture(); f.context = { ...f.context, selectedPaths: new Set(['/project/a.txt', '/project/b.txt']) };
  const confirmation = deferred(); f.dependencies.dialog.confirm = () => confirmation.promise;
  f.dependencies.files.delete = async path => { f.calls.push(['delete', path]); if (path.endsWith('b.txt')) throw new Error('denied'); };
  const pending = f.controller.deleteSelected(); f.context.selectedPaths.clear(); f.context.selectedPaths.add('/project/new.txt');
  confirmation.resolve(true); await pending;
  assert.deepEqual(f.calls, [['delete', '/project/a.txt'], ['delete', '/project/b.txt'], ['clear'], ['reload', '/project']]);
  assert.match(f.messages[0], /1 failed/);
});

test('direct copy works only when job capability is absent', async () => {
  const f = fixture(); await f.controller.copySelected();
  assert.deepEqual(f.calls, [['copy', '/project/a.txt', '/destination/a.txt'], ['clear']]);
});

test('uncertain job creation and tracker failure never resend through direct copy/move', async () => {
  for (const kind of ['copySelected', 'moveSelected']) {
    for (const failingPhase of ['create', 'track']) {
      const f = fixture();
      f.dependencies.jobs = { available: () => true, create: async () => { f.calls.push(['job']); if (failingPhase === 'create') throw new Error('ACK lost'); return { id: 'job', status: 'queued' }; }, track: () => { throw new Error('tracker failed'); } };
      await f.rebuild()[kind]();
      assert.deepEqual(f.calls, [['job']]); assert.equal(f.messages.length, 1);
    }
  }
});

test('successful job submission validates identity and preserves observer metadata', async () => {
  const f = fixture();
  f.dependencies.jobs = { available: () => true, create: async (kind, params) => { f.calls.push([kind, params]); return { id: 'job', status: 'queued', progress: 0.5, result: { count: 2 } }; }, track: (job, metadata) => f.tracking.push({ job, metadata }) };
  await f.rebuild().copySelected();
  assert.equal(f.tracking[0].job.progress, 0.5); assert.deepEqual(f.tracking[0].job.result, { count: 2 });
  assert.deepEqual(f.tracking[0].metadata.refreshOnSuccess, ['/destination']);
  assert.deepEqual(f.calls.at(-1), ['clear']);
});

test('invalid successful job DTO is uncertain and must not fall back', async () => {
  const f = fixture(); f.dependencies.jobs = { available: () => true, create: async () => ({ status: 'queued' }), track: () => {} };
  await f.rebuild().copySelected(); assert.equal(f.calls.length, 0); assert.match(f.messages[0], /job identity/);
});

test('single-selection fallback copy uses Save As and single move keeps direct semantics', async () => {
  const f = fixture(); f.context = { ...f.context, selectedPaths: new Set() };
  await f.controller.copySelected(); assert.deepEqual(f.calls[0], ['copy', '/project/a.txt', '/destination/copy.txt']);
  f.calls.length = 0; await f.controller.moveSelected();
  assert.deepEqual(f.calls, [['move', '/project/a.txt', '/destination'], ['clear'], ['reload', '/project']]);
});

test('new-file fallback and download preserve encoded routes and dynamic picker availability', async () => {
  const f = fixture(); f.picker = undefined;
  await f.controller.createNewFile(); assert.deepEqual(f.calls[0], ['navigate', '/app/file_editor?file=%2Fproject%2Fnew-name']);
  f.picker = { saveFile: async () => ({ path: '/new file.txt' }) }; await f.controller.createNewFile();
  assert.deepEqual(f.calls[1], ['navigate', '/app/file_editor?file=%2Fnew%20file.txt']);
  f.controller.downloadSelected(); assert.deepEqual(f.calls[2], ['download', '/api/app/file_explorer/download?path=%2Fproject%2Fa.txt', 'a.txt']);
});

test('picker cancellation and disposal cannot perform subsequent mutations', async () => {
  const f = fixture(); f.picker = { openDirectory: async () => { throw new Error('cancelled'); } };
  await f.controller.copySelected(); assert.equal(f.messages.length, 0);
  const prompt = deferred(); f.dependencies.dialog.prompt = () => prompt.promise;
  const pending = f.controller.createFolder(); f.controller.dispose(); prompt.resolve('folder'); await pending;
  await f.controller.renameSelected(); f.controller.downloadSelected(); assert.equal(f.calls.length, 0);
});

test('completed mutations do not reload or clear a different foreground context', async () => {
  const f = fixture(), mutation = deferred(); f.dependencies.files.rename = async (...args) => { f.calls.push(['rename', ...args]); await mutation.promise; };
  const pending = f.controller.renameSelected(); await Promise.resolve();
  f.context = { ...f.context, directory: '/other', contextKey: 'other:2' }; mutation.resolve(); await pending;
  assert.deepEqual(f.calls, [['rename', '/project/a.txt', 'new-name']]);
});
