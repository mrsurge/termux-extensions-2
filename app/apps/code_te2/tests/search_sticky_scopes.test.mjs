import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundled = await build({ entryPoints: ['src/explorer/search/results-renderer.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { renderContentResults } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('Contents sticky eligibility follows displayed hits, not hidden totals', () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const container = document.createElement('div'); document.body.append(container);
    renderContentResults(container, { results: [2, 3, 4].map(count => ({
      rel: `file${count}.txt`, fileMatchCount: 100,
      matches: Array.from({ length: count }, (_, index) => ({ line: index + 1, text: 'hit' })),
    })) }, { toast: () => {}, openFileAndMaybeJump: async () => {} });
    const groups = [...container.querySelectorAll('.fe-search-content-group')];
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map(group => group.classList.contains('has-sticky-scope')), [false, true, true]);
    assert.equal(groups[1].querySelectorAll(':scope > .fe-search-file-header').length, 1);
  } finally { win.happyDOM.abort(); }
});

test('result scopes use native sticky boundaries and do not draw a bottom header outline', async () => {
  const css = await readFile('main_page/frontend/explorer.css', 'utf8');
  assert.match(css, /\.fe-search-content-group,\s*\.fe-search-change-group\s*\{\s*overflow: clip/);
  assert.match(css, /\.fe-search-change-group > \.fe-search-change-header\s*\{[^}]*position: sticky;[^}]*top: 0/);
  assert.match(css, /\.fe-search-change-group \.fe-search-hunk-header-row\s*\{[^}]*position: sticky;[^}]*top: 34px/);
  assert.match(css, /\.fe-search-change-group\.is-recent > \.fe-search-change-header::after\s*\{[^}]*border-bottom: 0/);
});
