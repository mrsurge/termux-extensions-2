import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';
import { selectPaths } from '../../../static/js/file_explorer_selection.mjs';
import { createItemContextMenu } from '../../../static/js/te_file_explorer_context.mjs';

const root = path.resolve(import.meta.dirname, '../../../..');
const source = await readFile(path.join(root, 'app/apps/file_explorer/main.js'), 'utf8');
const selection = source.slice(source.indexOf('  function clearSelection()'), source.indexOf('  function setDisabledState('));
const rendering = source.slice(source.indexOf('  function selectEntry('), source.indexOf('  async function loadDirectory('));

function fixture() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main><div id="list"></div><div id="grid"></div><button id="clear"></button><span id="count"></span></main>';
  const container = document.querySelector('main');
  const entries = ['a.py', 'b.mjs', 'c.rs', 'd.md'].map(name => ({ name, path: '/' + name, type: 'file' }));
  const state = { entries, selectedPaths: new Set(), sortBy: 'name', sortAsc: true };
  const ui = { listContainer: document.querySelector('#list'), gridContainer: document.querySelector('#grid'), clearSelection: document.querySelector('#clear'), selectionCount: document.querySelector('#count') };
  const opens = [];
  const icons = [];
  const context = { document, container, state, ui, selectPaths, console,
    contextMenuReady: Promise.resolve({ close() {}, bind() {} }),
    updateActionButtons() {}, closeAllMenus() {}, isEditableFile: () => true, isArchive: () => false,
    modeToString: () => '', formatOwnership: () => '', formatSize: () => '', formatDate: () => '',
    renderIcon: (element, icon) => { element.dataset.icon = icon.codicon; },
    getIcon: async name => { icons.push(name); return { codicon: 'file-code' }; },
    openSelected: () => opens.push(state.selected?.path), loadDirectory: () => {}, followSymlink: () => {},
  };
  const methods = vm.runInNewContext(selection + rendering + '\n({renderEntries, clearSelection, selectAllItems, selectEntry});', context);
  methods.renderEntries();
  const click = (node, options = {}, type = 'click') => node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, ...options }));
  return { window, state, ui, methods, opens, icons, click };
}

for (const view of ['listContainer', 'gridContainer']) {
  test(`${view}: icon toggles, body selects, mirrored state survives rerender`, () => {
    const f = fixture();
    const rows = () => [...f.ui[view].children];
    f.click(rows()[0].querySelector('button'));
    f.click(rows()[1].querySelector('button'));
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/b.mjs']);
    assert.equal(f.state.selected, null);
    assert.equal(f.ui.clearSelection.hidden, false);
    assert.equal(f.ui.listContainer.querySelectorAll('.selected').length, 2);
    assert.equal(f.ui.gridContainer.querySelectorAll('.selected').length, 2);
    f.methods.renderEntries();
    assert.equal(rows()[0].querySelector('button').getAttribute('aria-pressed'), 'true');
    f.click(rows()[0].querySelector('button'), {}, 'dblclick');
    assert.equal(f.opens.length, 0);
    f.click(rows()[2].querySelector('.fx-name-group, .fx-name-tile'));
    assert.deepEqual([...f.state.selectedPaths], ['/c.rs']);
    assert.equal(f.state.selected.path, '/c.rs');
    f.click(rows()[2], {}, 'dblclick');
    assert.deepEqual(f.opens, ['/c.rs']);
    f.methods.clearSelection();
    assert.equal(f.state.selected, null);
    assert.equal(f.ui.clearSelection.hidden, true);
  });
  test(`${view}: anchored ranges, additive ranges and modifier opening guard`, () => {
    const f = fixture();
    const rows = [...f.ui[view].children];
    f.click(rows[0]);
    f.click(rows[2], { shiftKey: true });
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/b.mjs', '/c.rs']);
    f.click(rows[1], { ctrlKey: true });
    assert.deepEqual([...f.state.selectedPaths], ['/a.py', '/c.rs']);
    f.click(rows[3], { metaKey: true, shiftKey: true });
    assert.equal(f.state.selectedPaths.size, 4);
    f.click(rows[3], { shiftKey: true }, 'dblclick');
    assert.equal(f.opens.length, 0);
    f.methods.selectAllItems(true);
    assert.equal(f.state.selectedPaths.size, 4);
  });
}

test('range uses displayed order and absent anchors become single selections', () => {
  assert.deepEqual([...selectPaths(new Set(), ['c','b','a'], 'c', 'a', { shift: true }).selected], ['c','b','a']);
  assert.deepEqual([...selectPaths(new Set(['old']), ['a','b'], 'missing', 'b', { shift: true }).selected], ['b']);
});

test('context on a selected item preserves batch, unrelated item replaces it', () => {
  const f = fixture();
  const start = source.indexOf('select: (entry, nodes) => {') + 'select: (entry, nodes) => {'.length;
  const end = source.indexOf('\n    } }));', start);
  const select = vm.runInNewContext('(entry, nodes) => {' + source.slice(start, end) + '}', {
    state: f.state, closeAllMenus() {}, selectEntry: f.methods.selectEntry,
  });
  f.click(f.ui.listContainer.children[0].querySelector('button'));
  f.click(f.ui.listContainer.children[1].querySelector('button'));
  select(f.state.entries[0], {});
  assert.equal(f.state.selectedPaths.size, 2);
  select(f.state.entries[2], {});
  assert.deepEqual([...f.state.selectedPaths], ['/c.rs']);
});

test('file selection checkboxes are removed without removing settings checkboxes', async () => {
  const template = await readFile(path.join(root, 'app/apps/file_explorer/template.html'), 'utf8');
  assert.ok(!template.includes('fx-checkbox'));
  assert.ok(!source.includes('fx-checkbox'));
  assert.match(template, /data-action="clear-selection" hidden/);
  assert.ok(template.includes('type="checkbox" data-role="perm-owner-read"'));
  assert.match(source, /getIcon\(entry.name\)/);
});

test('Escape clears selection but leaves inputs and dialogs to their owners', () => {
  const f = fixture();
  const start = source.indexOf('  document.addEventListener("keydown",');
  const end = source.indexOf('\n  setPropertiesModalOpen(false);', start);
  const noop = () => {};
  vm.runInNewContext(source.slice(start, end), { document: f.window.document, ui: f.ui,
    menuGroups: [], clearSelection: f.methods.clearSelection, closeAllMenus: noop,
    closePropertiesModal: noop, closeEditBookmarksModal: noop, closeBookmarkFormModal: noop });
  f.methods.selectAllItems(true);
  const input = f.window.document.createElement('input');
  f.window.document.body.appendChild(input);
  input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 4);
  f.ui.propertiesModal = { dataset: { open: 'true' } };
  f.window.document.body.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 4);
  f.ui.propertiesModal.dataset.open = 'false';
  f.window.document.body.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.state.selectedPaths.size, 0);
});

test('context menu targets body, not the selection icon', () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<main><div class="fx-menu-group" data-menu="file"><button data-command="file:copy">Copy</button></div><div id="item"><button data-role="selection-icon">icon</button><span>body</span></div></main>';
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document; globalThis.window = window;
  try {
    const selected = [];
    const menu = createItemContextMenu({ container: document.querySelector('main'), select: entry => selected.push(entry.path), dispatch() {} });
    const item = document.querySelector('#item');
    menu.bind(item, { path: '/file' }, {});
    item.querySelector('button').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    assert.equal(selected.length, 0);
    item.querySelector('span').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
    assert.deepEqual(selected, ['/file']);
    assert.ok(document.querySelector('.fx-context-menu'));
    menu.close();
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; window.happyDOM.abort(); }
});
