import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['main_page/frontend/secondary-content-lifecycle.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { SecondaryContentLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const content = (revision = 1) => ({ kind: 'historicalDiff', revision, projectPath: '/project', projectGeneration: 2, snapshotId: 'a'.repeat(64), commitId: 'b'.repeat(40), parentId: null, fileIndex: 0, original: { state: 'absent', path: null, id: null, text: null }, modified: { state: 'text', path: 'file.py', id: 'c'.repeat(40), text: 'hello\n' } });
function harness(mount) {
  let reloads = 0, mounts = 0, disposals = 0;
  const lifecycle = new SecondaryContentLifecycle({ reload: () => reloads++, mount: mount || (async () => { mounts++; return { dispose: () => disposals++ }; }) });
  return { lifecycle, counts: () => ({ reloads, mounts, disposals }) };
}
test('working updates never mount history', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.apply(null), 'working');
  assert.equal(await h.lifecycle.apply(undefined), 'working');
  assert.deepEqual(h.counts(), { reloads: 0, mounts: 0, disposals: 0 });
});
test('history reconnect reuses view; new revision replaces it', async () => {
  const h = harness();
  await h.lifecycle.apply(content()); await h.lifecycle.apply(content()); await h.lifecycle.apply(content(2));
  assert.deepEqual(h.counts(), { reloads: 0, mounts: 2, disposals: 1 });
  h.lifecycle.dispose(); assert.equal(h.counts().disposals, 2);
});
test('cross-kind transitions reload once', async () => {
  for (const initial of [null, content()]) {
    const h = harness(); await h.lifecycle.apply(initial);
    assert.equal(await h.lifecycle.apply(initial ? null : content()), 'reload');
    assert.equal(await h.lifecycle.apply(content(2)), 'superseded');
    assert.equal(h.counts().reloads, 1);
  }
});
test('supersession aborts and disposes late mounts', async () => {
  const pending = [], disposed = [];
  const h = harness((c, signal) => new Promise(resolve => pending.push({ c, signal, resolve })));
  const first = h.lifecycle.apply(content(1)); const second = h.lifecycle.apply(content(2));
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ dispose: () => disposed.push(2) }); await second;
  pending[0].resolve({ dispose: () => disposed.push(1) });
  assert.equal(await first, 'superseded'); assert.deepEqual(disposed, [1]);
  h.lifecycle.dispose(); assert.deepEqual(disposed, [1, 2]);
});
test('boot retries and malformed content fails closed', async () => {
  let attempts = 0;
  const h = harness(async () => { if (++attempts === 1) throw Error('boot failed'); return { dispose() {} }; });
  await assert.rejects(h.lifecycle.apply(content()), /boot failed/);
  assert.equal(await h.lifecycle.apply(content()), 'historical');
  await assert.rejects(h.lifecycle.apply({ kind: 'oops' }));
  assert.equal(h.lifecycle.historical, true); assert.equal(h.counts().reloads, 0);
});
test('page disposal aborts pending mount', async () => {
  let finish, signal, disposals = 0;
  const h = harness((_, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  const pending = h.lifecycle.apply(content()); h.lifecycle.dispose();
  assert.equal(signal.aborted, true); finish({ dispose: () => disposals++ });
  assert.equal(await pending, 'superseded'); assert.equal(disposals, 1);
  assert.equal(await h.lifecycle.apply(null), 'superseded');
});
