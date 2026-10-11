import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { selectPaths } from '../app/static/js/file_explorer_selection.mjs';

const bundle = await build({ entryPoints: [new URL('../app/apps/file_explorer/src/viewport.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createViewport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

class Node {
  constructor(document, tag = 'div') { this.ownerDocument = document; this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.events = new Map(); this.className = ''; this.value = ''; this.textContent = ''; }
  get classList() { return { contains: value => this.className.split(' ').includes(value), add: value => { if (!this.className.split(' ').includes(value)) this.className += ` ${value}`; }, toggle: (value, enabled) => { const classes = this.className.split(' ').filter(item => item && item !== value); if (enabled) classes.push(value); this.className = classes.join(' '); } }; }
  get parentElement() { return this.parent ?? null; }
  get isConnected() { return Boolean(this.parent || this.root); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(name, listener) { const listeners = this.events.get(name) ?? []; listeners.push(listener); this.events.set(name, listeners); }
  removeEventListener(name, listener) { this.events.set(name, (this.events.get(name) ?? []).filter(item => item !== listener)); }
  matches(selector) { return selector.split(',').some(part => { const s = part.trim(); if (s.startsWith('.')) return this.classList.contains(s.slice(1)); if (s === '[data-path]') return Boolean(this.dataset.path); if (s === '[data-role="selection-icon"]') return this.dataset.role === 'selection-icon'; return false; }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  setSelectionRange() {}
}

function fixture() {
  const document = { activeElement: null, createElement(tag) { return new Node(this, tag); } };
  const container = new Node(document); container.root = true;
  const ui = Object.fromEntries(['breadcrumbs', 'listContainer', 'gridContainer', 'clearSelection', 'selectionCount'].map(key => [key, new Node(document)]));
  container.append(...Object.values(ui));
  const filterInput = new Node(document, 'input'), filterError = new Node(document);
  const entries = [{ name: 'b.js', path: '/project/b.js', type: 'file' }, { name: 'a.py', path: '/project/a.py', type: 'file' }, { name: 'dir', path: '/project/dir', type: 'directory' }];
  const state = { currentPath: '/project', entries, selected: null, selectedPaths: new Set(), view: 'list', sortBy: 'name', sortAsc: true };
  let deliver, cancelled = 0, updates = 0;
  const requests = [], navigations = [], bound = [];
  const viewport = createViewport({ container, state, ui, filterInput, filterError,
    contextMenuReady: Promise.resolve({ close() {}, bind(...args) { bound.push(args); } }),
    createListingFilter(callback) { deliver = callback; return { apply(entries, pattern) { requests.push({ entries, pattern }); if (!pattern) callback(entries, ''); }, cancel() { cancelled++; } }; },
    selectPaths, getIcon: async () => ({ codicon: 'file' }), renderIcon() {}, isArchive: () => false,
    modeToString: () => '', formatOwnership: () => '', formatSize: () => '', formatDate: () => '', parentPath: () => '/',
    updateActionButtons() { updates++; }, closeAllMenus() {}, loadDirectory(path) { navigations.push(path); }, openSelected() {}, followSymlink() {}, deleteSelected() {},
  });
  return { viewport, document, container, ui, state, entries, filterInput, filterError, requests, navigations, bound, deliver: (...args) => deliver(...args), cancelled: () => cancelled, updates: () => updates };
}

test('viewport sorted visible order drives select-all and single selection projection', () => {
  const f = fixture(); f.viewport.refreshFilter();
  assert.deepEqual(f.ui.listContainer.children.map(node => node.dataset.path), ['/project/dir', '/project/a.py', '/project/b.js']);
  f.viewport.selectAllItems(true); assert.equal(f.state.selectedPaths.size, 3); assert.equal(f.state.selected, null);
  f.filterInput.value = 'py'; f.deliver([f.entries[1]], '');
  assert.deepEqual([...f.state.selectedPaths], ['/project/a.py']); assert.equal(f.state.selected, f.entries[1]);
  f.viewport.clearSelection(); assert.equal(f.ui.clearSelection.hidden, true); assert.equal(f.state.selected, null);
});

test('filter reset clears transient input/error without issuing a listing request', () => {
  const f = fixture(); f.filterInput.value = 'old'; f.deliver([], 'bad regex');
  f.viewport.resetFilter();
  assert.equal(f.filterInput.value, ''); assert.equal(f.filterError.textContent, ''); assert.equal(f.filterInput.attributes.get('aria-invalid'), 'false');
  assert.equal(f.requests.length, 0); assert.equal(f.cancelled(), 1);
  f.viewport.refreshFilter(); assert.equal(f.requests[0].pattern, ''); assert.equal(f.ui.listContainer.children.length, 3);
});

test('directory handoff restores listing focus after loading and filter delivery', () => {
  const f = fixture(); f.viewport.refreshFilter(); f.ui.listContainer.children[1].focus();
  f.viewport.captureListingFocus(); f.viewport.cancelFilter(); f.viewport.setLoading(); f.viewport.resetFilter(); f.viewport.finishLoading();
  assert.equal(f.document.activeElement, f.ui.listContainer.children[0]);
});

test('entry names are text, not HTML, and breadcrumbs navigate via caller', () => {
  const f = fixture(); f.state.entries = [{ name: '<img src=x>', path: '/project/<img src=x>', type: 'file' }];
  f.viewport.refreshFilter(); assert.equal(f.ui.listContainer.querySelector('.fx-name').textContent, '<img src=x>');
  f.viewport.renderBreadcrumbs(); f.ui.breadcrumbs.children[0].events.get('click')[0](); assert.deepEqual(f.navigations, ['/']);
});

test('dispose rejects late filter delivery and removes the input listener', () => {
  const f = fixture(); f.viewport.refreshFilter(); f.viewport.dispose(); const before = f.ui.listContainer.children;
  f.deliver([], 'late'); assert.equal(f.ui.listContainer.children, before); assert.equal(f.filterError.textContent, '');
  assert.equal(f.filterInput.events.get('input').length, 0); assert.equal(f.cancelled(), 1);
});

test('pending directory listing cannot resurrect old entries through filter or view changes', () => {
  const f = fixture(); f.viewport.refreshFilter(); f.viewport.setLoading();
  const requests = f.requests.length;
  f.viewport.refreshFilter(); f.viewport.renderEntries(); f.deliver(f.entries, 'late');
  assert.equal(f.requests.length, requests);
  assert.equal(f.ui.listContainer.children[0].textContent, 'Loading...');
  assert.equal(f.filterInput.disabled, true);
  f.state.entries = [{ name: 'new', path: '/new/new', type: 'file' }];
  f.viewport.finishLoading();
  assert.equal(f.filterInput.disabled, false);
  assert.equal(f.ui.listContainer.children[0].dataset.path, '/new/new');
});

test('failed listing releases input without reviving the previous directory', () => {
  const f = fixture(); f.viewport.refreshFilter(); f.viewport.setLoading();
  f.state.entries = []; f.viewport.finishLoading(false); f.viewport.renderEntries();
  assert.equal(f.filterInput.disabled, false);
  assert.equal(f.ui.listContainer.querySelector('[data-path]'), null);
});
