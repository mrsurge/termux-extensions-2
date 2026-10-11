import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';

async function compiled(name) {
  const entry = new URL(`../app/apps/file_explorer/src/${name}.ts`, import.meta.url).pathname;
  const { outputFiles } = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const { createListingKeyboard, bindTerminalShortcut } = await compiled('keyboard');
const { createItemContextMenu, createMenubar } = await compiled('menubar');
function fixture() {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, Node: window.Node });
  window.document.body.innerHTML = '<main><div class="fx-menu-group"><button data-menu-toggle>File</button><div data-menu-panel="file"><button data-command="open">Open</button><button data-command="delete" disabled>Delete</button><button data-command="copy">Copy</button></div></div><div id="list"><div tabindex="0" data-path="/a"><button data-role="selection-icon">icon</button><input></div><div tabindex="0" data-path="/b"></div></div></main>';
  return { window, document: window.document, root: window.document.querySelector('main'), rows: [...window.document.querySelectorAll('[data-path]')] };
}
function key(window, node, value, options = {}) { const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }); node.dispatchEvent(event); return event; }
test('listing arrows focus without selecting; activation, parent, delete and repeat guards', () => {
  const { window, document, rows } = fixture(); const calls = [];
  const cleanup = createListingKeyboard(rows[0], { toggleSelection: () => calls.push('select'), open: () => calls.push('open'), parent: () => calls.push('parent'), delete: () => calls.push('delete'), type: text => calls.push(text) });
  rows[0].focus(); assert.equal(key(window, rows[0], 'ArrowDown').defaultPrevented, true); assert.equal(document.activeElement, rows[1]); assert.deepEqual(calls, []);
  for (const value of [' ', 'Enter', 'Backspace', 'Delete', 'x']) key(window, rows[0], value);
  key(window, rows[0], 'Delete', { repeat: true }); key(window, rows[0], 'Enter', { repeat: true });
  assert.deepEqual(calls, ['select', 'open', 'parent', 'delete', 'x']); cleanup(); key(window, rows[0], 'Enter'); assert.equal(calls.length, 5);
});
test('selection icon Enter toggles, while editable/composing events remain untouched', () => {
  const { window, rows } = fixture(); const calls = [];
  createListingKeyboard(rows[0], { toggleSelection: () => calls.push('select'), open: () => calls.push('open'), parent() {}, delete() {}, type() {} });
  key(window, rows[0].querySelector('button'), 'Enter');
  assert.equal(key(window, rows[0].querySelector('input'), 'Backspace').defaultPrevented, false);
  key(window, rows[0], 'Enter', { isComposing: true }); assert.deepEqual(calls, ['select']);
});
test('Ctrl+backtick focuses/creates through the drawer action without repeat or dialog activation', () => {
  const { window, root, rows } = fixture(); let shown = 0, available = true, reachedChild = 0;
  const dispose = bindTerminalShortcut(root, { available: () => available, show: () => { shown++; } });
  rows[0].addEventListener('keydown', () => { reachedChild++; });
  assert.equal(key(window, rows[0], '`', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(shown, 1); assert.equal(reachedChild, 0);
  key(window, rows[0], '`', { ctrlKey: true, repeat: true }); assert.equal(shown, 1);
  key(window, rows[0], '`', { ctrlKey: true, shiftKey: true }); assert.equal(shown, 1);
  key(window, rows[0], '`', { ctrlKey: true, isComposing: true }); assert.equal(shown, 1);
  const input = rows[0].querySelector('input');
  key(window, input, '`', { ctrlKey: true }); assert.equal(shown, 2);
  input.setAttribute('role', 'dialog');
  assert.equal(key(window, input, '`', { ctrlKey: true }).defaultPrevented, false); assert.equal(shown, 2);
  available = false; key(window, rows[0], '`', { ctrlKey: true }); assert.equal(shown, 2);
  available = true; dispose(); key(window, rows[0], '`', { ctrlKey: true }); assert.equal(shown, 2);
});
test('context capabilities, arrows and Escape restore row without leaking global Escape', () => {
  const { window, document, root, rows } = fixture(); const commands = []; let leaked = 0;
  const menu = createItemContextMenu({ container: root, select() {}, dispatch: command => commands.push(command) });
  menu.bind(rows[0], {}, {}); document.addEventListener('keydown', event => { if (event.key === 'Escape') leaked++; });
  rows[0].dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const buttons = [...root.querySelectorAll('.fx-context-menu button')]; assert.equal(buttons.length, 2);
  key(window, buttons[0], 'ArrowDown'); assert.equal(document.activeElement, buttons[1]);
  key(window, buttons[1], 'Escape'); assert.equal(document.activeElement, rows[0]); assert.equal(leaked, 0); assert.equal(root.querySelector('.fx-context-menu'), null);
  rows[0].dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true })); root.querySelector('.fx-context-menu button').click(); assert.deepEqual(commands, ['open']); menu.dispose();
});
test('menubar toggles and dispatches existing command buttons, and disposes listeners', () => {
  const { root } = fixture(); const calls = []; const menu = createMenubar({ container: root, dispatch: command => calls.push(command), opened: () => calls.push('opened') });
  const toggle = root.querySelector('[data-menu-toggle]'); toggle.click(); assert.equal(root.querySelector('.fx-menu-group').hasAttribute('data-open'), true);
  root.querySelector('[data-command="open"]').click(); assert.deepEqual(calls, ['opened', 'open']);
  menu.dispose(); toggle.click(); assert.equal(root.querySelector('.fx-menu-group').hasAttribute('data-open'), false);
});
