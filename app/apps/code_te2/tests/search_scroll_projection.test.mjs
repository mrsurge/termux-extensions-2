import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function source(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { renderSearchOverlayBody } = await source('src/explorer/search/overlay-body-renderer.ts');
const { installScrollExpansion } = await source('src/explorer/search/scroll-expansion.ts');
const { gitActionButton } = await source('src/explorer/git/action-button.ts');

test('By Changes expands retained latest objects without a new search or duplicate sentinel', () => {
  const win = new Window();
  globalThis.document = win.document;
  try {
    const container = document.createElement('div'); document.body.append(container);
    const changes = Array.from({ length: 90 }, (_, i) => ({ rel: `${i}.txt` }));
    const data = { changes, complete: true, total: 90 };
    const state = { searchMode: 'changes', searchResults: data };
    let rendered;
    const deps = { renderChangesResults: (_body, next) => { rendered = next.changes; }, loadChangesPage: () => assert.fail('must not enumerate again') };
    renderSearchOverlayBody(container, state, deps);
    assert.equal(rendered.length, 40);
    changes[50] = { rel: '50.txt', updated: true };
    const revealed = [...rendered];
    changes.unshift({ rel: 'new.txt' }); data.total = 91;
    renderSearchOverlayBody(container, state, deps);
    assert.deepEqual(rendered, revealed, 'new ordering must not evict a revealed row');
    assert.equal(container.querySelectorAll('.fe-changes-more').length, 1);
    container.querySelector('.fe-changes-more').click();
    assert.equal(rendered.length, 80);
    assert.equal(rendered.find(item => item.rel === '50.txt').updated, true);
    container.querySelector('.fe-changes-more').click();
    assert.equal(rendered.length, 91);
    assert.equal(container.querySelector('.fe-changes-more'), null);
  } finally { delete globalThis.document; win.happyDOM.abort(); }
});

test('early scroll chooses one enabled sentinel and does not run on a detached surface', () => {
  const win = new Window();
  const container = win.document.createElement('div'); win.document.body.append(container);
  container.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 });
  let count = 0;
  const button = win.document.createElement('button');
  button.dataset.scrollMore = 'global';
  button.getBoundingClientRect = () => ({ top: 400, bottom: 420, height: 20 });
  button.onclick = () => { count++; button.disabled = true; };
  container.append(button); installScrollExpansion(container);
  container.dispatchEvent(new win.Event('scroll'));
  container.dispatchEvent(new win.Event('scroll'));
  assert.equal(count, 1);
  container.remove(); button.disabled = false;
  container.dispatchEvent(new win.Event('scroll'));
  assert.equal(count, 1);
  win.happyDOM.abort();
});

test('remote actions are themed SVG buttons with explicit accessible labels', () => {
  const win = new Window();
  for (const name of ['push', 'pull', 'fetch', 'refresh']) {
    const button = gitActionButton(win.document, name, name);
    assert.ok(button.classList.contains('fe-btn'));
    assert.equal(button.getAttribute('aria-label'), name);
    assert.equal(button.querySelector('svg').getAttribute('stroke'), 'currentColor');
    assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  }
  win.happyDOM.abort();
});
