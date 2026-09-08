import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importNotifications() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'src/explorer/rpc/notifications.ts')],
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

function createDeps() {
  let activeFileRel = null;
  let projectPath = '/workspace';
  const reveals = [];
  const markers = [];
  return {
    deps: {
      runtimeState: {
        getProjectPath: () => projectPath,
        setProjectPath: (next) => {
          projectPath = next;
        },
      },
      getActiveFileRel: () => activeFileRel,
      setActiveFileRel: (next) => {
        activeFileRel = next;
      },
      renderBranchLabel: () => {},
      applyActiveFileMarker: () => {
        markers.push(activeFileRel);
      },
      scrollToActiveFile: async (options) => {
        reveals.push({ path: activeFileRel, options });
      },
    },
    get activeFileRel() {
      return activeFileRel;
    },
    reveals,
    markers,
  };
}

test('Explorer silently reveals each exact-client active file exactly once', async () => {
  const { createExplorerNotificationHandler } = await importNotifications();
  const state = createDeps();
  const handler = createExplorerNotificationHandler(state.deps);

  handler.handleExplorerNotification('explorer.openState.changed', {
    projectPath: '/workspace',
    recents: [{ path: '/workspace/src/a.ts' }],
  });
  assert.equal(state.activeFileRel, null);
  assert.deepEqual(state.reveals, []);

  handler.handleExplorerNotification('explorer.activeFile.updated', {
    rel: 'src/a.ts',
  });
  assert.equal(state.activeFileRel, 'src/a.ts');
  assert.deepEqual(state.reveals, [
    { path: 'src/a.ts', options: { silent: true } },
  ]);

  handler.handleExplorerNotification('explorer.activeFile.updated', {
    rel: 'src/a.ts',
  });
  assert.equal(state.reveals.length, 1);
  assert.deepEqual(state.markers, ['src/a.ts']);

  handler.handleExplorerNotification('explorer.activeFile.updated', {
    rel: 'src/b.ts',
  });
  assert.equal(state.activeFileRel, 'src/b.ts');
  assert.deepEqual(state.reveals, [
    { path: 'src/a.ts', options: { silent: true } },
    { path: 'src/b.ts', options: { silent: true } },
  ]);
});

test('selector notification plus Git snapshot starts exactly one changes refresh', async () => {
  const { createExplorerNotificationHandler } = await importNotifications();
  let visible = true;
  let ref = 'HEAD';
  let metadata;
  let reads = 0;
  const searches = [];
  const handler = createExplorerNotificationHandler({
    runtimeState: { getProjectPath: () => '/workspace', setGitStatus() {} },
    setGitDiffBaseRef: value => { ref = value; },
    initDiffBaseFromBackend: async () => { reads++; },
    updateDiffBaseButtons() {},
    applyGitDiffBaseSnapshot: value => { metadata = value; },
    searchOverlayController: {
      isVisible: () => visible, getSearchMode: () => 'changes',
      fetchChangesResults: async () => searches.push({ ref, metadata }),
    },
    renderBranchLabel() {}, renderGitSummary() {}, setGitControlsEnabled() {},
  });
  handler.handleExplorerNotification('explorer.git.diffBase.updated', { projectPath: '/workspace', ref: 'old', refresh: true, selectionRevision: 's1' });
  assert.equal(reads, 1);
  assert.equal(searches.length, 1, 'start without waiting for baseline or decoration work');
  const diffBase = { ref: 'old', mode: 'detached', commit: { hash: 'abc' } };
  handler.handleExplorerNotification('explorer.git.status.updated', { projectPath: '/workspace', diffBase, selectionRevision: 's1', selectionOnly: true });
  assert.deepEqual(searches, [{ ref: 'old', metadata: undefined }]);
  handler.handleExplorerNotification('explorer.git.diffBase.updated', { projectPath: '/workspace', ref: 'old', selectionRevision: 's1' });
  assert.equal(searches.length, 1, 'duplicate selection projection does not rerun');
  handler.handleExplorerNotification('explorer.git.status.updated', { projectPath: '/workspace', diffBase });
  assert.equal(searches.length, 2, 'later real Git facts still refresh unchanged selectors');
  handler.handleExplorerNotification('explorer.git.diffBase.updated', { projectPath: '/workspace', ref: 'HEAD', selectionRevision: 's2' });
  assert.equal(searches.length, 3, 'HEAD starts immediately too');
  handler.handleExplorerNotification('explorer.git.status.updated', { projectPath: '/workspace', diffBase: { ref: 'HEAD' }, selectionRevision: 's2', selectionOnly: true });
  assert.equal(searches.length, 3, 'HEAD completion does not start a second search');
  visible = false;
  handler.handleExplorerNotification('explorer.git.status.updated', { projectPath: '/workspace', diffBase });
  handler.handleExplorerNotification('explorer.git.status.updated', { projectPath: '/other', diffBase });
  assert.equal(searches.length, 3, 'hidden overlays and other projects do not refresh');
});
