import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('status mirrors shared selection and sends mode/ref intent through host RPC', async () => {
  const win = new Window();
  const saved = new Map();
  for (const key of ['window', 'document', 'Node', 'CustomEvent']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
  }
  try {
    win.document.body.innerHTML = '<div id="comparison-status"></div>';
    const result = await build({ entryPoints: [new URL('../main_page/frontend/ui/comparison-status.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
    const { installComparisonStatus } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const calls = [];
    const base = { ref: 'abc12345', mode: 'detached', commit: { short: 'abc12345' } };
    installComparisonStatus({
      getPath: () => '/project/folder/file.py',
      getState: () => ({ activeProject: '/project', gitActual: { 'folder/file.py': ['modified', 'staged'] }, gitDiffBase: base, preferences: { editor: { showInlineDiffs: true } } }),
      request: async payload => {
        calls.push(payload);
        return { projectPath: '/project', mode: payload.mode || 'commit', diffBase: base, commits: [] };
      },
    });
    const button = win.document.querySelector('.comparison-status-button');
    assert.equal(button.textContent, 'file.py @ abc12345 ▴');
    assert.ok(button.classList.contains('comparison-historical'));
    const warning = win.document.querySelector('.comparison-actual-state');
    assert.equal(warning.textContent, 'Modified 🚨 · Staged changes exist 🚨');
    win.dispatchEvent(new win.CustomEvent('code-te2:file-tabs-decorations-changed', { detail: { projectPath: '/other', gitActual: {} } }));
    assert.ok(warning.textContent.includes('Modified'));
    win.dispatchEvent(new win.CustomEvent('code-te2:file-tabs-decorations-changed', { detail: { projectPath: '/project', gitActual: { 'folder/file.py': ['staged'] } } }));
    assert.equal(warning.textContent, 'Staged changes exist 🚨');
    button.click();
    await Promise.resolve(); await Promise.resolve();
    const options = [...win.document.querySelectorAll('[role="menuitemradio"]')];
    assert.ok(options.some(item => item.textContent.includes('abc12345') && item.getAttribute('aria-checked') === 'true'));
    options.find(item => item.textContent.includes('Draft versus disk')).click();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls.at(-1), { projectPath: '/project', mode: 'disk' });
    assert.equal(button.textContent, 'file.py @ disk ▴');
    win.dispatchEvent(new win.CustomEvent('code-te2:comparison-changed', { detail: { projectPath: '/project', mode: 'disk', diffBase: { ref: 'HEAD' } } }));
    assert.equal(warning.textContent, '');
    win.dispatchEvent(new win.CustomEvent('code-te2:comparison-changed', { detail: { projectPath: '/project', mode: 'disk', diffBase: base } }));
    assert.equal(warning.textContent, 'Staged changes exist 🚨');
    assert.ok(!button.classList.contains('comparison-historical'));
    win.dispatchEvent(new win.CustomEvent('code-te2:comparison-changed', { detail: { projectPath: '/other', mode: 'commit', diffBase: base } }));
    assert.equal(button.textContent, 'file.py @ disk ▴');
  } finally {
    win.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('By changes ignores superseded requests and responses after closing', async () => {
  const result = await build({ entryPoints: [new URL('../src/explorer/search/controller.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  const { createExplorerSearchController } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const replies = [];
  const requests = [];
  let results = null;
  let identity = {};
  let visible = true;
  const deps = new Proxy({
    getSearchMode: () => 'changes', getSearchLoading: () => false,
    getProjectPath: () => '/project', getSearchIdentity: () => identity,
    setSearchIdentity: value => { identity = value; },
    getSearchOverlayVisible: () => visible, hasBus: () => true,
    requestBus: (method, params) => {
      if (!method.endsWith('.run')) return Promise.resolve({});
      requests.push(params);
      return new Promise(resolve => replies.push(resolve));
    },
    getSearchResults: () => results,
    setSearchResults: payload => { results = payload; },
  }, { get: (target, key) => target[key] || (() => {}) });
  const controller = createExplorerSearchController(deps);
  const first = controller.fetchChangesResults(true);
  const second = controller.fetchChangesResults(true);
  const packet = (index, result) => ({ kind: 'changes', root: '/project', correlationId: requests[index].correlationId, result });
  // Streaming may precede the correlated start reply.
  controller.handleSearchJobResult(packet(1, { metadata: { total: 45, offset: 0, nextOffset: 40 } }));
  controller.handleSearchJobResult(packet(1, { change: { rel: 'new' } }));
  replies[1](packet(1));
  await second;
  replies[0](packet(0));
  await first;
  controller.handleSearchJobResult(packet(0, { change: { rel: 'old' } }));
  assert.deepEqual(results.changes, [{ rel: 'new' }]);
  controller.handleSearchJobDone(packet(1));
  assert.equal(results.complete, true);
  const third = controller.fetchChangesResults(true);
  controller.cancelActiveSearch('closed');
  visible = false;
  replies[2](packet(2));
  await third;
  controller.handleSearchJobResult(packet(2, { change: { rel: 'closed' } }));
  assert.equal(results, null);
});

test('progressive changes retain existing diff DOM and expose bounded continuation', async () => {
  const win = new Window();
  const saved = new Map();
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLInputElement']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
  }
  try {
    const bundled = await build({ stdin: { contents: `export { createExplorerChangesResultsRenderer } from './src/explorer/search/changes-results-renderer.ts'; export { renderSearchOverlayBody } from './src/explorer/search/overlay-body-renderer.ts';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', write: false });
    const { createExplorerChangesResultsRenderer, renderSearchOverlayBody } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
    const renderer = createExplorerChangesResultsRenderer({ getGitDiffBase: () => ({ ref: 'HEAD', mode: 'head' }), ensureInlineDiffs: async () => {}, openFileAndMaybeJump: async () => {} });
    const container = win.document.createElement('div');
    win.document.body.append(container);
    const pages = [];
    const deps = { renderChangesResults: renderer.renderChangesResults, loadChangesPage: offset => pages.push(offset) };
    const first = { rel: 'a.py', hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'new line' }] }] };
    const state = { searchMode: 'changes', searchResults: { git: true, changes: [first], complete: false } };
    renderSearchOverlayBody(container, state, deps);
    const group = container.querySelector('.fe-search-change-group');
    assert.ok(group);
    state.searchResults = { ...state.searchResults, changes: [first, { rel: 'b.py', hunks: [] }], complete: true, nextOffset: 40, total: 45, offset: 0 };
    renderSearchOverlayBody(container, state, deps);
    assert.equal(container.querySelector('.fe-search-change-group'), group);
    assert.equal(container.querySelectorAll('.fe-search-change-group').length, 2);
    container.querySelector('.fe-changes-progress button').click();
    assert.deepEqual(pages, [40]);
  } finally {
    win.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
