import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['main_page/frontend/ui/editor-menu-actions.ts'], bundle: true,
  write: false, format: 'esm', platform: 'node' });
const { createEditorMenuActions } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function fixture(overrides = {}) {
  const calls = [], toasts = [];
  const target = { rendererId: 'secondary-a', area: 'secondary', projectPath: '/project',
    path: '/project/a.ts', projectGeneration: 4, revision: 7 };
  const deps = { request: async (method, params) => {
    calls.push([method, params]);
    return method === 'ui.host.editorState.get' ? { editorTarget: { ...target } } : { ok: true };
  }, pickFile: async () => '/project/b.ts', pickSavePath: async () => '/project/c.ts',
  promptLine: async () => '12', toast: message => toasts.push(message),
  saveUntitled: async () => { throw new Error('unexpected untitled save'); }, ...overrides };
  return { perform: createEditorMenuActions(deps), calls, toasts, target };
}
test('capture precedes dialogs and focus changes cannot alter the pinned renderer/path', async () => {
  let f;
  f = fixture({ pickFile: async () => {
    assert.equal(f.calls.length, 1);
    f.target.rendererId = 'primary-a'; f.target.path = '/project/different.ts';
    return '/project/b.ts';
  } });
  await f.perform('open');
  assert.equal(f.calls[1][1].menuRendererId, 'secondary-a');
  assert.equal(f.calls[1][1].menuPath, '/project/a.ts');
});
test('all existing document/edit actions carry the captured target and close revision', async () => {
  for (const action of ['save', 'saveAs', 'close', 'find', 'goto', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    const f = fixture(); await f.perform(action);
    assert.deepEqual(f.toasts, [], action);
    for (const [, params] of f.calls.slice(1)) {
      assert.equal(params.menuRendererId, 'secondary-a', action);
      assert.equal(params.menuProjectGeneration, 4, action);
    }
    if (action === 'close') assert.equal(f.calls[1][1].revision, 7);
    if (action === 'saveAs') assert.equal(f.calls[1][1].expected_path, '/project/a.ts');
  }
});
test('cancelled dialogs issue no mutation; failed capture does not invoke picker', async () => {
  for (const action of ['open', 'saveAs', 'goto']) {
    const f = fixture({ pickFile: async () => null, pickSavePath: async () => null, promptLine: async () => null });
    await f.perform(action); assert.equal(f.calls.length, 1);
  }
  const f = fixture({ request: async () => ({}), pickFile: async () => { throw new Error('picker must not run'); } });
  await f.perform('open'); assert.match(f.toasts[0], /target unavailable/);
});
