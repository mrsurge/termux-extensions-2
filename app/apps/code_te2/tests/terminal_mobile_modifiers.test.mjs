import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function load(relative) {
  const result = await build({ entryPoints: [new URL(relative, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('IME Shift handles printable text but never alters terminal sequences', async () => {
  const { shiftTerminalText } = await load('../../../libs/terminal_runtime/terminal_shift.ts');
  assert.equal(shiftTerminalText('a'), 'A');
  assert.equal(shiftTerminalText('1'), '!');
  assert.equal(shiftTerminalText('-'), '_');
  assert.equal(shiftTerminalText('\\'), '|');
  for (const value of ['\x1b[1;2D', '\x01', '\r', '\t', 'paste text', '\x1b[200~a\x1b[201~']) assert.equal(shiftTerminalText(value), value);
});

test('File Explorer owns the same independent one-shot Shift behavior', async () => {
  const { TerminalModifierState, dispatchSyntheticTerminalKey, TERMINAL_KEYS } = await load('../../file_explorer/mobile-special-keys.ts');
  const state = new TerminalModifierState(); state.toggleShift();
  const events = [];
  class Key { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  dispatchSyntheticTerminalKey({ dispatchEvent(e) { events.push(e); } }, TERMINAL_KEYS.tab, state, Key);
  assert.deepEqual(events.map(e => [e.shiftKey, e.ctrlKey]), [[true, false], [true, false]]);
  state.consumeOneShot(); assert.equal(state.shift, false);
  state.tapShift(1000); state.tapShift(1200);
  assert.equal(state.shiftMode, 'locked');
  for (const key of Object.values(TERMINAL_KEYS)) {
    dispatchSyntheticTerminalKey({ dispatchEvent(e) { events.push(e); } }, key, state, Key);
    assert.equal(events.at(-1).shiftKey, true);
    assert.equal(events.at(-1).ctrlKey, false);
    state.consumeOneShot(); assert.equal(state.shift, true);
  }
  state.consumeOneShot(); assert.equal(state.shift, true);
  state.tapShift(1300); assert.equal(state.shift, false);
});

test('Shift long-press locks; release, cancellation and disposal fence the timer', async () => {
  const { bindTerminalShiftButton, SHIFT_LONG_PRESS_MS } = await load('../../../libs/terminal_runtime/terminal_shift_button.ts');
  const { TerminalModifierState } = await load('../../file_explorer/mobile-special-keys.ts');
  const state = new TerminalModifierState();
  const win = new EventTarget();
  const timers = new Map(); let id = 0, updates = 0, focuses = 0;
  win.setTimeout = (callback, delay) => { assert.equal(delay, SHIFT_LONG_PRESS_MS); timers.set(++id, callback); return id; };
  win.clearTimeout = id => timers.delete(id);
  const button = new EventTarget(); button.setPointerCapture = () => {};
  const pointer = (type, pointerId) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId, button: 0, isPrimary: true }); return event;
  };
  const dispose = bindTerminalShiftButton(button, state, () => updates++, () => focuses++, win);
  button.dispatchEvent(pointer('pointerdown', 1));
  assert.equal(state.shiftMode, 'armed');
  const [timerId, callback] = [...timers.entries()][0];
  timers.delete(timerId); callback();
  assert.equal(state.shiftMode, 'locked');
  state.consumeOneShot(); assert.equal(state.shift, true);
  win.dispatchEvent(pointer('pointerup', 1));
  button.dispatchEvent(pointer('pointerdown', 2));
  assert.equal(state.shift, false);
  win.dispatchEvent(pointer('pointercancel', 2));
  assert.equal(timers.size, 0);
  button.dispatchEvent(pointer('pointerdown', 3));
  dispose(); assert.equal(timers.size, 0);
  const before = updates;
  button.dispatchEvent(pointer('pointerdown', 4));
  assert.equal(updates, before);
  assert.equal(focuses, 3);
});
