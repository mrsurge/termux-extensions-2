import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';
const { outputFiles } = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/bookmarks.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', write: false });
const { createBookmarks, bookmarkListDto } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const reply = data => new Response(JSON.stringify({ ok: true, data }));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(fetch) {
  const window = new Window(), document = window.document;
  document.body.innerHTML = `<main><div data-role="bookmarks-list"></div><div data-modal="edit-bookmarks"><div data-role="edit-bookmarks-list"></div><button data-action="edit-bookmarks-delete-selected"></button><button data-action="edit-bookmarks-close"></button></div><div data-modal="bookmark-form"><h2 id="fx-bookmark-form-title"></h2><input data-role="bookmark-form-name"><input data-role="bookmark-form-path"><button data-action="bookmark-form-save"></button><button data-action="bookmark-form-cancel"></button></div></main>`;
  const messages = [], opened = [];
  const controller = createBookmarks({ container: document.querySelector('main'), getCurrentPath: () => '/project', loadDirectory: async path => { opened.push(path); }, closeMenus() {}, notify: message => messages.push(message), fetch });
  return { document, controller, messages, opened };
}
test('DTO boundary validates shape and retains flattened metadata; labels are rendered as text', async () => {
  const records = [{ name: '<img src=x onerror=bad()>', path: '/"unsafe', preferredPort: 4000 }];
  assert.equal(bookmarkListDto(records)[0].preferredPort, 4000);
  assert.throws(() => bookmarkListDto([{ name: 'no path' }]));
  const f = fixture(async () => reply(records)); await f.controller.getBookmarks(); f.controller.openEditBookmarksModal();
  assert.equal(f.document.querySelector('img'), null);
  assert.equal(f.document.querySelector('.name').textContent, records[0].name);
  assert.equal(f.document.querySelector('input[type=checkbox]').dataset.path, records[0].path);
});
test('editing retains arbitrary metadata and an in-flight save cannot close a newly opened form', async () => {
  const pending = deferred(); let payload;
  const f = fixture(async (_url, options) => {
    if (!options) return reply([{ name: 'original', path: '/old', preferredPort: 42, extra: { enabled: true } }]);
    payload = JSON.parse(options.body); return pending.promise;
  });
  await f.controller.getBookmarks(); f.controller.openEditBookmarksModal(); f.document.querySelector('.name').click();
  f.document.querySelector('[data-role=bookmark-form-name]').value = 'changed';
  const saving = f.controller.saveBookmarkForm();
  f.controller.closeBookmarkFormModal(); f.controller.openBookmarkFormModal();
  pending.resolve(reply(payload)); await saving;
  assert.deepEqual(payload, [{ name: 'changed', path: '/old', preferredPort: 42, extra: { enabled: true } }]);
  assert.equal(f.controller.formOpen(), true);
  assert.equal(f.document.querySelector('[data-role=bookmark-form-name]').value, 'project');
});
test('stale reads and disposed completion cannot replace current menu', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const f = fixture(async () => (++count === 1 ? first.promise : second.promise));
  const older = f.controller.getBookmarks(), newer = f.controller.getBookmarks();
  second.resolve(reply([{ name: 'new', path: '/new' }])); await newer;
  first.resolve(reply([{ name: 'old', path: '/old' }])); await older;
  assert.equal(f.document.querySelector('[data-role=bookmarks-list]').textContent, 'new');
  const wait = deferred(), g = fixture(() => wait.promise);
  const loading = g.controller.getBookmarks(); g.controller.dispose(); wait.resolve(reply([{ name: 'late', path: '/late' }])); await loading;
  assert.equal(g.document.querySelector('[data-role=bookmarks-list]').textContent, '');
});
test('uncertain save is sent once and stale form target is not overwritten by index', async () => {
  let writes = 0, reads = 0;
  const f = fixture(async (_url, options) => {
    if (options) { writes++; throw new Error('uncertain'); }
    return reply([{ name: ++reads === 1 ? 'old' : 'new', path: '/a' }]);
  });
  await f.controller.getBookmarks(); f.controller.openEditBookmarksModal(); f.document.querySelector('.name').click();
  await f.controller.saveBookmarkForm(); assert.equal(writes, 1); assert.equal(f.messages.at(-1), 'uncertain');
  await f.controller.getBookmarks(); await f.controller.saveBookmarkForm();
  assert.equal(writes, 1); assert.equal(f.messages.at(-1), 'Bookmark changed. Reopen it before saving.');
});
