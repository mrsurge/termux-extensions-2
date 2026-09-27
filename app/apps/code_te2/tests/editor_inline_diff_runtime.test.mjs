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

test('obsolete comparison revisions, refs and modes never reach Monaco', async () => {
  const { applyGitBaselines, updateComparisonBaselineFence } = await importTypeScript('monaco_editor/editor_git_baseline_runtime.ts');
  updateComparisonBaselineFence('new-ref', 20);
  let reads = 0;
  const deps = { getCurrentPath: () => '/p/a', getShowInlineDiffs: () => true, getShowDraftDiffs: () => false, getMonaco: () => { reads++; return null; } };
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'commit', comparison_revision: 10, base_ref: 'new-ref' });
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'commit', comparison_revision: 30, base_ref: 'old-ref' });
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'disk', comparison_revision: 30 });
  assert.equal(reads, 0);
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'commit', comparison_revision: 30, base_ref: 'new-ref' });
  assert.equal(reads, 1);
});

test('reconnect comparison fence permits the new baseline after a missed change event', async () => {
  const { applyGitBaselines, updateComparisonBaselineFence } = await importTypeScript('monaco_editor/editor_git_baseline_runtime.ts');
  let reads = 0;
  const deps = { getCurrentPath: () => '/p/a', getShowInlineDiffs: () => true, getShowDraftDiffs: () => false, getMonaco: () => { reads++; return null; } };
  updateComparisonBaselineFence('A', 100);
  // The reconnect snapshot repairs the fence before requesting fresh baselines.
  updateComparisonBaselineFence('B', 200);
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'commit', comparison_revision: 150, base_ref: 'A' });
  assert.equal(reads, 0);
  applyGitBaselines(deps, { path: '/p/a', comparison_mode: 'commit', comparison_revision: 201, base_ref: 'B' });
  assert.equal(reads, 1);
});

test('duplicate baseline delivery skips layout but a replaced model reapplies it', async () => {
  const { applyGitBaselines } = await importTypeScript('monaco_editor/editor_git_baseline_runtime.ts');
  let mounted = null, head = null, disk = null, live = {}, layouts = 0;
  const editor = { getModel: () => mounted, setModel: (value) => { mounted = value; }, getLineChanges: () => [1] };
  const noop = () => {};
  const deps = {
    getCurrentPath: () => '/p/a', getShowInlineDiffs: () => true, getShowDraftDiffs: () => false,
    getMonaco: () => ({ editor: { createModel: (text) => ({ getValue: () => text }), setModelLanguage: noop } }),
    getDiffEditor: () => editor, getEditor: () => null, getModel: () => live,
    getBaselineApplyIdleMs: () => 0, setLastGitBaselines: noop,
    languageFromPath: () => 'text', getGitHeadModel: () => head, getGitDiskModel: () => disk,
    setGitHeadModel: (value) => { head = value; }, setGitDiskModel: (value) => { disk = value; },
    ensureDiffEditorWithPrefs: () => editor, applyLineNumberSizing: noop,
    layoutEditors: () => { layouts++; }, installDraftZoneOrderingHook: noop,
    getShowDraftInsertions: () => false, ensureTouchSelection: noop, setDebugGit: noop, setDebugFlags: noop,
  };
  const payload = { path: '/p/a', comparison_mode: 'commit', comparison_revision: 100, base_ref: 'A', head_content: 'old', disk_content: 'new' };
  applyGitBaselines(deps, payload);
  applyGitBaselines(deps, { ...payload });
  assert.equal(layouts, 1);
  live = {};
  applyGitBaselines(deps, { ...payload });
  assert.equal(layouts, 2);
});
