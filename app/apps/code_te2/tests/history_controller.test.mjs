import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const bundle = await build({ entryPoints: ['src/explorer/history/controller.ts'], bundle: true, write: false, format: 'esm', plugins: [{ name: 'fixture', setup(b) {
  b.onResolve({ filter: /^\/static\/vendor\/seti-icons\/seti-icons.js$/ }, () => ({ path: 'icons', namespace: 'icons' }));
  b.onLoad({ filter: /.*/, namespace: 'icons' }, () => ({ contents: 'export async function getIcon() { return null; }' }));
  b.onResolve({ filter: /^te2-scm-tree$/ }, () => ({ path: 'tree', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const CompressibleAsyncDataTree = class {};' }));
  b.onLoad({ filter: /history-tree-host\.ts$/ }, () => ({ contents: `export class HistoryTreeHost {
    constructor(container, Tree, input, reader, actions) { Object.assign(this, { input, reader, actions }); this.ready = Promise.resolve(); globalThis.__historyViews.push(this); }
    updateRows(rows) { this.input.rows = rows; return Promise.resolve(); }
    layout() {} dispose() { this.disposed = true; }
  }` }));
} }] });
const { ExplorerHistoryController } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture(run) {
  const win = new Window();
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.__historyViews = [];
  try { await run(win.document.createElement('div'), globalThis.__historyViews); }
  finally { globalThis.ResizeObserver = previous; delete globalThis.__historyViews; await win.happyDOM.close(); }
}
const snapshot = generation => ({ generation, kind: 'snapshot', snapshot: { head_id: 'a'.repeat(40), refs: [] } });
const page = generation => ({ generation, kind: 'page', page: { offset: 0, complete: true, commits: [{ identity: 'a'.repeat(40), subject: 'Root', author: 'Test', parents: [] }] } });
test('early notifications render graph, statistics update in place, file click uses native index', async () => fixture(async (container, views) => {
  const calls = []; let finish;
  const c = new ExplorerHistoryController(async (method, payload) => {
    calls.push([method, payload]);
    if (method.endsWith('.open')) return new Promise(resolve => { finish = resolve; });
    if (method.endsWith('.files')) return { page: { next_offset: null, files: [{ index: 7, status: 'added', new_path: 'a.py', old_path: null, counts: { state: 'ready', additions: 1, deletions: 0 } }] } };
    return { ok: true };
  });
  c.mount(container); c.notify(snapshot(1)); c.notify(page(1)); finish({ generation: 1 }); await settle();
  assert.equal(views.length, 1);
  c.notify({ generation: 1, kind: 'statistics', statistics: { commit_id: 'a'.repeat(40), state: 'ready', known_additions: 1, known_deletions: 0 } });
  assert.equal(views.length, 1);
  assert.equal(views[0].input.rows[0].counts.additions, 1);
  const files = await views[0].reader({ commitId: 'a'.repeat(40) }, new AbortController().signal);
  await views[0].actions.openFile({ ...files[0], historyItemViewModel: views[0].input.rows[0].historyItemViewModel });
  assert.deepEqual(calls.at(-1), ['explorer.history.openFile', { generation: 1, commitId: 'a'.repeat(40), index: 7 }]);
  c.dispose(); assert.equal(views[0].disposed, true);
  assert.equal(calls.at(-1)[0], 'explorer.history.close');
}));
test('closing before open acknowledgement still releases native generation', async () => fixture(async (container) => {
  let finish; const calls = [];
  const c = new ExplorerHistoryController(async (method, payload) => {
    calls.push([method, payload]);
    if (method.endsWith('.open')) return new Promise(resolve => { finish = resolve; });
    return {};
  });
  c.mount(container); c.dispose(); finish({ generation: 4 }); await settle();
  assert.deepEqual(calls.at(-1), ['explorer.history.close', { generation: 4 }]);
}));
test('new snapshot replaces tree and old events cannot overwrite it', async () => fixture(async (container, views) => {
  const c = new ExplorerHistoryController(async () => ({ generation: 1 }));
  c.mount(container); await settle(); c.notify(snapshot(1)); c.notify(page(1));
  c.notify(snapshot(2)); c.notify(page(2)); c.notify(page(1));
  assert.equal(views.length, 2); assert.equal(views[0].disposed, true);
  assert.equal(views[1].input.rows.length, 1); c.dispose();
}));
test('reconnect opens a fresh generation and fences old notifications', async () => fixture(async (container, views) => {
  let generation = 0;
  const c = new ExplorerHistoryController(async method => method.endsWith('.open') ? { generation: ++generation } : {});
  c.mount(container); await settle(); c.notify(snapshot(1)); c.notify(page(1));
  c.reconnect(); await settle(); c.notify(page(1)); c.notify(snapshot(2)); c.notify(page(2));
  assert.equal(views.length, 2); assert.equal(views[0].disposed, true);
  assert.equal(views[1].input.id, '2'); c.dispose();
}));
test('file expansion rejects non-advancing continuation instead of spinning', async () => fixture(async (container, views) => {
  const c = new ExplorerHistoryController(async method => method.endsWith('.open')
    ? { generation: 1 } : { page: { files: [], next_offset: 0 } });
  c.mount(container); await settle(); c.notify(snapshot(1)); c.notify(page(1));
  await assert.rejects(views[0].reader({ commitId: 'a'.repeat(40) }, new AbortController().signal), /did not advance/);
  c.dispose();
}));
test('native idle expiry removes actionable stale rows without reopening or polling', async () => fixture(async (container, views) => {
  let opens = 0;
  const c = new ExplorerHistoryController(async method => {
    if (method.endsWith('.open')) opens++;
    return { generation: 1 };
  });
  c.mount(container); await settle(); c.notify(snapshot(1)); c.notify(page(1));
  c.notify({ generation: 1, kind: 'expired', error: 'History session expired' });
  c.notify({ generation: 1, kind: 'statistics', statistics: { commit_id: 'a'.repeat(40), state: 'computing' } });
  assert.equal(views[0].disposed, true); assert.equal(opens, 1);
  assert.equal(views.length, 1, 'late statistics cannot revive an expired tree');
  assert.match(container.textContent, /refreshing when visible/); c.dispose();
}));
test('one uncounted file does not erase the known commit total', async () => fixture(async (container, views) => {
  const c = new ExplorerHistoryController(async () => ({ generation: 1 }));
  c.mount(container); await settle(); c.notify(snapshot(1)); c.notify(page(1));
  c.notify({ generation: 1, kind: 'statistics', statistics: { commit_id: 'a'.repeat(40),
    state: 'incomplete', known_additions: 42, known_deletions: 7, unknown_files: 1 } });
  assert.deepEqual(views[0].input.rows[0].counts, { state: 'partial', additions: 42, deletions: 7, unknownFiles: 1 });
  c.dispose();
}));
test('idle expiry refreshes once on foreground visibility and never retries a failed open', async () => fixture(async (container) => {
  let opens = 0, hidden = true;
  const doc = container.ownerDocument;
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
  const c = new ExplorerHistoryController(async method => {
    if (method.endsWith('.open')) {
      if (++opens > 1) throw Error('offline');
      return { generation: opens };
    }
    return {};
  });
  c.mount(container); await settle();
  container.firstElementChild.getBoundingClientRect = () => ({ width: 200, height: 200, top: 0, left: 0, bottom: 200, right: 200 });
  c.notify(snapshot(1)); c.notify(page(1));
  c.notify({ generation: 1, kind: 'expired' });
  assert.equal(opens, 1);
  hidden = false; doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'));
  await settle(); assert.equal(opens, 2); assert.match(container.textContent, /offline/);
  doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'));
  await settle(); assert.equal(opens, 2);
  c.dispose(); doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'));
  assert.equal(opens, 2);
}));
test('visible expiry immediately opens a new generation without replaying old file intent', async () => fixture(async (container, views) => {
  let opens = 0;
  const doc = container.ownerDocument;
  Object.defineProperty(doc, 'hidden', { configurable: true, value: false });
  const c = new ExplorerHistoryController(async method => {
    if (method.endsWith('.open')) return { generation: ++opens };
    return {};
  });
  c.mount(container); await settle();
  container.firstElementChild.getBoundingClientRect = () => ({ width: 200, height: 200, top: 0, left: 0, bottom: 200, right: 200 });
  c.notify(snapshot(1)); c.notify(page(1)); c.notify({ generation: 1, kind: 'expired' });
  await settle(); assert.equal(opens, 2); assert.equal(views[0].disposed, true);
  c.notify(snapshot(2)); c.notify(page(2));
  assert.equal(views.length, 2); assert.equal(views[1].input.id, '2'); c.dispose();
}));
test('snapshot refs name local heads, group remote icons, and color the active unbranched lane', async () => fixture(async (container, views) => {
  const c = new ExplorerHistoryController(async () => ({ generation: 1 }));
  c.mount(container); await settle();
  c.notify({ generation: 1, kind: 'snapshot', snapshot: {
    head_id: 'a'.repeat(40), head_ref: 'refs/heads/feature', refs: [
      { name: 'refs/heads/feature', commit_id: 'a'.repeat(40) },
      { name: 'refs/heads/main', commit_id: 'b'.repeat(40) },
      { name: 'refs/remotes/origin/main', commit_id: 'b'.repeat(40) },
      { name: 'refs/remotes/other/main', commit_id: 'b'.repeat(40) }
    ] } });
  c.notify({ generation: 1, kind: 'page', page: { offset: 0, complete: true, commits: [
    { identity: 'a'.repeat(40), parents: ['b'.repeat(40)], subject: 'Feature', author: 'A' },
    { identity: 'b'.repeat(40), parents: [], subject: 'Main', author: 'A' }
  ] } });
  const [feature, main] = views[0].input.rows.map(row => row.historyItemViewModel);
  assert.equal(feature.historyItem.references[0].name, 'feature');
  assert.equal(feature.historyItem.references[0].icon.id, 'git-branch');
  assert.equal(feature.historyItem.references[0].color, feature.outputSwimlanes[0].color);
  assert.equal(feature.outputSwimlanes[0].color, 'scmGraph.historyItemRefColor');
  assert.equal(main.historyItem.references.filter(ref => ref.icon.id === 'cloud').length, 2);
  c.dispose();
}));
test('native upstream and base roles color their lanes and labels independently', async () => fixture(async (container, views) => {
  const c = new ExplorerHistoryController(async () => ({ generation: 1 }));
  c.mount(container); await settle();
  const current = { name: 'refs/heads/topic', commit_id: 'a'.repeat(40) };
  const remote = { name: 'refs/remotes/origin/topic', commit_id: 'b'.repeat(40) };
  const base = { name: 'refs/remotes/origin/trunk', commit_id: 'c'.repeat(40) };
  c.notify({ generation: 1, kind: 'snapshot', snapshot: { head_id: current.commit_id,
    head_ref: current.name, refs: [current, remote, base], upstream_ref: remote, base_ref: base } });
  c.notify({ generation: 1, kind: 'page', page: { offset: 0, complete: true, commits: [
    { identity: current.commit_id, parents: [remote.commit_id], subject: 'Current', author: 'A' },
    { identity: remote.commit_id, parents: [base.commit_id], subject: 'Pushed', author: 'A' },
    { identity: base.commit_id, parents: ['d'.repeat(40)], subject: 'Base', author: 'A' },
    { identity: 'd'.repeat(40), parents: [], subject: 'Root', author: 'A' }
  ] } });
  const models = views[0].input.rows.map(row => row.historyItemViewModel);
  for (const [index, color] of ['scmGraph.historyItemRefColor', 'scmGraph.historyItemRemoteRefColor', 'scmGraph.historyItemBaseRefColor'].entries()) {
    assert.equal(models[index].outputSwimlanes[0].color, color);
    assert.equal(models[index].historyItem.references[0].color, color);
  }
  c.dispose();
}));
