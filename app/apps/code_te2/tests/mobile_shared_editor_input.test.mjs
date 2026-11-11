import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundle = await build({ stdin: { contents: `
  export * from './monaco_editor/editor_mobile_special_keys_utils.ts';
  export * from './src/mobile-input/editor-special-key-bridge.ts';
  export * from './src/mobile-input/terminal-special-key-bridge.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(interceptMonacoCapture = false, getVibrationDurationMs) {
  const win = new Window({ url: 'http://localhost/app/code_te2' });
  Object.defineProperty(win.navigator, 'userAgent', { value: 'Android Mobile' });
  const vibrations = [];
  Object.defineProperty(win.navigator, 'vibrate', { configurable: true,
    value(duration) { assert.equal(this, win.navigator); vibrations.push(duration); return true; } });
  const saved = new Map();
  for (const key of ['window', 'document', 'CustomEvent', 'Event', 'InputEvent', 'KeyboardEvent', 'Element', 'HTMLElement', 'Node']) {
    saved.set(key, globalThis[key]); globalThis[key] = key === 'window' ? win : win[key];
  }
  win.document.body.innerHTML = `<div class="fe-root layout-mobile">
    <div class="fe-editor-container"><div data-te2-working-editor-host id="primary"><textarea class="inputarea"></textarea></div></div>
    <div class="te2-secondary-editor-body"><div data-te2-working-editor-host id="secondary"><textarea class="inputarea"></textarea></div></div>
    <div id="terminal-container"><textarea></textarea></div>
  </div>`;
  const keys = [], saves = [], actions = [];
  const make = role => {
    const host = win.document.getElementById(role), input = host.querySelector('textarea');
    input.addEventListener('keydown', event => keys.push([role, event.key, event.ctrlKey, event.altKey, event.shiftKey]));
    const editorDom = win.document.createElement('div');
    editorDom.className = 'monaco-editor';
    host.append(editorDom);
    editorDom.append(input);
    if (interceptMonacoCapture) {
      const consume = event => event.stopImmediatePropagation();
      editorDom.addEventListener('pointerdown', consume, true);
      editorDom.addEventListener('focusin', consume, true);
    }
    const editor = { getDomNode: () => editorDom, focus: () => input.focus(),
      getAction: id => ({ run() { actions.push([role, id]); } }) };
    const binding = api.bindMobileEditorSpecialKeys(editor, win, () => saves.push(role), { role, host, getVibrationDurationMs });
    return { host, input, editor, binding };
  };
  const primary = make('primary'), secondary = make('secondary');
  const panel = win.document.querySelector('.te2-mobile-special-key-panel');
  const button = title => [...panel.querySelectorAll('button')].find(element => element.title === title);
  const tap = target => {
    assert.ok(target);
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new win.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, isPrimary: { value: true } });
      target.dispatchEvent(event);
    }
  };
  return { win, primary, secondary, panel, button, tap, keys, saves, actions, vibrations,
    dispose() {
      primary.binding.dispose(); secondary.binding.dispose();
      win.happyDOM.abort();
      for (const [key, value] of saved) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    } };
}

test('explicit roles in one document route extra keys and keep primary modifier ownership', () => {
  const f = fixture();
  try {
    assert.equal(f.win.document.querySelectorAll('.te2-mobile-special-key-panel').length, 1);
    f.secondary.input.focus();
    assert.equal(api.currentMobileEditorOwner(f.win), 'secondary');
    f.tap(f.button('Control')); f.tap(f.button('Control'));
    assert.equal(api.currentMobileEditorModifiers(f.win).ctrlLocked, true);
    f.tap(f.button('Right'));
    assert.deepEqual(f.keys, [['secondary', 'ArrowRight', true, false, false]]);
    f.primary.input.focus(); f.tap(f.button('Right'));
    assert.deepEqual(f.keys[1], ['primary', 'ArrowRight', true, false, false]);
    f.secondary.input.focus(); f.tap(f.button('Go to Line (:)'));
    assert.deepEqual(f.actions.at(-1), ['secondary', 'editor.action.gotoLine']);
    f.secondary.binding.dispose(); f.secondary.binding.dispose();
    assert.equal(api.currentMobileEditorOwner(f.win), 'primary');
    assert.equal(api.currentMobileEditorModifiers(f.win).ctrlLocked, true);
    assert.equal(f.win.document.querySelectorAll('.te2-mobile-editor-overlay').length, 1);
    f.primary.input.focus(); f.tap(f.button('Right'));
    assert.deepEqual(f.keys.at(-1), ['primary', 'ArrowRight', true, false, false]);
  } finally { f.dispose(); }
});

test('Monaco-consumed pointer and focus events still reclaim primary extra-key ownership', () => {
  const f = fixture();
  try {
    const consume = event => event.stopPropagation();
    f.primary.input.addEventListener('pointerdown', consume);
    f.primary.input.addEventListener('focusin', consume);
    f.secondary.input.focus();
    assert.equal(api.currentMobileEditorOwner(f.win), 'secondary');
    f.primary.input.dispatchEvent(new f.win.Event('pointerdown', { bubbles: true }));
    assert.equal(api.currentMobileEditorOwner(f.win), 'primary');
    f.tap(f.button('Right'));
    assert.equal(f.keys.at(-1)[0], 'primary');
    f.secondary.input.focus();
    f.primary.input.focus();
    assert.equal(api.currentMobileEditorOwner(f.win), 'primary');
    f.tap(f.button('Right'));
    assert.equal(f.keys.at(-1)[0], 'primary');
    f.primary.binding.dispose();
    api.setMobileEditorOwner(f.win, 'secondary');
    f.primary.input.dispatchEvent(new f.win.Event('pointerdown', { bubbles: true }));
    assert.equal(api.currentMobileEditorOwner(f.win), 'secondary');
  } finally { f.dispose(); }
});

test('same-page secondary forwards terminal keys once and returns to the focused editor', () => {
  const f = fixture();
  try {
    const terminalKeys = [];
    f.win.addEventListener(api.TERMINAL_SPECIAL_KEY_REQUEST_EVENT, event => {
      terminalKeys.push(event.detail.key.key); event.detail.handled = true;
    });
    f.secondary.input.focus();
    f.win.dispatchEvent(new f.win.CustomEvent(api.TERMINAL_SPECIAL_KEY_FOCUS_EVENT, { detail: { active: true } }));
    f.tap(f.button('Right'));
    assert.deepEqual(terminalKeys, ['ArrowRight']); assert.equal(f.keys.length, 0);
    assert.deepEqual(f.vibrations, [100]);
    f.win.dispatchEvent(new f.win.CustomEvent(api.TERMINAL_SPECIAL_KEY_FOCUS_EVENT, { detail: { active: false } }));
    f.primary.input.focus(); f.tap(f.button('Right'));
    assert.equal(f.keys.at(-1)[0], 'primary');
    assert.throws(() => api.bindMobileEditorSpecialKeys(f.primary.editor, f.win, null,
      { role: 'primary', host: f.primary.host }), /already has an input binding/);
    assert.throws(() => api.bindMobileEditorSpecialKeys(f.primary.editor, f.win, null,
      { role: 'secondary', host: f.secondary.host }), /does not own/);
  } finally { f.dispose(); }
});

test('mount ownership precedes Monaco capture interception in both editors', () => {
  const f = fixture(true);
  try {
    for (const role of ['secondary', 'primary', 'secondary', 'primary']) {
      const target = f[role];
      target.input.dispatchEvent(new f.win.Event('pointerdown', { bubbles: true }));
      assert.equal(api.currentMobileEditorOwner(f.win), role);
      target.input.focus();
      assert.equal(api.currentMobileEditorOwner(f.win), role);
      f.tap(f.button('Right'));
      assert.equal(f.keys.at(-1)[0], role);
    }
    f.primary.binding.dispose();
    api.setMobileEditorOwner(f.win, 'secondary');
    f.primary.input.dispatchEvent(new f.win.Event('pointerdown', { bubbles: true }));
    assert.equal(api.currentMobileEditorOwner(f.win), 'secondary');
  } finally { f.dispose(); }
});

test('extra keys vibrate once per press, not per hold repeat or renderer', async () => {
  const f = fixture();
  try {
    f.secondary.input.focus();
    const button = f.button('Right');
    const press = new f.win.Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(press, { pointerId: { value: 1 }, button: { value: 0 }, isPrimary: { value: true } });
    button.dispatchEvent(press);
    await new Promise(resolve => setTimeout(resolve, 520));
    button.dispatchEvent(new f.win.Event('pointerup', { bubbles: true, cancelable: true }));
    assert.ok(f.keys.length > 1, 'the hold must actually repeat');
    assert.deepEqual(f.vibrations, [100]);
    assert.ok(f.keys.every(key => key[0] === 'secondary'));
    f.primary.input.focus();
    f.tap(f.button('Control'));
    assert.deepEqual(f.vibrations, [100, 100]);
    f.tap(f.primary.host.parentElement.querySelector('.te2-mobile-special-key-trigger'));
    assert.deepEqual(f.vibrations, [100, 100, 100]);
    f.primary.binding.dispose();
    f.tap(button);
    assert.equal(f.vibrations.length, 3, 'disposed row must not retain haptic listeners');
  } finally { f.dispose(); }
});

test('haptic duration supports a live override, zero disables, and failures preserve input', () => {
  let duration = 35;
  const f = fixture(false, () => duration);
  try {
    f.primary.input.focus();
    f.tap(f.button('Right'));
    duration = 0; f.tap(f.button('Right'));
    duration = Number.NaN; f.tap(f.button('Right'));
    assert.deepEqual(f.vibrations, [35, 100]);
    Object.defineProperty(f.win.navigator, 'vibrate', { value: undefined, configurable: true });
    f.tap(f.button('Right'));
    Object.defineProperty(f.win.navigator, 'vibrate', { value() { throw new Error('denied'); }, configurable: true });
    f.tap(f.button('Right'));
    assert.equal(f.keys.length, 5);
    assert.ok(f.keys.every(key => key[0] === 'primary'));
  } finally { f.dispose(); }
});
