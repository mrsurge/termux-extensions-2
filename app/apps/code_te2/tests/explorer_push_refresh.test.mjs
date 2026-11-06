import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/explorer/rpc/notifications.ts'],
  bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createExplorerNotificationHandler } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function harness() {
  const refreshes = [], toasts = [];
  let status = { isRepository: true, ahead: 2, behind: 0 };
  let rendered = 0;
  const { handleExplorerNotification } = createExplorerNotificationHandler({
    hideGitProgressBar() {}, toast: value => toasts.push(value), hasExplorerRpc: () => true,
    notifyExplorer: (method, payload) => refreshes.push({ method, payload }),
    runtimeState: { getProjectPath: () => '/project', getGitStatus: () => status,
      setGitStatus: value => { status = value; } },
    searchOverlayController: { isVisible: () => false },
    renderBranchLabel() { rendered++; }, renderGitSummary() {}, setGitControlsEnabled() {},
  });
  return { handle: handleExplorerNotification, refreshes, toasts,
    status: () => status, rendered: () => rendered };
}

test('successful push retains toast without requesting a frontend refresh', () => {
  const h = harness();
  h.handle('explorer.job.progress', { type: 'git_push', status: 'succeeded', message: 'Pushed' });
  assert.deepEqual(h.toasts, ['Pushed']);
  assert.deepEqual(h.refreshes, []);
});

test('backend status projection updates upstream despite dirty submodule', () => {
  const h = harness();
  h.handle('explorer.git.status.updated', { projectPath: '/project', isRepository: true,
    branch: 'main', ahead: 0, behind: 0, unstaged: ['vendor/submodule'] });
  assert.equal(h.status().ahead, 0);
  assert.deepEqual(h.status().unstaged, ['vendor/submodule']);
  assert.equal(h.rendered(), 1);
});

test('pull and clone preserve their existing refresh behavior', () => {
  for (const type of ['git_pull', 'git_clone']) {
    const h = harness();
    h.handle('explorer.job.progress', { type, status: 'succeeded' });
    assert.equal(h.refreshes.length, 1);
  }
});
