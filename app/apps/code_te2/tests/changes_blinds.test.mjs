import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const bundled = await build({ entryPoints: ['src/explorer/search/changes-results-renderer.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { createExplorerChangesResultsRenderer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
test('blinds and Restore isolate actions and retain controls during streaming', async () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const opens = [], restores = [];
    let finish;
    const renderer = createExplorerChangesResultsRenderer({ getGitDiffBase: () => ({ ref: 'HEAD', mode: 'head' }), ensureInlineDiffs: async () => {}, openFileAndMaybeJump: async (...args) => opens.push(args), restoreFile: rel => { restores.push(rel); return new Promise(resolve => { finish = resolve; }); } });
    const container = document.createElement('div'); document.body.append(container);
    const make = (rel, n) => ({ rel, error: 'Preview warning', hunks: [{ oldStart: 1, newStart: 1, lines: Array.from({ length: n }, (_, i) => ({ type: 'add', text: `line ${i}` })) }] });
    const first = make('a.py', 53);
    renderer.renderChangesResults(container, { changes: [first], complete: false });
    const group = container.querySelector('.fe-search-change-group');
    const fileToggle = group.querySelector('.fe-search-change-toggle');
    assert.equal(group.querySelector('.fe-search-change-body').hidden, true);
    fileToggle.click();
    assert.equal(group.querySelector('.fe-search-change-body').hidden, false);
    assert.equal(fileToggle.getAttribute('aria-expanded'), 'true');
    const blind = group.querySelector('.fe-search-hunk-blind'), header = group.querySelector('.fe-search-hunk-toggle'), rows = group.querySelector('.fe-search-diff-rows');
    assert.equal(rows.children.length, 53);
    assert.equal(blind.textContent, 'Show remaining 3 lines');
    assert.ok(rows.classList.contains('is-blinded'));
    blind.click(); assert.equal(rows.classList.contains('is-blinded'), false);
    header.click(); assert.equal(group.querySelector('.fe-search-hunk-body').hidden, true);
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    assert.ok(group.querySelector('.fe-search-error'));
    renderer.renderChangesResults(container, { changes: [first, make('b.py', 50)], complete: true });
    assert.equal(container.querySelector('.fe-search-change-group'), group);
    assert.equal(group.querySelector('.fe-search-change-body').hidden, false);
    assert.equal(group.querySelector('.fe-search-hunk-body').hidden, true);
    assert.equal(container.querySelectorAll('.fe-search-hunk-blind').length, 1);
    header.click(); assert.equal(rows.classList.contains('is-blinded'), false);
    blind.click(); assert.ok(rows.classList.contains('is-blinded'));
    fileToggle.click();
    container.querySelector('.fe-search-changes-expand').click();
    assert.equal(group.querySelector('.fe-search-change-body').hidden, false);
    assert.equal(rows.classList.contains('is-blinded'), false);
    const restore = group.querySelector('.fe-search-change-restore'); restore.click(); restore.click();
    assert.deepEqual(restores, ['a.py']); assert.equal(restore.disabled, true);
    finish(); await Promise.resolve(); assert.equal(restore.disabled, false);
    assert.equal(opens.length, 0);
    rows.children[2].click(); await Promise.resolve(); await Promise.resolve();
    assert.equal(opens[0][1], 3); assert.equal(opens[0][2].focus, false);
    renderer.renderChangesResults(container, { changes: [make('a.py', 53)] });
    assert.notEqual(container.querySelector('.fe-search-change-group'), group);
    const css = await readFile('main_page/frontend/explorer.css', 'utf8');
    assert.match(css, /is-blinded > \.fe-search-diff-row:nth-child\(n\+51\).*\{ display: none; \}/);
  } finally { win.happyDOM.abort(); }
});

test('By Changes filter highlights paths and diff text using content search hit classes', () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const active = document.createElement('input'); active.type = 'checkbox';
    active.id = 'fe-changes-filter-active'; active.checked = true;
    const query = document.createElement('input'); query.id = 'fe-changes-filter-input'; query.value = 'Hello';
    document.body.append(active, query);
    const renderer = createExplorerChangesResultsRenderer({
      getGitDiffBase: () => ({ ref: 'HEAD' }), ensureInlineDiffs: async () => {},
      openFileAndMaybeJump: async () => {}, restoreFile: async () => {}, restoreHunk: async () => {},
    });
    const container = document.createElement('div');
    const payload = { changes: [{ rel: 'hello.js', hunks: [{ lines: [
      { type: 'add', text: 'const hello = "HELLO";' },
    ] }] }] };
    renderer.renderChangesResults(container, payload);
    assert.equal(container.querySelector('.fe-search-change-path .fe-search-hit').textContent, 'hello');
    assert.equal(container.querySelectorAll('.fe-search-diff-text .fe-search-hit').length, 2);
    assert.equal(container.querySelector('.fe-search-diff-text').textContent, 'const hello = "HELLO";');
    assert.ok(container.querySelector('.fe-search-diff-text .hljs-keyword'));
    active.checked = false; renderer.applyChangesFilter();
    assert.equal(container.querySelectorAll('.fe-search-hit').length, 0);
  } finally { win.happyDOM.abort(); }
});

test('collapsed file summaries resolve basename icons, preserve paths, and isolate header clicks', async () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const names = [];
    const renderer = createExplorerChangesResultsRenderer({
      getGitDiffBase: () => ({ ref: 'HEAD', mode: 'head' }),
      ensureInlineDiffs: async () => assert.fail('header must not enable diffs'),
      openFileAndMaybeJump: async () => assert.fail('header must not navigate'),
      restoreFile: async () => {}, restoreHunk: async () => {},
      getFileIcon: async name => { names.push(name); return { svg: '<svg><path /></svg>', color: '#abc' }; },
    });
    const container = document.createElement('div');
    const rel = 'some/very/long/path/example.py';
    renderer.renderChangesResults(container, { changes: [{ rel, hunks: [{ lines: [
      { type: 'add', text: 'a' }, { type: 'del', text: 'b' }, { type: 'context', text: 'c' },
    ] }] }] });
    await Promise.resolve();
    assert.deepEqual(names, ['example.py']);
    assert.equal(container.querySelector('.fe-search-change-path').textContent, rel);
    assert.equal(container.querySelector('.fe-search-change-path').title, rel);
    assert.equal(container.querySelector('.fe-search-change-count.is-added').textContent, '+1');
    assert.equal(container.querySelector('.fe-search-change-count.is-deleted').textContent, '-1');
    assert.ok(container.querySelector('.fe-search-change-icon svg'));
    const toggle = container.querySelector('.fe-search-change-toggle');
    toggle.click(); toggle.click();
    assert.equal(container.querySelector('.fe-search-change-body').hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    const css = await readFile('main_page/frontend/explorer.css', 'utf8');
    assert.match(css, /\.fe-search-change-path\s*\{[^}]*direction: rtl/);
  } finally { win.happyDOM.abort(); }
});

test('hunk Restore uses its captured snapshot and does not navigate or collapse', async () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const calls = [];
    const identity = { commit: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), hunkIndex: 2 };
    const renderer = createExplorerChangesResultsRenderer({
      getGitDiffBase: () => ({ ref: 'HEAD', mode: 'head' }),
      ensureInlineDiffs: async () => {}, openFileAndMaybeJump: async () => assert.fail('unexpected navigation'),
      restoreFile: async () => assert.fail('unexpected whole-file restore'),
      restoreHunk: async (rel, captured) => calls.push({ rel, captured }),
    });
    const container = document.createElement('div');
    renderer.renderChangesResults(container, { changes: [{ rel: 'file.py', hunks: [
      { oldStart: 1, newStart: 1, restore: identity, lines: [{ type: 'add', text: 'new' }] },
      { oldStart: 10, newStart: 10, lines: [{ type: 'add', text: 'other' }] },
    ] }] });
    const actions = container.querySelectorAll('.fe-search-hunk .fe-search-change-restore');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].parentElement.className, 'fe-search-hunk-header-row');
    assert.ok(actions[0].parentElement.querySelector('.fe-search-hunk-toggle'));
    actions[0].click(); actions[0].click();
    await Promise.resolve();
    assert.deepEqual(calls, [{ rel: 'file.py', captured: identity }]);
    assert.equal(container.querySelector('.fe-search-hunk-body').hidden, false);
  } finally { win.happyDOM.abort(); }
});

test('file staging and shared commit are HEAD-only while historical Restore stays explicit', async () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    let ref = 'HEAD';
    const staged = [], restored = [];
    let commits = 0;
    const renderer = createExplorerChangesResultsRenderer({
      getGitDiffBase: () => ({ ref }),
      ensureInlineDiffs: async () => assert.fail('action must not navigate'),
      openFileAndMaybeJump: async () => assert.fail('action must not navigate'),
      stageFile: async rel => staged.push(rel),
      commitStagedChanges: async () => { commits++; },
      restoreFile: async rel => restored.push(rel), restoreHunk: async () => {},
    });
    const container = document.createElement('div');
    const change = { rel: 'a.py', hunks: [] };
    const render = () => renderer.renderChangesResults(container, { base: { ref }, changes: [change] });
    render();
    const stage = container.querySelector('.fe-search-change-stage');
    const restore = container.querySelector('.fe-search-change-restore');
    assert.equal(stage.textContent, '+');
    assert.equal(restore.textContent, '×');
    stage.click(); await Promise.resolve();
    container.querySelector('.fe-search-changes-commit').click(); await Promise.resolve();
    assert.deepEqual(staged, ['a.py']); assert.equal(commits, 1);
    assert.equal(container.querySelector('.fe-search-change-body').hidden, true);
    ref = 'abc123';
    stage.click(); await Promise.resolve(); // Live guard also protects old DOM before projection.
    assert.equal(staged.length, 1);
    render();
    assert.equal(stage.disabled, true);
    assert.equal(container.querySelector('.fe-search-changes-commit').disabled, true);
    assert.equal(restore.textContent, 'Restore');
    restore.click(); await Promise.resolve();
    assert.deepEqual(restored, ['a.py']);
    ref = 'HEAD'; render();
    assert.equal(stage.disabled, false);
    assert.equal(restore.textContent, '×');
  } finally { win.happyDOM.abort(); }
});

test('shared commit prompt rejects project/comparison changes and duplicate invocation', async () => {
  const output = await build({ entryPoints: ['src/explorer/git/footer-utils.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
  const { createExplorerGitFooterUtils } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  let finish, project = 'a', historical = false, prompts = 0;
  const sent = [];
  globalThis.window = { teUI: { dialog: { prompt: () => { prompts++; return new Promise(resolve => { finish = resolve; }); } } } };
  const api = createExplorerGitFooterUtils({
    getProjectPath: () => project, isHistoricalComparison: () => historical,
    getGitStatus: () => ({ staged: ['a.py'] }), getGitButtons: () => ({}),
    getGitSummaryElement: () => null, hasExplorerBus: () => true,
    sendExplorerBus: (...args) => sent.push(args), toast: () => {},
  });
  const first = api.commitStagedChanges(); await api.commitStagedChanges();
  assert.equal(prompts, 1);
  project = 'b'; finish('wrong project'); await first;
  assert.equal(sent.length, 0);
  const second = api.commitStagedChanges(); historical = true; finish('wrong comparison'); await second;
  assert.equal(sent.length, 0);
  historical = false;
  const third = api.commitStagedChanges(); finish(' message '); await third;
  assert.deepEqual(sent, [['explorer.git.commit', { message: 'message', amend: false }]]);
});

test('untracked summary counts and file links survive omitted bodies with compact status labels', async () => {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  try {
    const opens = [];
    const renderer = createExplorerChangesResultsRenderer({
      getGitDiffBase: () => ({ ref: 'HEAD' }), ensureInlineDiffs: async () => assert.fail('no baseline required'),
      openFileAndMaybeJump: async (...args) => opens.push(args), restoreFile: async () => {}, restoreHunk: async () => {},
    });
    const container = document.createElement('div');
    renderer.renderChangesResults(container, { changes: [
      { rel: 'new.txt', status: '?', statusText: 'Untracked', summary: { added: 3, deleted: 0, contentSuppressed: true }, hunks: [] },
      { rel: 'old.txt', status: 'M', statusText: 'Modified', hunks: [] },
    ] });
    assert.equal(container.querySelector('.fe-search-change-count.is-added').textContent, '+3');
    const labels = container.querySelectorAll('.fe-search-change-status-text');
    assert.equal(labels[0].textContent, 'A'); assert.ok(labels[0].classList.contains('is-added'));
    assert.equal(labels[1].textContent, 'M');
    const header = container.querySelector('.fe-search-change-toggle');
    assert.equal(header.getAttribute('aria-label'), 'Open new.txt');
    assert.equal(header.hasAttribute('aria-expanded'), false);
    header.click(); await Promise.resolve();
    assert.deepEqual(opens, [['new.txt', 1, { focus: false }]]);
    assert.equal(container.querySelector('.fe-search-change-body').hidden, true);
  } finally { win.happyDOM.abort(); }
});
