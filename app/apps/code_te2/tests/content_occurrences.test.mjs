import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundled = await build({ entryPoints: ['src/explorer/search/results-renderer.ts'],
  bundle: true, format: 'esm', platform: 'node', write: false });
const { renderContentResults } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const modelBundle = await build({ entryPoints: ['src/explorer/search/result-model.ts'],
  bundle: true, format: 'esm', platform: 'node', write: false });
const { normalizeContentSearchResults } = await import(`data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString('base64')}`);

test('provider and projected hits retain exact identity, never display-derived offsets', () => {
  const target = { sourceSha256: 'a'.repeat(64), startByte: 5, endByte: 11 };
  for (const editTarget of [target, { ...target, endByte: 5 }]) {
    for (const input of [
      { files: [{ relativePath: 'file.py', matches: [{ lineNumber: 2, editTarget }] }] },
      { results: [{ rel: 'file.py', matches: [{ line: 2, editTarget }] }] },
    ]) assert.deepEqual(normalizeContentSearchResults(input).results[0].matches[0].editTarget, editTarget);
  }
  for (const editTarget of [null, { ...target, startByte: -1 }, { ...target, endByte: 1 },
    { ...target, sourceSha256: 'invalid' }, { ...target, endByte: 375 * 1024 + 1 }]) {
    const result = normalizeContentSearchResults({ results: [{ rel: 'file.py', matches: [{ line: 2, editTarget }] }] });
    assert.equal(result.results[0].matches[0].editTarget, undefined);
  }
});

test('same-line occurrences render as distinct logical hits', () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement });
  try {
    const container = document.createElement('div');
    const matches = [0, 7, 14].map(start => ({ line: 1, column: start + 1,
      text: 'import import import', snippet: 'import import import', matchText: 'import',
      lineRanges: [{ start, end: start + 6 }], snippetRanges: [{ start, end: start + 6 }] }));
    renderContentResults(container, { results: [{ rel: 'file.py', matches, fileMatchCount: 3 }] }, {
      toast: () => {}, openFileAndMaybeJump: async () => {},
    });
    assert.equal(container.querySelectorAll('.fe-search-match').length, 3);
    assert.equal(container.querySelector('.fe-search-file-meta').textContent, '3');
    assert.deepEqual([...container.querySelectorAll('.fe-search-line-num')].map(el => el.textContent), ['1', '1', '1']);
  } finally { win.happyDOM.abort(); }
});
