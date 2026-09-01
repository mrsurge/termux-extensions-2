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
  const window = new Window({
    url: 'http://127.0.0.1/apps/by-id/code_te2',
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    CSS: window.CSS,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLLIElement: window.HTMLLIElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLUListElement: window.HTMLUListElement,
    Event: window.Event,
    MutationObserver: window.MutationObserver,
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  return window;
}

function rect(top, height = 40, left = 0, width = 320) {
  return {
    x: left,
    y: top,
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

test('tree diagnostic markers never become part of the canonical filename', async () => {
  installDom();
  const {
    getCanonicalTreeNodeName,
    renderExplorerTreeLabel,
  } = await importTypeScript('src/explorer/tree/label.ts');

  const node = document.createElement('li');
  node.dataset.rel = 'src/checker.py';
  node.dataset.name = 'checker.py';
  const label = document.createElement('span');
  renderExplorerTreeLabel(label, 'checker.py');
  node.appendChild(label);

  assert.equal(label.textContent, 'checker.py');
  assert.equal(label.querySelector('.fe-diag-mark')?.textContent, '');
  assert.equal(getCanonicalTreeNodeName(node), 'checker.py');

  label.append(' 🔴');
  assert.equal(getCanonicalTreeNodeName(node), 'checker.py');

  delete node.dataset.name;
  assert.equal(getCanonicalTreeNodeName(node), 'checker.py');
});

test('tree renderer gives root and entries canonical names with structural labels', async () => {
  installDom();
  const { createExplorerTreeRenderer } = await importTypeScript(
    'src/explorer/tree/renderer.ts',
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
  const root = tree.querySelector('.fe-tree-root');
  const childList = root.querySelector(':scope > ul.fe-tree');
  renderer.renderEntriesInto(childList, [
    { rel: 'src', name: 'src', kind: 'dir' },
    { rel: 'README.md', name: 'README.md', kind: 'file' },
  ]);

  assert.equal(root.dataset.name, 'project');
  assert.equal(root.dataset.treeDepth, '0');
  assert.equal(root.dataset.depthParity, 'even');
  assert.equal(root.querySelector('.fe-tree-text')?.textContent, 'project');
  const src = tree.querySelector('[data-rel="src"]');
  assert.equal(src?.dataset.treeDepth, '1');
  assert.equal(src?.dataset.depthParity, 'odd');
  const nestedList = document.createElement('ul');
  nestedList.className = 'fe-tree';
  src?.appendChild(nestedList);
  renderer.renderEntriesInto(nestedList, [
    { rel: 'src/explorer', name: 'explorer', kind: 'dir' },
  ]);
  const nestedDirectory = tree.querySelector('[data-rel="src/explorer"]');
  assert.equal(nestedDirectory?.dataset.treeDepth, '2');
  assert.equal(nestedDirectory?.dataset.depthParity, 'even');
  assert.equal(
    tree.querySelector('[data-rel="README.md"]')?.dataset.name,
    'README.md',
  );
  assert.equal(
    tree.querySelector('[data-rel="README.md"]')?.dataset.treeDepth,
    undefined,
  );
  assert.equal(
    tree.querySelector('[data-rel="README.md"] .fe-tree-text')?.textContent,
    'README.md',
  );
});

test('clean expanded directory bands exclude every Git decoration', () => {
  installDom();
  const css = fs.readFileSync(
    path.join(appRoot, 'main_page/frontend/explorer.css'),
    'utf8',
  );
  assert.match(
    css,
    /data-open="true"\]\[data-depth-parity="odd"\]:not\(\s*\[data-git-flags\]\s*\):where\(:not\(\[data-git-status\]\), \[data-git-status="clean"\]\)/,
  );

  const directory = document.createElement('li');
  directory.dataset.kind = 'dir';
  directory.dataset.open = 'true';
  directory.dataset.depthParity = 'odd';
  const eligibleSelector =
    '[data-kind="dir"][data-open="true"][data-depth-parity="odd"]' +
    ':not([data-git-flags])' +
    ':where(:not([data-git-status]), [data-git-status="clean"])';

  assert.equal(directory.matches(eligibleSelector), true);
  directory.classList.add('fe-dir-has-draft', 'fe-dir-has-diag-error');
  assert.equal(directory.matches(eligibleSelector), true);
  directory.dataset.gitStatus = 'modified';
  assert.equal(directory.matches(eligibleSelector), false);
  directory.dataset.gitStatus = 'clean';
  directory.dataset.gitFlags = 'modified';
  assert.equal(directory.matches(eligibleSelector), false);
});

test('sticky scope constraints reserve normal rows and compress inner scopes', async () => {
  const {
    STICKY_SCOPE_END_LEAD_PX,
    computeStickyScopePush,
    computeStickyScopeSlotLimit,
    constrainStickyScopeChain,
  } = await importTypeScript('src/explorer/chrome/sticky-scopes.ts');

  assert.equal(computeStickyScopeSlotLimit(500, 40, 12), 4);
  assert.equal(computeStickyScopeSlotLimit(200, 40, 12), 1);
  assert.equal(computeStickyScopeSlotLimit(1200, 40, 3), 3);

  assert.deepEqual(constrainStickyScopeChain(['a', 'b', 'c', 'd'], 3), [
    ['a'],
    ['b'],
    ['c', 'd'],
  ]);
  assert.deepEqual(constrainStickyScopeChain(['a', 'b', 'c'], 1), [
    ['a', 'b', 'c'],
  ]);

  assert.equal(STICKY_SCOPE_END_LEAD_PX, 8);
  assert.equal(computeStickyScopePush(384, 376, 38), 0);
  assert.equal(computeStickyScopePush(376, 376, 38), -8);
  assert.equal(computeStickyScopePush(371, 376, 38), -13);
  assert.equal(computeStickyScopePush(334, 366, 38), -38);
  assert.equal(computeStickyScopePush(300, 366, 38), -38);
});

test('compressed sticky scope renders canonical clickable path segments', async () => {
  const window = installDom();
  const { createExplorerStickyScopes } = await importTypeScript(
    'src/explorer/chrome/sticky-scopes.ts',
  );

  const drawer = document.createElement('div');
  const tree = document.createElement('ul');
  tree.id = 'fe-file-tree';
  drawer.appendChild(tree);
  document.body.appendChild(drawer);

  const createNode = (rel, name, kind = 'dir') => {
    const node = document.createElement('li');
    node.className = 'fe-tree-node';
    node.dataset.rel = rel;
    node.dataset.name = name;
    node.dataset.kind = kind;
    if (kind === 'dir') node.dataset.open = 'true';
    const label = document.createElement('span');
    label.className = 'fe-tree-text';
    label.textContent = name;
    node.appendChild(label);
    node.getBoundingClientRect = () => rect(-80, 40, 8, 300);
    return node;
  };

  const root = createNode('.', 'project');
  root.classList.add('fe-tree-root', 'fe-dir-has-diag-error');
  root.dataset.treeDepth = '0';
  root.dataset.depthParity = 'even';
  let rootSearchClicks = 0;
  const rootActions = document.createElement('div');
  rootActions.className = 'fe-tree-root-actions';
  const rootSearchButton = document.createElement('button');
  rootSearchButton.className = 'fe-tree-search-btn';
  rootSearchButton.textContent = '🔍';
  rootSearchButton.addEventListener('click', () => {
    rootSearchClicks += 1;
  });
  const rootMenuButton = document.createElement('button');
  rootMenuButton.className = 'fe-card-menu-btn';
  rootMenuButton.textContent = '⋮';
  rootActions.append(rootSearchButton, rootMenuButton);
  root.appendChild(rootActions);
  const src = createNode('src', 'src');
  src.dataset.treeDepth = '1';
  src.dataset.depthParity = 'odd';
  const feature = createNode('src/feature', 'feature');
  feature.dataset.treeDepth = '2';
  feature.dataset.depthParity = 'even';
  const deep = createNode('src/feature/deep', 'deep');
  deep.dataset.treeDepth = '3';
  deep.dataset.depthParity = 'odd';
  const file = createNode('src/feature/deep/file.ts', 'file.ts', 'file');
  file.getBoundingClientRect = () => rect(80, 40, 8, 300);

  const appendChild = (parent, child) => {
    let list = parent.querySelector(':scope > ul.fe-tree');
    if (!list) {
      list = document.createElement('ul');
      list.className = 'fe-tree';
      parent.appendChild(list);
    }
    list.appendChild(child);
  };
  tree.appendChild(root);
  appendChild(root, src);
  appendChild(src, feature);
  appendChild(feature, deep);
  appendChild(deep, file);

  tree.getBoundingClientRect = () => rect(0, 200, 0, 320);
  drawer.getBoundingClientRect = () => rect(0, 200, 0, 320);
  Object.defineProperties(tree, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1000 },
  });
  tree.scrollTop = 300;
  document.elementsFromPoint = () => [file];
  document.elementFromPoint = () => file;
  const openedMenuEntries = [];

  const sticky = createExplorerStickyScopes({
    treeElement: tree,
    drawerBodyEl: drawer,
    openCardMenuForEntry: (entry) => openedMenuEntries.push(entry),
  });
  sticky.update();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  const slots = drawer.querySelectorAll('.fe-sticky-scope-slot');
  assert.equal(slots.length, 1);
  assert.deepEqual(
    [...slots[0].querySelectorAll('.fe-sticky-scope-segment')].map(
      (segment) => segment.textContent,
    ),
    ['project', 'src', 'feature', 'deep'],
  );
  assert.equal(slots[0].querySelector('.fe-tree-text')?.textContent, 'project/src/feature/deep');
  assert.equal(slots[0].querySelector('li')?.dataset.name, 'deep');
  assert.equal(slots[0].querySelector('li')?.dataset.open, 'true');
  assert.equal(slots[0].querySelector('li')?.dataset.treeDepth, '3');
  assert.equal(slots[0].querySelector('li')?.dataset.depthParity, 'odd');
  slots[0]
    .querySelector('[data-rel="src/feature"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.notEqual(tree.scrollTop, 300);
  tree.scrollTop = 300;
  sticky.update();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  const stickySearchButton = slots[0].querySelector('.fe-tree-search-btn');
  assert.ok(stickySearchButton);
  stickySearchButton.click();
  assert.equal(rootSearchClicks, 1);

  const rootLabel = root.querySelector(':scope > .fe-tree-text');
  const sourceInput = document.createElement('input');
  sourceInput.className = 'fe-tree-search-input';
  rootLabel.replaceChildren(sourceInput);
  const sourceCount = document.createElement('span');
  sourceCount.className = 'fe-tree-search-control fe-tree-search-count';
  sourceCount.textContent = '1/2';
  const sourcePrevious = document.createElement('button');
  sourcePrevious.className = 'fe-tree-search-control fe-tree-search-prev';
  sourcePrevious.textContent = '↑';
  const sourceNext = document.createElement('button');
  sourceNext.className = 'fe-tree-search-control fe-tree-search-next';
  sourceNext.textContent = '↓';
  const sourceClear = document.createElement('button');
  sourceClear.className = 'fe-tree-search-control fe-tree-search-clear';
  sourceClear.textContent = '✕';
  rootActions.replaceChildren(
    sourceCount,
    sourcePrevious,
    sourceNext,
    sourceClear,
    rootMenuButton,
  );
  assert.ok(
    root.querySelector(':scope > .fe-tree-text .fe-tree-search-input'),
  );
  sticky.update();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  const stickySearchInput = slots[0].querySelector('.fe-tree-search-input');
  assert.ok(stickySearchInput, slots[0].outerHTML);
  assert.equal(slots[0].querySelector('.fe-tree-search-count')?.textContent, '1/2');
  stickySearchInput.value = 'src';
  stickySearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(sourceInput.value, 'src');
  let sourceFocusOutCount = 0;
  sourceInput.addEventListener('focusout', () => {
    sourceFocusOutCount += 1;
  });
  stickySearchInput.focus();
  assert.equal(document.activeElement, stickySearchInput);
  document.elementsFromPoint = () => [feature];
  document.elementFromPoint = () => feature;
  sticky.update();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const preservedStickySearchInput = drawer.querySelector(
    '.fe-sticky-scope-slot .fe-tree-search-input',
  );
  assert.strictEqual(preservedStickySearchInput, stickySearchInput);
  assert.equal(document.activeElement, stickySearchInput);
  assert.equal(sourceFocusOutCount, 0);
  assert.equal(slots[0].querySelector('li')?.dataset.rel, 'src/feature');
  slots[0].querySelector('.fe-card-menu-btn').click();
  assert.equal(openedMenuEntries.at(-1)?.rel, 'src/feature');

  stickySearchInput.dispatchEvent(new window.Event('blur'));
  assert.equal(sourceFocusOutCount, 1);

  file.getBoundingClientRect = () => rect(0, 0, 0, 0);
  sticky.update();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  assert.equal(drawer.querySelectorAll('.fe-sticky-scope-slot').length, 1);
  assert.ok(
    drawer.querySelector('.fe-sticky-scope-slot .fe-tree-search-input'),
  );

  sticky.destroy();
});
