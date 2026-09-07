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
      getState: () => ({ activeProject: '/project', gitDiffBase: base, preferences: { editor: { showInlineDiffs: true } } }),
      request: async payload => {
        calls.push(payload);
        return { projectPath: '/project', mode: payload.mode || 'commit', diffBase: base, commits: [] };
      },
    });
    const button = win.document.querySelector('.comparison-status-button');
    assert.equal(button.textContent, 'file.py @ abc12345 ▴');
    assert.ok(button.classList.contains('comparison-historical'));
    button.click();
    await Promise.resolve(); await Promise.resolve();
    const options = [...win.document.querySelectorAll('[role="menuitemradio"]')];
    assert.ok(options.some(item => item.textContent.includes('abc12345') && item.getAttribute('aria-checked') === 'true'));
    options.find(item => item.textContent.includes('Draft versus disk')).click();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls.at(-1), { projectPath: '/project', mode: 'disk' });
    assert.equal(button.textContent, 'file.py @ disk ▴');
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
  const rendered = [];
  const deps = new Proxy({
    getSearchMode: () => 'changes', getSearchLoading: () => false,
    getProjectPath: () => '/project', getSearchIdentity: () => ({}),
    getSearchOverlayVisible: () => true, hasBus: () => true,
    requestBus: () => new Promise(resolve => replies.push(resolve)),
    setSearchResults: payload => rendered.push(payload),
  }, { get: (target, key) => target[key] || (() => {}) });
  const controller = createExplorerSearchController(deps);
  const first = controller.fetchChangesResults(true);
  const second = controller.fetchChangesResults(true);
  replies[1]({ mode: 'changes', results: ['new'] });
  await second;
  replies[0]({ mode: 'changes', results: ['old'] });
  await first;
  assert.deepEqual(rendered, [{ mode: 'changes', results: ['new'] }]);
  const third = controller.fetchChangesResults(true);
  controller.cancelActiveSearch('closed');
  replies[2]({ mode: 'changes', results: ['closed'] });
  await third;
  assert.equal(rendered.length, 1);
});
