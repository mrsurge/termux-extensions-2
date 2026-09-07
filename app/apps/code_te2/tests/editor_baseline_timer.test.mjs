import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('cold baseline scheduling and superseding preserve native timer receiver', async () => {
  const result = await build({
    entryPoints: [new URL('../monaco_editor/editor_pref_runtime.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', write: false,
  });
  const { createEditorPrefRuntime } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
  const previousWindow = globalThis.window;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const pending = new Map();
  let nextId = 0;
  const win = {
    setTimeout(callback) {
      assert.equal(this, win, 'setTimeout requires Window');
      pending.set(++nextId, callback);
      return nextId;
    },
    clearTimeout(id) {
      assert.equal(this, win, 'clearTimeout requires Window');
      pending.delete(id);
    },
  };
  const requests = [];
  let applied = 0;
  try {
    globalThis.window = win;
    globalThis.setTimeout = win.setTimeout;
    globalThis.clearTimeout = win.clearTimeout;
    const runtime = createEditorPrefRuntime({
      getCachedPrefs: () => ({ preferences: { editor: { showInlineDiffs: true } } }),
      getCurrentPath: () => '/project/main.py',
      isRpcConnected: () => true,
      noteGitBaselineRequest() {},
      rpcCall: async (method, params) => { requests.push({ method, params }); return {}; },
      applyGitBaselines() { applied++; },
      getDiffEditor: () => null,
    });
    assert.equal(runtime.requestGitBaselines({ reason: 'ssot' }), true);
    assert.equal(runtime.requestGitBaselines({ reason: 'ssot' }), true);
    assert.equal(pending.size, 1);
    assert.equal(requests.length, 0);
    const callback = pending.values().next().value;
    pending.clear();
    callback();
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'editor.gitBaselines.get');
    assert.equal(applied, 1);
    runtime.requestGitBaselines({ reason: 'ssot' });
    assert.equal(runtime.requestGitBaselines({ immediate: true, reason: 'prefs' }), true);
    assert.equal(pending.size, 0);
    await Promise.resolve();
    assert.equal(applied, 2);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
