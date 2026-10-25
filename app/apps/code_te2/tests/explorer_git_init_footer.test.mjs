import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function load(relative) {
  const output = await build({
    entryPoints: [new URL(relative, import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'esm',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}

const { createExplorerNotificationHandler } = await load('../src/explorer/rpc/notifications.ts');
const { createExplorerGitFooterUtils } = await load('../src/explorer/git/footer-utils.ts');
const { createExplorerDiffBaseController } = await load('../src/explorer/git/diff-base-controller.ts');

function fixture() {
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document });
  let status = null;
  const buttons = Object.fromEntries(['init', 'stage', 'unstage', 'commit', 'push', 'pull', 'reset']
    .map(key => [key, win.document.createElement('button')]));
  const summary = win.document.createElement('div');
  const sent = [];
  const footer = createExplorerGitFooterUtils({
    getGitSummaryElement: () => summary,
    getGitButtons: () => buttons,
    getGitStatus: () => status,
    hasExplorerBus: () => true,
    sendExplorerBus: (...args) => sent.push(args),
    toast() {},
  });
  const diffBase = createExplorerDiffBaseController({
    getEditorState: () => ({ activeProject: '/project', activeProjectExists: true }),
    setGitControlsEnabled: footer.setGitControlsEnabled,
  });
  const notifications = createExplorerNotificationHandler({
    runtimeState: {
      getProjectPath: () => '/project',
      getGitStatus: () => status,
      setGitStatus: next => { status = next; },
    },
    searchOverlayController: { isVisible: () => false },
    applyGitDiffBaseSnapshot: diffBase.applySnapshot,
    renderBranchLabel() {},
    renderGitSummary: footer.renderGitSummary,
    setGitControlsEnabled: footer.setGitControlsEnabled,
  });
  return {
    win, buttons, diffBase, footer, sent,
    status: (payload) => notifications.handleExplorerNotification('explorer.git.status.updated', {
      projectPath: '/project', ...payload,
    }),
  };
}

function assertInit(buttons, visible) {
  assert.equal(buttons.init.style.display, visible ? 'inline-block' : 'none');
  assert.equal(buttons.init.disabled, false);
  for (const key of ['stage', 'unstage', 'commit', 'push', 'pull', 'reset']) {
    assert.equal(buttons[key].style.display, visible ? 'none' : 'inline-block', key);
    assert.equal(buttons[key].disabled, visible, key);
  }
}

for (const order of ['base-first', 'status-first', 'embedded-base']) {
  test(`non-repository Init survives ${order} hydration and repeated status facts`, async () => {
    const f = fixture();
    try {
      const base = { ref: 'HEAD', mode: 'none', commit: null };
      if (order === 'base-first') f.diffBase.applySnapshot(base);
      f.status({ isRepository: false, hasHead: false,
        ...(order === 'embedded-base' ? { diffBase: base } : {}) });
      if (order === 'status-first') f.diffBase.applySnapshot(base);
      assertInit(f.buttons, true);
      f.status({ isRepository: false, hasHead: false });
      assertInit(f.buttons, true);
      // Existing confirmation and own-lane mutation remain the only init path.
      winConfirm(f.win, false);
      f.footer.bindGitFooterActions();
      f.buttons.init.click();
      await Promise.resolve();
      assert.equal(f.sent.length, 0);
      winConfirm(f.win, true);
      f.buttons.init.click();
      await Promise.resolve();
      assert.deepEqual(f.sent, [['explorer.git.init', {}]]);
    } finally { await f.win.happyDOM.abort(); }
  });
}

function winConfirm(win, answer) {
  win.teUI = { dialog: { confirm: async () => answer } };
}

test('initialized empty and committed repositories hide Init; other-project facts cannot change it', async () => {
  const f = fixture();
  try {
    f.status({ isRepository: false, hasHead: false });
    assertInit(f.buttons, true);
    f.status({ isRepository: true, hasHead: false,
      diffBase: { ref: 'HEAD', mode: 'head', commit: null } });
    assertInit(f.buttons, false);
    f.status({ isRepository: true, hasHead: true, branch: 'main',
      head: { full: 'abc', short: 'abc' } });
    assertInit(f.buttons, false);
    f.status({ projectPath: '/old-project', isRepository: false });
    assertInit(f.buttons, false);
    f.status({ isRepository: false, hasHead: false,
      diffBase: { ref: 'HEAD', mode: 'none', commit: null } });
    assertInit(f.buttons, true);
  } finally { await f.win.happyDOM.abort(); }
});
