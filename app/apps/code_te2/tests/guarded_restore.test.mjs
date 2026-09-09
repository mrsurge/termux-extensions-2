import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const result = await build({ entryPoints: [new URL('../src/explorer/tree/menu-controller.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
const { createExplorerTreeMenuController } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
async function run({ staged = false, deleted = false, answers = [true], changeProject = false } = {}) {
  const dom = new Window({ url: 'http://127.0.0.1/' });
  Object.assign(globalThis, { window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement });
  const messages = [], calls = [], toasts = [];
  let project = '/project';
  dom.teUI = { dialog: { confirm: async message => {
    messages.push(message); if (changeProject) project = '/other'; return answers.shift() ?? true;
  } } };
  const anchor = document.createElement('button'); document.body.append(anchor);
  const preview = { path: 'file.py', commit: 'a'.repeat(40), token: 'first', ref: 'old', hasDraft: true, staged, delete: deleted };
  const controller = createExplorerTreeMenuController({
    isHistoricalComparison: () => true, getTreeElement: () => null, getSelectedEntries: () => new Set(),
    getProjectPath: () => project, supportsSecondEditor: () => false, hasExplorerRpc: () => true,
    notifyExplorer() { assert.fail('Restore must await a correlated response'); },
    requestExplorer: async (method, payload) => {
      if (method === 'explorer.extensions.menu.resolve') return { actions: [] };
      calls.push({ method, ...payload });
      if (payload.phase === 'prepare') return { ...preview };
      if (payload.phase === 'unstage') return { ...preview, staged: false, token: 'second' };
      return { ok: true };
    },
    buildSidebarMentionPayload: value => value, toast: value => toasts.push(value),
    isInSelectMode: () => false, enableSelectMode() {}, disableSelectMode() {},
    openFileAndMaybeJump: async () => {}, isCancelledError: () => false, getErrorMessage: error => error.message,
  });
  try {
    controller.openCardMenuForEntry({ rel: 'file.py', name: 'file.py', kind: 'file', gitStatus: 'modified' }, anchor);
    const button = [...document.querySelectorAll('.fe-dd-item')].find(el => el.textContent.startsWith('Restore'));
    assert.ok(button, 'historical Restore is available');
    button.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    return { messages, calls, toasts };
  } finally { dom.happyDOM.abort(); }
}
test('restore identifies commit and explicitly discards draft', async () => {
  const { calls, messages } = await run();
  assert.deepEqual(calls.map(call => call.phase), ['prepare', 'apply']);
  assert.equal(calls[1].discardDraft, true); assert.match(messages[0], /aaaaaaaaaa/); assert.match(messages[0], /DISCARD.*unsaved draft/);
});
test('cancel never applies restore', async () => {
  const { calls } = await run({ answers: [false] }); assert.deepEqual(calls.map(call => call.phase), ['prepare']);
});
test('unstage precedes a fresh restore confirmation', async () => {
  const { calls, messages } = await run({ staged: true });
  assert.deepEqual(calls.map(call => call.phase), ['prepare', 'unstage', 'apply']);
  assert.equal(calls[2].token, 'second'); assert.match(messages[0], /Staged-only contents/); assert.match(messages[1], /Restore file.py/);
});
test('cancel after unstage does not restore', async () => {
  const { calls } = await run({ staged: true, answers: [true, false] }); assert.deepEqual(calls.map(call => call.phase), ['prepare', 'unstage']);
});
test('absent historical file requires deletion confirmation', async () => {
  const { messages } = await run({ deleted: true }); assert.match(messages[0], /does not exist.*Delete the working file/s);
});
test('project change during confirmation rejects apply', async () => {
  const { calls, toasts } = await run({ changeProject: true }); assert.deepEqual(calls.map(call => call.phase), ['prepare']); assert.match(toasts[0], /Project changed/);
});
