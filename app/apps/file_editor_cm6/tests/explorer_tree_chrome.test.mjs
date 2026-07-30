import assert from 'node:assert/strict';
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
    url: 'http://127.0.0.1/apps/by-id/file_editor_cm6',
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    CSS: window.CSS,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLLIElement: window.HTMLLIElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLUListElement: window.HTMLUListElement,
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
  assert.equal(root.querySelector('.fe-tree-text')?.textContent, 'project');
  assert.equal(
    tree.querySelector('[data-rel="README.md"]')?.dataset.name,
    'README.md',
  );
  assert.equal(
    tree.querySelector('[data-rel="README.md"] .fe-tree-text')?.textContent,
    'README.md',
  );
});

test('sticky scope constraints reserve normal rows and compress inner scopes', async () => {
  const {
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
  const src = createNode('src', 'src');
  const feature = createNode('src/feature', 'feature');
  const deep = createNode('src/feature/deep', 'deep');
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

  const sticky = createExplorerStickyScopes({
    treeElement: tree,
    drawerBodyEl: drawer,
    openCardMenuForEntry: () => {},
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

  slots[0]
    .querySelector('[data-rel="src/feature"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.notEqual(tree.scrollTop, 300);

  sticky.destroy();
});
