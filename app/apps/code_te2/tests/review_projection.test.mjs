import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const built = await build({ stdin: { contents: `export * from './src/explorer/search/review-projection.ts'; export * from './src/explorer/search/review-results-renderer.ts'; export * from './src/explorer/search/overlay-body-renderer.ts';`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const row = rel => ({ rel, identity: rel, has_draft: true, hunks: [{ oldStart: 1, newStart: 1, oldLines: 1, newLines: 1, lines: [{ type: 'add-draft', text: rel }] }] });
const snapshot = (revision, entries, overrides = {}) => ({ complete: true, projectRoot: '/project', projectGeneration: 1, projectionId: 'worker1', revision, entries, ...overrides });

test('complete snapshots evict one item, preserve another and reject acknowledgements/stale input', () => {
  const mirror = api.createReviewProjection();
  const first = mirror.apply(snapshot(1, [row('one'), row('two')]), '/project');
  const second = mirror.apply(snapshot(2, [row('two')]), '/project');
  assert.equal(second.length, 1);
  assert.equal(second[0], first[1]);
  assert.equal(mirror.apply({ discarded_count: 1 }, '/project'), null);
  assert.equal(mirror.apply({ entries: [] }, '/project'), null);
  assert.equal(mirror.apply(snapshot(1, []), '/project'), null);
  assert.equal(mirror.apply(snapshot(3, [], { projectRoot: '/other' }), '/project'), null);
  assert.equal(mirror.apply(snapshot(3, [{ rel: 'bad' }]), '/project'), null);
  assert.equal(mirror.apply(snapshot(2, [row('two')]), '/project')[0], second[0]);
  assert.deepEqual(mirror.apply(snapshot(3, []), '/project'), []);
});

test('worker reconnect accepts a new epoch but rejects retired worker/project generations', () => {
  const mirror = api.createReviewProjection();
  mirror.apply(snapshot(10, [row('one')], { projectGeneration: 2 }), '/project');
  assert.equal(mirror.apply(snapshot(11, [], { projectGeneration: 1 }), '/project'), null);
  assert.equal(mirror.apply(snapshot(1, [row('two')], { projectionId: 'worker2' }), '/project').length, 1);
  assert.equal(mirror.apply(snapshot(11, [], { projectionId: 'worker1' }), '/project'), null);
  assert.equal(mirror.apply(snapshot(12, []), '/other'), null);
});

test('refresh and discard retain the unaffected rendered group and its selected state', () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  const root = document.createElement('div'); document.body.append(root);
  try {
    const renderer = api.createExplorerReviewResultsRenderer({});
    const deps = { renderReviewResults: renderer.renderReviewResults };
    api.renderSearchOverlayBody(root, { searchMode: 'review', searchResults: { results: [row('one'), row('two')] } }, deps);
    const retained = root.querySelector('[data-rel="two"]');
    const check = retained.querySelector('input'); check.checked = true; check.dispatchEvent(new win.Event('change'));
    api.renderSearchOverlayBody(root, { searchMode: 'review', searchLoading: true, searchResults: { results: [row('one'), row('two')] } }, deps);
    assert.equal(root.querySelector('[data-rel="two"]'), retained);
    api.renderSearchOverlayBody(root, { searchMode: 'review', searchResults: { results: [row('two')] } }, deps);
    assert.equal(root.querySelector('[data-rel="two"]'), retained);
    assert.equal(root.querySelector('[data-rel="one"]'), null);
    assert.equal(check.checked, true);
    assert.match(root.textContent, /two/);
    [...root.querySelectorAll('button')].find(button => button.textContent === 'Clear Selection').click();
    assert.equal(check.checked, false);
  } finally { win.happyDOM.abort(); }
});
