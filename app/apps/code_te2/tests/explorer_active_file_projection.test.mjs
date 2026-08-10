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

test('Explorer silently reveals each newly active file exactly once', async () => {
  const { createExplorerNotificationHandler } = await importNotifications();
  const state = createDeps();
  const handler = createExplorerNotificationHandler(state.deps);

  handler.handleExplorerNotification('explorer.openState.changed', {
    projectPath: '/workspace',
    openFileRel: 'src/a.ts',
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
