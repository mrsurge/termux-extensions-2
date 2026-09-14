import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function source(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { changeStatistics, totalChangeStatistics } = await source('src/explorer/search/change-statistics.ts');
const { createExplorerChangesResultsRenderer } = await source('src/explorer/search/changes-results-renderer.ts');
const { renderSearchOverlayBody } = await source('src/explorer/search/overlay-body-renderer.ts');
const large = { rel: 'host.js', status: 'M', hunks: [], summary: { added: 305, deleted: 305, contentSuppressed: true } };

test('suppressed summaries survive preview warnings and totals distinguish untracked', () => {
  assert.deepEqual(changeStatistics({ ...large, error: 'Preview exceeds limit' }), { added: 305, deleted: 305 });
  assert.equal(changeStatistics({ error: 'Git failed', hunks: [] }), null);
  assert.equal(changeStatistics({ summary: { contentSuppressed: true }, hunks: [] }), null);
  assert.deepEqual(totalChangeStatistics([
    large, { summary: { added: 631, deleted: 59 } },
    { statusCode: '??', summary: { added: 12, deleted: 0 } },
  ]), { added: 936, deleted: 364, untrackedAdded: 12, untrackedFiles: 1, unknown: 0 });
});

test('full retained totals render right-aligned and incomplete results are labeled', () => {
  const win = new Window(); globalThis.document = win.document;
  try {
    const container = document.createElement('div'); document.body.append(container);
    const changes = Array.from({ length: 45 }, (_, i) => ({ rel: `${i}.txt`, summary: { added: 1, deleted: 2 } }));
    const data = { changes, complete: true, total: 45 };
    const state = { searchMode: 'changes', searchResults: data };
    const deps = { renderChangesResults() {} };
    renderSearchOverlayBody(container, state, deps);
    assert.match(container.querySelector('.fe-changes-progress').textContent, /Showing 40 of 45/);
    assert.equal(container.querySelector('.fe-changes-total').textContent, '+45-90');
    data.truncated = true;
    renderSearchOverlayBody(container, state, deps);
    assert.match(container.querySelector('.fe-changes-total').textContent, /^Partial/);
    data.truncated = false; data.complete = false;
    renderSearchOverlayBody(container, state, deps);
    assert.match(container.querySelector('.fe-changes-total').textContent, /^Partial/);
  } finally { win.happyDOM.abort(); }
});

test('suppressed file pills and header MRU survive cached rows and live batch replacement', () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const container = document.createElement('div'); document.body.append(container);
    const renderer = createExplorerChangesResultsRenderer({ getGitDiffBase: () => ({ ref: 'HEAD', mode: 'head' }), ensureInlineDiffs: async () => {}, openFileAndMaybeJump: async () => {}, restoreFile: async () => {} });
    const b = { ...large, rel: 'b.js', error: 'Preview limit' }, c = { ...large, rel: 'c.js' };
    let data = { changes: [large, b, c], recentChanges: { paths: [] } };
    const selected = () => [...container.querySelectorAll('.fe-search-change-header.is-recent')].map(e => e.parentElement.dataset.rel);
    renderer.renderChangesResults(container, data);
    assert.deepEqual([...container.querySelectorAll('.fe-search-change-count')].map(e => e.textContent), ['+305', '-305', '+305', '-305', '+305', '-305']);
    container.querySelector('.fe-search-change-toggle').click();
    assert.deepEqual(selected(), ['host.js']);
    data = { ...data, recentChanges: { paths: ['b.js', 'c.js'] } };
    renderer.renderChangesResults(container, data);
    assert.deepEqual(selected(), ['b.js', 'c.js']);
    container.querySelector('.fe-search-change-toggle').click();
    assert.deepEqual(data.recentChanges.paths, ['host.js'], 'cached listeners use current selection object');
    assert.deepEqual(selected(), ['host.js']);
    data = { ...data, recentChanges: { paths: [] } };
    renderer.renderChangesResults(container, data);
    assert.deepEqual(selected(), []);
    assert.equal(container.querySelector('.fe-search-change-body.is-recent'), null);
  } finally { win.happyDOM.abort(); }
});
