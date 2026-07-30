import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('git baseline request applies the returned payload without blocking the caller', async () => {
  const { createEditorPrefRuntime } = await importTypeScript(
    'monaco_editor/editor_pref_runtime.ts',
  );
  const payload = {
    path: '/workspace/current.ts',
    tracked: true,
    disk_content: 'disk',
    head_content: 'head',
  };
  const calls = [];
  const applied = [];
  const runtime = createEditorPrefRuntime({
    getCachedPrefs: () => ({
      preferences: { editor: { showInlineDiffs: true } },
    }),
    getLastLocalEditAt: () => 0,
    isRpcConnected: () => true,
    rpcCall: async (...args) => {
      calls.push(args);
      return payload;
    },
    getCurrentPath: () => '/workspace/current.ts',
    getDiffEditor: () => null,
    disposeGitBaselines: () => {},
    ensurePlainEditorWithPrefs: () => null,
    applyGitBaselines: (value) => applied.push(value),
    noteGitBaselineRequest: () => {},
  });

  assert.equal(runtime.requestGitBaselines({ immediate: true, reason: 'open' }), true);
  assert.deepEqual(applied, []);
  await settlePromises();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'editor.gitBaselines.get');
  assert.deepEqual(calls[0][1], { path: '/workspace/current.ts' });
  assert.deepEqual(applied, [payload]);
});

test('stale git baseline payload does not touch Monaco state', async () => {
  const { applyGitBaselines } = await importTypeScript(
    'monaco_editor/editor_git_baseline_runtime.ts',
  );
  let monacoReads = 0;

  applyGitBaselines({
    getCurrentPath: () => '/workspace/current.ts',
    getMonaco: () => {
      monacoReads += 1;
      return null;
    },
  }, {
    path: '/workspace/previous.ts',
  });

  assert.equal(monacoReads, 0);
});

test('inline diff scrollbars keep vertical chrome hidden and horizontal overflow usable', async () => {
  const { buildInlineDiffScrollbarOptions } = await importTypeScript(
    'monaco_editor/editor_diff_scrollbar_options.ts',
  );

  assert.deepEqual(buildInlineDiffScrollbarOptions(), {
    scrollbar: {
      vertical: 'hidden',
      verticalScrollbarSize: 0,
      horizontal: 'auto',
      horizontalScrollbarSize: 10,
    },
  });
});
