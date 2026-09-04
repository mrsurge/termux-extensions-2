import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { build } from 'esbuild';


let modulePromise;
let repeatModulePromise;

function loadModule() {
  if (!modulePromise) {
    modulePromise = build({
      entryPoints: ['src/mobile-special-keys.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      write: false,
    }).then((result) => {
      const source = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    });
  }
  return modulePromise;
}

function loadRepeatModule() {
  if (!repeatModulePromise) {
    repeatModulePromise = build({
      entryPoints: ['src/pointer-hold-repeat.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      write: false,
    }).then((result) => {
      const source = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    });
  }
  return repeatModulePromise;
}

function pointerEvent(type, pointerId = 1) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  return event;
}

class FakeKeyboardEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeInputEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
  }
}

test('renders the exact two-row Terminal key layout', () => {
  const template = fs.readFileSync('template.html', 'utf8');
  const ids = [...template.matchAll(/<button id="(k-[^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(ids, [
    'k-esc',
    'k-minibar',
    'k-dash',
    'k-home',
    'k-up',
    'k-end',
    'k-page-up',
    'k-tab',
    'k-ctrl',
    'k-alt',
    'k-left',
    'k-down',
    'k-right',
    'k-page-down',
  ]);
  assert.match(template, /id="k-minibar"[^>]*>&#8801;<\/button>/);
  assert.match(template, /id="k-up"[^>]*>&#8593;<\/button>/);
});

test('Ctrl arms, locks on double tap, and only armed state is consumed', async () => {
  const { TerminalModifierState } = await loadModule();
  const modifiers = new TerminalModifierState();

  assert.equal(modifiers.tapCtrl(1_000), 'armed');
  modifiers.consumeOneShot();
  assert.equal(modifiers.ctrlMode, 'off');

  assert.equal(modifiers.tapCtrl(2_000), 'armed');
  assert.equal(modifiers.tapCtrl(2_200), 'locked');
  modifiers.consumeOneShot();
  assert.equal(modifiers.ctrlMode, 'locked');
  assert.equal(modifiers.tapCtrl(3_000), 'off');
});

test('Alt composes with Ctrl and both one-shot modifiers are consumed', async () => {
  const { TerminalModifierState } = await loadModule();
  const modifiers = new TerminalModifierState();

  modifiers.tapCtrl(1_000);
  assert.equal(modifiers.toggleAlt(), true);
  assert.deepEqual(
    { ctrl: modifiers.ctrl, alt: modifiers.alt },
    { ctrl: true, alt: true },
  );
  modifiers.consumeOneShot();
  assert.deepEqual(
    { ctrl: modifiers.ctrl, alt: modifiers.alt },
    { ctrl: false, alt: false },
  );
});

test('recognizes only established mobile user-agent signals', async () => {
  const { isMobileUserAgent } = await loadModule();
  assert.equal(isMobileUserAgent({ userAgentData: { mobile: true } }), true);
  assert.equal(isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Linux; Android 16) Mobile' }), true);
  assert.equal(isMobileUserAgent({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }), true);
  assert.equal(isMobileUserAgent({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), false);
});

test('dispatches xterm-owned synthetic keydown and keyup with legacy fields', async () => {
  const { dispatchSyntheticTerminalKey, TERMINAL_KEYS } = await loadModule();
  const events = [];
  const target = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  dispatchSyntheticTerminalKey(
    target,
    TERMINAL_KEYS.pageDown,
    { ctrl: true, alt: true },
    FakeKeyboardEvent,
  );

  assert.deepEqual(events.map((event) => ({
    type: event.type,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
  })), [
    {
      type: 'keydown',
      key: 'PageDown',
      code: 'PageDown',
      keyCode: 34,
      which: 34,
      ctrlKey: true,
      altKey: true,
    },
    {
      type: 'keyup',
      key: 'PageDown',
      code: 'PageDown',
      keyCode: 34,
      which: 34,
      ctrlKey: true,
      altKey: true,
    },
  ]);
});

test('repeats directional pointer holds and stops on cancellation', async () => {
  const {
    bindPointerHoldRepeat,
    POINTER_HOLD_REPEAT_DELAY_MS,
    POINTER_HOLD_REPEAT_INTERVAL_MS,
  } = await loadRepeatModule();
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.defaultView = win;
  doc.hidden = false;
  const button = new EventTarget();
  button.ownerDocument = doc;
  button.setPointerCapture = () => {};
  button.hasPointerCapture = () => false;
  button.releasePointerCapture = () => {};
  let nextHandle = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const clock = {
    setTimeout(callback, delayMs) {
      const handle = ++nextHandle;
      timeouts.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeout(handle) { timeouts.delete(handle); },
    setInterval(callback, intervalMs) {
      const handle = ++nextHandle;
      intervals.set(handle, { callback, intervalMs });
      return handle;
    },
    clearInterval(handle) { intervals.delete(handle); },
  };
  const calls = [];
  const dispose = bindPointerHoldRepeat(button, {
    start: () => calls.push('start'),
    repeat: () => calls.push('repeat'),
    finish: () => calls.push('finish'),
  }, { window: win, clock });

  button.dispatchEvent(pointerEvent('pointerdown', 4));
  assert.equal([...timeouts.values()][0].delayMs, POINTER_HOLD_REPEAT_DELAY_MS);
  [...timeouts.values()][0].callback();
  assert.equal([...intervals.values()][0].intervalMs, POINTER_HOLD_REPEAT_INTERVAL_MS);
  [...intervals.values()][0].callback();
  win.dispatchEvent(new Event('blur'));
  assert.deepEqual(calls, ['start', 'repeat', 'repeat', 'finish']);
  assert.equal(intervals.size, 0);
  dispose();
});

test('inserts plain dash through the textarea input authority', async () => {
  const { dispatchSyntheticTerminalText } = await loadModule();
  const events = [];
  const textarea = {
    value: '\u21dd\n\n',
    selectionStart: 1,
    selectionEnd: 1,
    setRangeText(text, start, end) {
      this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
      this.selectionStart = start + text.length;
      this.selectionEnd = this.selectionStart;
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  dispatchSyntheticTerminalText(textarea, '-', FakeInputEvent);
  assert.equal(textarea.value, '\u21dd-\n\n');
  assert.deepEqual(events.map((event) => ({
    type: event.type,
    data: event.data,
    inputType: event.inputType,
    bubbles: event.bubbles,
    composed: event.composed,
  })), [{
    type: 'input',
    data: '-',
    inputType: 'insertText',
    bubbles: true,
    composed: true,
  }]);
});

test('minibar key opens only the guarded drawer and navigation is not hard-coded ANSI', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(
    source,
    /ui\.keyMinibar\.addEventListener\('pointerdown', softKey\(openDrawerFromSoftKey\)/,
  );
  assert.match(source, /suppressPrematureMinibarInteraction/);
  assert.doesNotMatch(source, /key(?:Left|Right|Up|Down).*queueInput/);
});

test('minibar interaction deadline suppresses only the reveal window', async () => {
  const {
    MINIBAR_INTERACTION_GUARD_MS,
    shouldSuppressMinibarInteraction,
  } = await loadModule();
  assert.equal(MINIBAR_INTERACTION_GUARD_MS, 300);
  assert.equal(shouldSuppressMinibarInteraction(1_300, 1_299), true);
  assert.equal(shouldSuppressMinibarInteraction(1_300, 1_300), true);
  assert.equal(shouldSuppressMinibarInteraction(1_300, 1_301), false);
  assert.equal(shouldSuppressMinibarInteraction(0, 0), false);
});

test('show-exited filtering is client-local and defaults off', () => {
  const template = fs.readFileSync('template.html', 'utf8');
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(template, /id="ta-show-exited" type="checkbox"/);
  assert.match(source, /showExited: false/);
  assert.match(source, /state\.showExited\s*\? state\.shells\s*: state\.shells\.filter/);
  assert.doesNotMatch(source, /localStorage[^\n]*showExited|showExited[^\n]*localStorage/);
});

test('special key dock and toggle are mobile-only and non-persisted', () => {
  const template = fs.readFileSync('template.html', 'utf8');
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(template, /id="ta-key-toggle"[^>]* hidden>Keys<\/button>/);
  assert.match(template, /<div id="ta-keys" hidden>/);
  assert.match(source, /specialKeysVisible: true/);
  assert.match(source, /const mobileSpecialKeysAvailable = isMobileUserAgent\(window\.navigator\)/);
  assert.doesNotMatch(source, /localStorage[^\n]*specialKeys|specialKeys[^\n]*localStorage/);
});

test('plain dash uses textarea input while modified dash stays keyboard-owned', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(source, /key === TERMINAL_KEYS\.dash/);
  assert.match(source, /dispatchSyntheticTerminalText\(target\.textarea, '-'\)/);
  assert.match(source, /dispatchSyntheticTerminalKey\(target\.textarea, key/);
});

test('binds hold repetition only to the four directional soft keys', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  for (const key of ['Up', 'Left', 'Down', 'Right']) {
    assert.match(
      source,
      new RegExp(`bindRepeatingTerminalKey\\(ui\\.key${key}, TERMINAL_KEYS\\.${key.toLowerCase()}\\)`),
    );
  }
  assert.doesNotMatch(source, /bindRepeatingTerminalKey\(ui\.key(?:Home|End|PageUp|PageDown)/);
});

test('active terminal card is derived from client-local activeId', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(source, /const active = state\.activeId === rec\.id/);
  assert.match(source, /if \(active\) el\.setAttribute\('aria-current', 'true'\)/);
  assert.doesNotMatch(source, /classList\.add\('active'\)/);
});
