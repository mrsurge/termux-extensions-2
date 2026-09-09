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

// Direct completion and the queued switch fact may straddle tree/Git delivery.
for (const order of [
  ['opened', 'list', 'git', 'opened'],
  ['list', 'git', 'opened', 'opened'],
  ['opened', 'opened', 'list', 'git'],
]) {
  test(`project completion preserves tree and Git title: ${order.join(', ')}`, async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    globalThis.document = win.document;
    globalThis.HTMLElement = win.HTMLElement;
    const { createExplorerNotificationHandler } = await importNotifications();
    const tree = document.createElement('ul'); document.body.append(tree);
    let project = '/old', renderedProject = '/old', label = '', active = 'old.txt';
    let gitStatus = { branch: 'old', head: { short: 'oldhash' } };
    let resets = 0, completions = 0;
    const dirs = new Set(['old-dir']);
    const handler = createExplorerNotificationHandler({
      runtimeState: {
        getProjectPath: () => project,
        setProjectPath: value => { project = value; },
        getRenderedProjectPath: () => renderedProject,
        setGitStatus: value => { gitStatus = value; },
        getReconnectResyncPending: () => false,
      },
      getTreeElement: () => tree, getOpenDirectories: () => dirs,
      setOpenDirsInitialized() {}, setActiveFileRel: value => { active = value; },
      renderBranchLabel: () => { label = gitStatus ? `${gitStatus.branch} ${gitStatus.head.short}` : 'pending'; },
      renderExplorerTree() {
        resets++; renderedProject = project;
        tree.innerHTML = '<li class="fe-tree-node fe-tree-root"><span class="fe-tree-text"></span><ul class="fe-tree" data-tree-view="normal"></ul></li>';
      },
      renderEntriesInto(node, entries) {
        node.replaceChildren(...entries.map(entry => {
          const li = document.createElement('li'); li.textContent = entry.name; return li;
        }));
      },
      renderGitSummary() {}, setGitControlsEnabled() {},
      initDiffBaseFromBackend: async () => {},
      marketplaceController: { closeMarketplace() {} },
      nameSearchController: { close() {}, render() {} },
      searchOverlayController: { closeSearchOverlay() {}, isVisible: () => false },
      basename: value => value.split('/').pop(),
      notifyDirListComplete() {}, applyActiveFileMarker() {},
      dispatchProjectOpened() { completions++; },
    });
    const notify = (method, payload) => handler.handleExplorerNotification(`explorer.${method}`, payload);
    notify('project.active.updated', { path: '/new' });
    assert.equal(active, null); assert.equal(dirs.size, 0); assert.equal(label, 'pending');
    dirs.add('src'); active = 'new.txt';
    for (const event of order) {
      if (event === 'opened') notify('project.opened', { resolved_path: '/new', switchId: 'switch-1' });
      if (event === 'list') notify('list.updated', { cwd: '.', entries: [{ name: 'new.txt' }] });
      if (event === 'git') notify('git.status.updated', { projectPath: '/new', branch: 'main', head: { full: 'abcdef123', short: 'abcdef1' } });
    }
    assert.match(tree.textContent, /new.txt/); assert.equal(label, 'main abcdef1');
    assert.equal(active, 'new.txt'); assert.deepEqual([...dirs], ['src']);
    assert.equal(resets, 1); assert.equal(completions, 2);
    notify('project.opened', { resolved_path: '/third' });
    assert.equal(resets, 2); assert.equal(tree.textContent, ''); assert.equal(label, 'pending');
    await win.happyDOM.abort();
  });
}
