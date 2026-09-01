import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { Window } from 'happy-dom';

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

function installDom() {
  const window = new Window({ url: 'http://127.0.0.1/apps/by-id/code_te2' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    CSS: window.CSS,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLLIElement: window.HTMLLIElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLUListElement: window.HTMLUListElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  });
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options) {
    this.__scrollOptions = options;
  };
  return window;
}

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

test('name hits become an expanded tree and matching directories gain only shallow children', async () => {
  const { buildExplorerNameTreeProjection } = await importTypeScript(
    'src/explorer/search/name-tree-controller.ts',
  );
  const projection = buildExplorerNameTreeProjection(
    [
      { rel: 'src', name: 'src', type: 'dir' },
      { rel: 'tests/unit.spec.ts', name: 'unit.spec.ts', type: 'file' },
      { rel: 'src/deep/file.ts', name: 'file.ts', type: 'file' },
    ],
    new Map([
      [
        'src',
        [
          { rel: 'src/a.ts', name: 'a.ts', kind: 'file' },
          { rel: 'src/deep', name: 'deep', kind: 'dir' },
        ],
      ],
    ]),
  );

  const nodes = flatten(projection);
  const byRel = new Map(nodes.map((node) => [node.entry.rel, node]));
  assert.equal(byRel.get('src')?.hitIndex, 0);
  assert.equal(byRel.get('tests/unit.spec.ts')?.hitIndex, 1);
  assert.equal(byRel.get('src/deep/file.ts')?.hitIndex, 2);
  assert.equal(byRel.get('src/a.ts')?.hitIndex, null);
  assert.deepEqual(
    byRel.get('src')?.children.map((node) => node.entry.rel),
    ['src/deep', 'src/a.ts'],
  );
  assert.deepEqual(
    byRel.get('src/deep')?.children.map((node) => node.entry.rel),
    ['src/deep/file.ts'],
  );
});

test('selecting a directory preserves its normal-tree chain and closes only unrelated branches', async () => {
  installDom();
  const {
    getExplorerDirectoryChain,
    reconcileExplorerNormalTreeOpenDirectories,
  } = await importTypeScript(
    'src/explorer/tree/view-utils.ts',
  );
  const normalTree = document.createElement('ul');

  const createDirectory = (rel) => {
    const node = document.createElement('li');
    node.className = 'fe-tree-node';
    node.dataset.kind = 'dir';
    node.dataset.rel = rel;
    node.dataset.open = 'true';
    const children = document.createElement('ul');
    children.className = 'fe-tree';
    node.appendChild(children);
    return { node, children };
  };

  const src = createDirectory('src');
  const feature = createDirectory('src/feature');
  const nested = createDirectory('src/feature/nested');
  feature.children.appendChild(nested.node);
  src.children.appendChild(feature.node);
  const unrelated = createDirectory('tests');
  unrelated.children.appendChild(createDirectory('tests/unit').node);
  normalTree.append(src.node, unrelated.node);

  const projection = getExplorerDirectoryChain('src/feature');
  assert.deepEqual(projection, ['src', 'src/feature']);
  reconcileExplorerNormalTreeOpenDirectories(normalTree, projection);
  assert.equal(src.node.dataset.open, 'true');
  assert.ok(src.node.querySelector(':scope > ul.fe-tree'));
  assert.equal(feature.node.dataset.open, 'true');
  assert.ok(feature.node.querySelector(':scope > ul.fe-tree'));
  assert.equal(nested.node.dataset.open, 'false');
  assert.equal(nested.node.querySelector(':scope > ul.fe-tree'), null);
  assert.equal(unrelated.node.dataset.open, 'false');
  assert.equal(unrelated.node.querySelector(':scope > ul.fe-tree'), null);
});

test('inline name search preserves the normal tree, cycles hits, and obeys clear/blur semantics', async () => {
  const window = installDom();
  const { createExplorerTreeRenderer } = await importTypeScript(
    'src/explorer/tree/renderer.ts',
  );
  const { createExplorerNameTreeSearchController } = await importTypeScript(
    'src/explorer/search/name-tree-controller.ts',
  );
  const { createExplorerTreeClickHandler } = await importTypeScript(
    'src/explorer/tree/click-handler.ts',
  );

  const tree = document.createElement('ul');
  tree.id = 'fe-file-tree';
  document.body.appendChild(tree);
  let treeElement = tree;
  const renderer = createExplorerTreeRenderer({
    getTreeElement: () => treeElement,
    setTreeElement: (next) => {
      treeElement = next;
    },
    getProjectPath: () => '/workspace/project',
    clearElement: (element) => element.replaceChildren(),
    basename: (value) => value.split('/').filter(Boolean).at(-1) || '',
    isInSelectMode: () => false,
    isEntrySelected: () => false,
    setEntrySelected: () => {},
    applySetiIconToSpan: () => {},
    applyAggregatedGitStatusFlags: () => {},
    applyAggregatedDiagnosticFlags: () => {},
  });
  renderer.renderExplorerTree();
  const normal = tree.querySelector('[data-tree-view="normal"]');
  renderer.renderEntriesInto(normal, [
    { rel: 'keep', name: 'keep', kind: 'dir' },
    { rel: 'src', name: 'src', kind: 'dir' },
    { rel: 'README.md', name: 'README.md', kind: 'file' },
  ]);

  const requests = [];
  const focusedDirectories = [];
  let releaseDirectoryFocus = null;
  let stickyHeadersEnabled = false;
  const controller = createExplorerNameTreeSearchController({
    getTreeElement: () => tree,
    getProjectPath: () => '/workspace/project',
    isStickyHeadersEnabled: () => stickyHeadersEnabled,
    requestExplorer: async (method, payload) => {
      requests.push([method, payload]);
      if (method === 'explorer.search.run') {
        return { searchId: 'search-1', jobId: 'job-1', projectGeneration: 3 };
      }
      if (method === 'explorer.list') {
        return {
          cwd: payload.rel,
          entries: [
            {
              rel: `${payload.rel}/child.ts`,
              name: 'child.ts',
              kind: 'file',
            },
          ],
        };
      }
      return { ok: true };
    },
    renderEntriesInto: (container, entries, parentRel) =>
      renderer.renderEntriesInto(container, entries, parentRel),
    closeAdvancedSearch: () => {},
    focusDirectory: async (rel) => {
      focusedDirectories.push(rel);
      await new Promise((resolve) => {
        releaseDirectoryFocus = resolve;
      });
    },
    toast: () => {},
  });
  controller.bind(tree);
  const clickHandler = createExplorerTreeClickHandler({
    getTreeElement: () => tree,
    getProjectPath: () => '/workspace/project',
    getSelectModeDir: () => null,
    hasExplorerRpc: () => false,
    notifyExplorer: () => {},
    checkAutoDisableSelectMode: () => {},
    markDirectoryOpen: () => {},
    setEntrySelected: () => {},
    handleSearchDirectoryClick: (rel) =>
      controller.handleSearchDirectoryClick(rel),
    openCardMenuForEntry: () => {},
    openFile: async () => {},
  });
  tree.addEventListener('click', (event) => {
    void clickHandler.handleTreeClick(event);
  });

  tree.querySelector('.fe-tree-root').classList.add('fe-dir-has-diag-error');
  tree.querySelector('.fe-tree-search-btn').click();
  await window.happyDOM.waitUntilComplete();
  const input = tree.querySelector('.fe-tree-search-input');
  assert.ok(input);
  const stickyScopes = document.createElement('div');
  stickyScopes.className = 'fe-sticky-scopes';
  const stickyInput = document.createElement('input');
  stickyInput.className = 'fe-tree-search-input';
  stickyScopes.appendChild(stickyInput);
  document.body.appendChild(stickyScopes);
  input.focus();
  stickyInput.focus();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.isVisible(), true);
  input.focus();
  stickyScopes.remove();
  input.value = 'src';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 525));
  assert.equal(requests[0][0], 'explorer.search.run');

  controller.handleResultsUpdated({
    mode: 'name',
    query: 'src',
    searchId: 'search-1',
    jobId: 'job-1',
    complete: true,
    results: [
      { rel: 'src', name: 'src', type: 'dir' },
      { rel: 'src/main.ts', name: 'main.ts', type: 'file' },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(normal.hidden, true);
  assert.ok(tree.querySelector('[data-tree-view="search"] [data-rel="src"]'));
  assert.ok(
    tree.querySelector('[data-tree-view="search"] [data-rel="src/child.ts"]'),
  );
  assert.equal(
    tree.querySelector('.fe-tree-search-hit-active')?.dataset.rel,
    'src',
  );
  assert.equal(
    tree.querySelector('.fe-tree-search-hit-active')?.__scrollOptions,
    undefined,
  );

  tree.querySelector('.fe-tree-search-next').click();
  assert.equal(
    tree.querySelector('.fe-tree-search-hit-active')?.dataset.rel,
    'src/main.ts',
  );
  assert.deepEqual(
    tree.querySelector('.fe-tree-search-hit-active')?.__scrollOptions,
    { block: 'center', behavior: 'smooth' },
  );
  assert.equal(controller.isVisible(), true);

  tree.querySelector('.fe-tree-search-clear').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(normal.hidden, false);
  assert.ok(tree.querySelector('[data-rel="keep"]'));
  const emptyInput = tree.querySelector('.fe-tree-search-input');
  assert.ok(emptyInput);
  assert.equal(emptyInput.value, '');
  emptyInput.blur();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.isVisible(), false);
  assert.equal(tree.querySelector('.fe-tree-text')?.textContent, 'project');
  assert.ok(tree.querySelector('.fe-tree-text .fe-diag-mark'));

  stickyHeadersEnabled = true;
  controller.open();
  const reopenedInput = tree.querySelector('.fe-tree-search-input');
  reopenedInput.value = 'src';
  reopenedInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  controller.handleResultsUpdated({
    mode: 'name',
    query: 'src',
    complete: true,
    results: [{ rel: 'src', name: 'src', type: 'dir' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    tree.querySelector('.fe-tree-search-hit-active')?.__scrollOptions,
    { block: 'center', behavior: 'smooth' },
  );
  tree
    .querySelector('[data-tree-view="search"] [data-rel="src"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(focusedDirectories, ['src']);
  assert.equal(controller.isVisible(), true);
  assert.equal(typeof releaseDirectoryFocus, 'function');
  releaseDirectoryFocus();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.isVisible(), false);
  const selectedDirectory = normal.querySelector('[data-rel="src"]');
  assert.equal(selectedDirectory?.__scrollOptions, undefined);
  await new Promise((resolve) => setTimeout(resolve, 375));
  assert.deepEqual(selectedDirectory?.__scrollOptions, {
    block: 'center',
    behavior: 'smooth',
  });
});

test('advanced overlay no longer advertises By name and remains reachable from Explorer menu', () => {
  const overlaySource = fs.readFileSync(
    path.join(appRoot, 'src/explorer/search/overlay-controller.ts'),
    'utf8',
  );
  const template = fs.readFileSync(path.join(appRoot, 'template.html'), 'utf8');
  assert.doesNotMatch(overlaySource, /label:\s*["']By name["']/);
  for (const label of ['By contents', 'By changes', 'Drafts', 'Diagnostics']) {
    assert.match(overlaySource, new RegExp(`label:\\s*["']${label}["']`));
  }
  assert.match(template, /id="fe-mi-explorer-search-views"/);
  assert.doesNotMatch(template, /id="fe-search-btn"/);
});

test('inactive direct name hits retain a faint purple highlight', () => {
  const explorerCss = fs.readFileSync(
    path.join(appRoot, 'main_page/frontend/explorer.css'),
    'utf8',
  );
  const inactiveRule = explorerCss.match(
    /\.fe-tree-node\.fe-tree-search-hit\s*\{(?<body>[^}]+)\}/,
  );
  assert.ok(inactiveRule?.groups?.body);
  assert.match(inactiveRule.groups.body, /background:\s*rgba\(139, 92, 246, 0\.18\)/);
  assert.match(inactiveRule.groups.body, /box-shadow:\s*inset 3px 0 0/);
  assert.ok(
    explorerCss.indexOf('.fe-tree-node.fe-tree-search-hit-active') >
      explorerCss.indexOf('.fe-tree-node.fe-tree-search-hit {'),
  );
});
