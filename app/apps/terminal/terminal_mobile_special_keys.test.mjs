import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { build } from 'esbuild';


let modulePromise;

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

class FakeKeyboardEvent {
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

test('active terminal card is derived from client-local activeId', () => {
  const source = fs.readFileSync('src/main.ts', 'utf8');
  assert.match(source, /const active = state\.activeId === rec\.id/);
  assert.match(source, /if \(active\) el\.setAttribute\('aria-current', 'true'\)/);
  assert.doesNotMatch(source, /classList\.add\('active'\)/);
});
