import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const built = await build({ entryPoints: ['main_page/frontend/sidebar-shortcuts/dock-scroll.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { bindDockOverflowScroll } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

function fixture(overflow = true) {
  const win = new Window();
  const grid = win.document.createElement('div');
  const button = win.document.createElement('button');
  grid.append(button);
  win.document.body.append(grid);
  Object.defineProperties(grid, { clientWidth: { value: 100 }, scrollWidth: { value: overflow ? 500 : 100 } });
  let cancels = 0;
  let activations = 0;
  let reorderMoves = 0;
  let menus = 0;
  let pendingLongPress = false;
  button.addEventListener('pointerdown', () => { pendingLongPress = true; });
  button.addEventListener('pointermove', () => { reorderMoves += 1; });
  button.addEventListener('click', () => { activations += 1; });
  button.addEventListener('contextmenu', () => { menus += 1; });
  const dispose = bindDockOverflowScroll(grid, () => { cancels += 1; pendingLongPress = false; });
  const pointer = (type, x, y, pointerType = 'touch') => {
    const event = new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, clientX: x, clientY: y });
    button.dispatchEvent(event);
    return event;
  };
  return { win, grid, button, pointer, dispose, state: () => ({ cancels, activations, reorderMoves, menus, pendingLongPress }) };
}

test('dock wheel uses dominant axis, normalizes units and does not trap edges or zoom', () => {
  const f = fixture();
  try {
    const wheel = (options) => {
      const event = new f.win.WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
      // happy-dom's WheelEvent omits inherited modifier-key properties.
      Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey === true });
      f.grid.dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.equal(wheel({ deltaY: 2, deltaMode: 1 }), true);
    assert.equal(f.grid.scrollLeft, 32);
    assert.equal(wheel({ deltaX: 80, deltaY: 10 }), true);
    assert.equal(f.grid.scrollLeft, 112);
    assert.equal(wheel({ deltaY: 100, ctrlKey: true }), false);
    assert.equal(f.grid.scrollLeft, 112);
    f.grid.scrollLeft = 400;
    assert.equal(wheel({ deltaY: 100 }), false);
  } finally { f.dispose(); f.win.happyDOM.abort(); }
});

test('horizontal swipe scrolls and cancels long press/reorder and synthetic activation', () => {
  const f = fixture();
  try {
    f.pointer('pointerdown', 80, 10);
    assert.equal(f.state().pendingLongPress, true);
    f.pointer('pointermove', 40, 12);
    assert.equal(f.grid.scrollLeft, 40);
    assert.equal(f.state().pendingLongPress, false);
    assert.equal(f.state().reorderMoves, 0);
    f.pointer('pointerup', 40, 12);
    f.button.click();
    assert.equal(f.state().activations, 0);
    // A new tap remains an ordinary activation, not a permanently suppressed one.
    f.pointer('pointerdown', 80, 10);
    f.pointer('pointerup', 80, 10);
    f.button.click();
    assert.equal(f.state().activations, 1);
  } finally { f.dispose(); f.win.happyDOM.abort(); }
});

for (const mode of ['vertical touch', 'mouse', 'nonoverflow touch']) {
  test(`${mode} retains icon reorder and context menu ownership`, () => {
    const f = fixture(mode !== 'nonoverflow touch');
    try {
      const pointerType = mode === 'mouse' ? 'mouse' : 'touch';
      f.pointer('pointerdown', 80, 10, pointerType);
      f.pointer('pointermove', mode === 'vertical touch' ? 78 : 40, mode === 'vertical touch' ? 30 : 12, pointerType);
      f.pointer('pointermove', 20, 30, pointerType);
      assert.equal(f.grid.scrollLeft, 0);
      assert.equal(f.state().reorderMoves, 2);
      assert.equal(f.state().cancels, 0);
      f.button.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true }));
      assert.equal(f.state().menus, 1);
    } finally { f.dispose(); f.win.happyDOM.abort(); }
  });
}

test('cancel/disposal cannot retain scroll handlers or suppress future clicks', () => {
  const f = fixture();
  try {
    f.pointer('pointerdown', 80, 10);
    f.pointer('pointermove', 40, 10);
    f.pointer('pointercancel', 40, 10);
    f.dispose();
    f.button.click();
    assert.equal(f.state().activations, 1);
    f.grid.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: 50, cancelable: true }));
    assert.equal(f.grid.scrollLeft, 40);
  } finally { f.dispose(); f.win.happyDOM.abort(); }
});

test('dock scroll boundary leaves popup outside overflow and reserves title space', () => {
  const template = fs.readFileSync('template.html', 'utf8');
  const win = new Window();
  win.document.body.innerHTML = template;
  const menu = win.document.getElementById('agent-drawer-icon-menu');
  const grid = win.document.getElementById('agent-drawer-icon-grid');
  const fixed = win.document.querySelector('.agent-drawer__fixed-controls');
  assert.equal(grid.contains(fixed), false);
  assert.equal(fixed.parentElement, grid.parentElement);
  assert.equal(fixed.nextElementSibling, grid);
  assert.equal(grid.contains(menu), false);
  assert.equal(menu.parentElement, grid.parentElement);
  assert.match(template, /\.agent-drawer__title\s*\{[^}]*min-width: 80px/);
  assert.match(template, /\.agent-drawer__icon-grid\s*\{[^}]*overflow-x: auto/);
  assert.match(template, /\.agent-drawer__chrome\s*\{[^}]*min-width: 0;[^}]*flex: 1 1 0/);
  assert.match(template, /\.agent-drawer__fixed-controls\s*\{[^}]*flex: 0 0 auto/);
  const runtime = fs.readFileSync('main_page/frontend/sidebar-shortcuts/runtime.ts', 'utf8');
  assert.match(runtime, /fixedControls\.appendChild\(launcherCell\)/);
  assert.match(runtime, /cell\.appendChild\(dot\);\s*fixedControls\.appendChild\(cell\)/);
  win.happyDOM.abort();
});
