import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { Window } from 'happy-dom';


const codeTe2HelperPath = path.resolve(
  import.meta.dirname,
  '../vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js',
);
const terminalHelperPath = path.resolve(
  import.meta.dirname,
  '../../terminal/vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js',
);
const helperSource = fs.readFileSync(codeTe2HelperPath, 'utf8');

function createHarness({
  cols = 10,
  rows = 5,
  viewportY = 10,
  selection = {
    start: { x: 2, y: 12 },
    end: { x: 5, y: 12 },
  },
  wideContinuationColumns = new Set(),
  mobile = true,
  touchHook = true,
  hostZIndex = null,
  pageHeight = 100,
} = {}) {
  const window = new Window({ url: 'http://127.0.0.1/apps/by-id/terminal' });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: mobile
      ? 'Mozilla/5.0 (Linux; Android 16) Mobile'
      : 'Mozilla/5.0 (X11; Linux x86_64)',
  });
  Object.defineProperty(window.navigator, 'userAgentData', {
    configurable: true,
    value: { mobile },
  });
  window.matchMedia = query => ({ matches: !query.includes('prefers-reduced-motion') });
  const clipboardWrites = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => 'pasted text',
      writeText: async (text) => { clipboardWrites.push(text); },
    },
  });

  let rafId = 0;
  let now = 0;
  Object.defineProperty(window, 'performance', { value: { now: () => now }, configurable: true });
  const rafCallbacks = new Map();
  window.requestAnimationFrame = (callback) => {
    const id = ++rafId;
    rafCallbacks.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => rafCallbacks.delete(id);
  const frame = (elapsed = 16, frameTimestampOffset = 0) => {
      now += elapsed;
      const callbacks = [...rafCallbacks.entries()];
      rafCallbacks.clear();
      for (const [, callback] of callbacks) callback(now + frameTimestampOffset);
  };
  const flushAnimationFrames = () => {
    let frames = 0;
    while (rafCallbacks.size) {
      assert.ok(frames++ < 200, 'animation must terminate');
      frame();
    }
  };

  const root = window.document.createElement('div');
  root.className = 'xterm';
  const viewport = window.document.createElement('div');
  viewport.className = 'xterm-viewport';
  const screen = window.document.createElement('div');
  screen.className = 'xterm-screen';
  const canvas = window.document.createElement('canvas');
  const rowsElement = window.document.createElement('div');
  rowsElement.className = 'xterm-rows';
  const rowElement = window.document.createElement('div');
  const textSpan = window.document.createElement('span');
  textSpan.textContent = 'rendered text';
  rowElement.appendChild(textSpan);
  rowsElement.appendChild(rowElement);
  screen.append(canvas, rowsElement);
  root.append(viewport, screen);
  const host = window.document.createElement('div');
  if (hostZIndex !== null) {
    host.style.position = 'fixed';
    host.style.zIndex = String(hostZIndex);
  }
  host.appendChild(root);
  window.document.body.appendChild(host);

  const surfaceRect = {
    left: 100,
    top: 50,
    right: 200,
    bottom: 50 + pageHeight,
    width: 100,
    height: pageHeight,
    x: 100,
    y: 50,
    toJSON() { return this; },
  };
  screen.getBoundingClientRect = () => surfaceRect;
  canvas.getBoundingClientRect = () => surfaceRect;

  let currentSelection = structuredClone(selection);
  let currentViewportY = viewportY;
  const callbacks = {
    resize: new Set(),
    scroll: new Set(),
    selection: new Set(),
  };
  const selectCalls = [];
  const wordSelectCalls = [];
  const scrollCalls = [];
  const pasteCalls = [];
  let selectAllCalls = 0;
  const disposedSubscriptions = [];
  let touchGesture = null;
  const subscribe = (kind, callback) => {
    callbacks[kind].add(callback);
    return {
      dispose() {
        callbacks[kind].delete(callback);
        disposedSubscriptions.push(kind);
      },
    };
  };
  const terminal = {
    cols,
    rows,
    element: root,
    buffer: {
      active: {
        get viewportY() { return currentViewportY; },
        getLine() {
          return {
            getCell(column) {
              return {
                getWidth: () => wideContinuationColumns.has(column) ? 0 : 1,
              };
            },
          };
        },
      },
    },
    hasSelection: () => Boolean(currentSelection),
    getSelection: () => currentSelection ? 'selected text' : '',
    getSelectionPosition: () => currentSelection,
    onSelectionChange: (callback) => subscribe('selection', callback),
    onScroll: (callback) => subscribe('scroll', callback),
    onResize: (callback) => subscribe('resize', callback),
    select(column, row, length) {
      selectCalls.push({ column, row, length });
      const endLinear = row * cols + column + length;
      let endRow = Math.floor(endLinear / cols);
      let endColumn = endLinear % cols;
      if (endColumn === 0 && length > 0) {
        endRow -= 1;
        endColumn = cols;
      }
      currentSelection = {
        start: { x: column, y: row },
        end: { x: endColumn, y: endRow },
      };
      for (const callback of callbacks.selection) callback();
    },
    selectWordAt(column, row) {
      wordSelectCalls.push({ column, row });
      currentSelection = {
        start: { x: Math.max(0, column - 2), y: row },
        end: { x: Math.min(cols, column + 3), y: row },
      };
      for (const callback of callbacks.selection) callback();
    },
    scrollLines(amount) {
      scrollCalls.push(amount);
      currentViewportY += amount;
      for (const callback of callbacks.scroll) callback(currentViewportY);
    },
    paste(text) {
      pasteCalls.push(text);
    },
    clearSelection() {
      currentSelection = null;
      for (const callback of callbacks.selection) callback();
    },
    selectAll() {
      selectAllCalls += 1;
      currentSelection = {
        start: { x: 0, y: currentViewportY },
        end: { x: cols, y: currentViewportY + rows - 1 },
      };
      for (const callback of callbacks.selection) callback();
    },
    attachCustomTouchEventHandler(handler) {
      const touchCapture = window.document.createElement('div');
      touchCapture.className = 'xterm-touch-capture';
      touchCapture.style.zIndex = '9';
      screen.appendChild(touchCapture);
      const route = (event) => {
        const point = event.touches?.[0] ?? event.changedTouches?.[0] ?? null;
        if (event.type === 'touchstart' && point) {
          touchGesture = {
            identifier: point.identifier,
            startX: point.clientX,
            startY: point.clientY,
            isScroll: false,
            isClaimed: false,
          };
        }
        if (event.type === 'touchmove' && touchGesture && point && !touchGesture.isScroll) {
          touchGesture.isScroll = Math.hypot(
            point.clientX - touchGesture.startX,
            point.clientY - touchGesture.startY,
          ) > 8;
        }
        const isScroll = touchGesture?.isScroll === true;
        if (handler(event, isScroll) === false) touchGesture.isClaimed = true;
        if (touchGesture?.isClaimed) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (event.type === 'touchend' || event.type === 'touchcancel') touchGesture = null;
      };
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        root.addEventListener(type, route, { passive: false });
      }
      return {
        dispose() {
          for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            root.removeEventListener(type, route);
          }
          touchCapture.remove();
          disposedSubscriptions.push('touch');
        },
      };
    },
  };
  if (!touchHook) delete terminal.attachCustomTouchEventHandler;

  window.eval(helperSource);
  const api = window.te2TerminalTouchSelection;
  assert.equal(typeof api?.attach, 'function');
  const disposable = api.attach(terminal);

  return {
    window,
    root,
    textSpan,
    terminal,
    disposable,
    selectCalls,
    wordSelectCalls,
    scrollCalls,
    pasteCalls,
    clipboardWrites,
    get selectAllCalls() { return selectAllCalls; },
    disposedSubscriptions,
    flushAnimationFrames,
    frame,
    advance: elapsed => { now += elapsed; },
    signal: kind => { for (const callback of callbacks[kind]) callback(); },
    handles: () => [
      ...window.document.querySelectorAll('.te2-xterm-touch-selection-handle'),
    ],
    layer: () => window.document.querySelector('.te2-xterm-touch-selection-layer'),
    menu: () => window.document.querySelector('.te2-xterm-touch-selection-menu'),
  };
}

function pointerEvent(window, type, { x, y, pointerId = 1 } = {}) {
  return new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'touch',
  });
}

function touchEvent(window, type, target, { x, y, identifier = 1 } = {}) {
  const point = {
    identifier,
    target,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  };
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: {
      value: type === 'touchend' || type === 'touchcancel' ? [] : [point],
    },
    changedTouches: {
      value: type === 'touchend' || type === 'touchcancel' ? [point] : [],
    },
  });
  return event;
}

test('standalone and Code TE2 serve one identical touch helper', () => {
  assert.equal(fs.readFileSync(terminalHelperPath, 'utf8'), helperSource);
  assert.doesNotMatch(helperSource, /document\.addEventListener\('touch/);
});

test('terminal owners cancel gestures at socket/session handoff boundaries', () => {
  const standalone = fs.readFileSync(new URL('../../terminal/src/main.ts', import.meta.url), 'utf8');
  assert.match(standalone, /function clearSocket\(\): void \{\s*state\.touchSelection\?\.cancelGesture\?\.\(\)/);
  assert.match(standalone, /cancelGesture\(\) \{ touchSelection\?\.cancelGesture\?\.\(\); \}/);
  const drawer = fs.readFileSync(new URL('../main_page/frontend/host-terminal-drawer.ts', import.meta.url), 'utf8');
  assert.match(drawer, /function emitTerminalRegister\([^\n]+\n\s*touchSelectionDisposable\?\.cancelGesture\?\.\(\)/);
  const explorer = fs.readFileSync(new URL('../../file_explorer/terminal_drawer.ts', import.meta.url), 'utf8');
  assert.match(explorer, /touchBinding\?\.cancelGesture\?\.\(\);\s*view\.reset\(\)/);
});

test('selection handles use viewport-adjusted xterm cell geometry', () => {
  const harness = createHarness();
  harness.flushAnimationFrames();
  const [start, end] = harness.handles();

  assert.equal(start.hidden, false);
  assert.equal(end.hidden, false);
  assert.equal(start.style.transform, 'translate3d(100px, 105px, 0)');
  assert.equal(end.style.transform, 'translate3d(130px, 105px, 0)');
  assert.equal(harness.menu().hidden, false);
  assert.equal(harness.menu().style.left, '135px');
  assert.equal(harness.menu().style.top, '90px');

  harness.disposable.dispose();
});

test('selection layer clears xterm capture without escaping its terminal host', () => {
  const standalone = createHarness();
  assert.equal(standalone.layer().style.zIndex, '10');
  standalone.disposable.dispose();

  const codeTe2 = createHarness({ hostZIndex: 100 });
  assert.equal(codeTe2.layer().style.zIndex, '101');
  codeTe2.disposable.dispose();
});

test('coarse pointers do not enable selection UI without a mobile user agent', () => {
  const harness = createHarness({ mobile: false });
  harness.flushAnimationFrames();

  assert.equal(harness.handles().length, 0);
  assert.equal(harness.menu(), null);
  harness.disposable.dispose();
});

test('an older xterm revision disables touch selection without aborting startup', () => {
  const harness = createHarness({ touchHook: false });
  harness.flushAnimationFrames();

  assert.equal(harness.handles().length, 0);
  assert.equal(harness.menu(), null);
  harness.disposable.dispose();
});

test('selection menu owns copy, paste, and select-all actions', async () => {
  const harness = createHarness();
  harness.flushAnimationFrames();
  const menu = harness.menu();

  menu.querySelector('[data-action="copy"]').click();
  await Promise.resolve();
  assert.deepEqual(harness.clipboardWrites, ['selected text']);

  menu.querySelector('[data-action="paste"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.pasteCalls, ['pasted text']);
  harness.flushAnimationFrames();
  assert.equal(menu.hidden, true);

  harness.terminal.select(2, 12, 3);
  harness.flushAnimationFrames();
  menu.querySelector('[data-action="selectAll"]').click();
  await Promise.resolve();
  assert.equal(harness.selectAllCalls, 1);

  harness.disposable.dispose();
});

test('a pending tap replays an ordinary xterm mouse sequence after claiming touchstart', () => {
  const harness = createHarness();
  const screen = harness.root.querySelector('.xterm-screen');
  const mouseEvents = [];
  for (const type of ['mousedown', 'mouseup', 'click']) {
    screen.addEventListener(type, () => mouseEvents.push(type));
  }

  const started = screen.dispatchEvent(
    touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }),
  );
  const ended = screen.dispatchEvent(
    touchEvent(harness.window, 'touchend', screen, { x: 140, y: 90 }),
  );

  assert.equal(started, false);
  assert.equal(ended, false);
  assert.deepEqual(mouseEvents, ['mousedown', 'mouseup', 'click']);
  harness.disposable.dispose();
});

test('a claimed touchstart keeps stationary pending moves away from native scrolling', () => {
  const harness = createHarness();
  const screen = harness.root.querySelector('.xterm-screen');

  const started = screen.dispatchEvent(
    touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }),
  );
  const moved = screen.dispatchEvent(
    touchEvent(harness.window, 'touchmove', screen, { x: 140, y: 90 }),
  );
  const ended = screen.dispatchEvent(
    touchEvent(harness.window, 'touchend', screen, { x: 140, y: 90 }),
  );

  assert.equal(started, false);
  assert.equal(moved, false);
  assert.equal(ended, false);
  harness.disposable.dispose();
});

test('one-finger movement remains wheel-backed terminal scrolling', () => {
  const harness = createHarness();
  const viewport = harness.root.querySelector('.xterm-viewport');
  const screen = harness.root.querySelector('.xterm-screen');
  const wheelDeltas = [];
  viewport.addEventListener('wheel', (event) => wheelDeltas.push(event.deltaY));

  screen.dispatchEvent(touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }));
  screen.dispatchEvent(touchEvent(harness.window, 'touchmove', screen, { x: 140, y: 120 }));
  screen.dispatchEvent(touchEvent(harness.window, 'touchend', screen, { x: 140, y: 120 }));

  assert.deepEqual(wheelDeltas, [-30]);
  harness.disposable.dispose();
});

test('text and blank terminal targets use the same xterm-owned scroll path', () => {
  const harness = createHarness();
  const viewport = harness.root.querySelector('.xterm-viewport');
  const screen = harness.root.querySelector('.xterm-screen');
  const wheelDeltas = [];
  viewport.addEventListener('wheel', (event) => wheelDeltas.push(event.deltaY));

  for (const target of [harness.textSpan, screen]) {
    target.dispatchEvent(touchEvent(harness.window, 'touchstart', target, { x: 140, y: 90 }));
    target.dispatchEvent(touchEvent(harness.window, 'touchmove', target, { x: 140, y: 120 }));
    target.dispatchEvent(touchEvent(harness.window, 'touchend', target, { x: 140, y: 120 }));
  }

  assert.deepEqual(wheelDeltas, [-30, -30]);
  harness.disposable.dispose();
});

test('untimed scrubbing keeps signed drag distance and native wheel units without coasting', () => {
  const harness = createHarness();
  const viewport = harness.root.querySelector('.xterm-viewport');
  const screen = harness.root.querySelector('.xterm-screen');
  const events = [];
  viewport.addEventListener('wheel', event => events.push({ delta: event.deltaY, mode: event.deltaMode }));
  screen.dispatchEvent(touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }));
  for (const y of [110, 115, 95]) {
    screen.dispatchEvent(touchEvent(harness.window, 'touchmove', screen, { x: 140, y }));
  }
  screen.dispatchEvent(touchEvent(harness.window, 'touchend', screen, { x: 140, y: 95 }));
  harness.flushAnimationFrames();
  assert.deepEqual(events, [{ delta: -20, mode: 0 }, { delta: -5, mode: 0 }, { delta: 20, mode: 0 }]);
  // Native desktop wheel input is not multiplied by the touch adapter.
  viewport.dispatchEvent(new harness.window.WheelEvent('wheel', { deltaY: 1, deltaMode: 1, bubbles: true }));
  assert.deepEqual(events.at(-1), { delta: 1, mode: 1 });
  assert.deepEqual(harness.scrollCalls, []);
  harness.disposable.dispose();
});

function flingHarness(options = {}) {
  const h = createHarness({ selection: null, ...options });
  const screen = h.root.querySelector('.xterm-screen');
  const wheels = [];
  h.root.querySelector('.xterm-viewport').addEventListener('wheel', event => wheels.push(event.deltaY));
  const touch = (type, y) => screen.dispatchEvent(touchEvent(h.window, type, screen, { x: 140, y }));
  return { ...h, wheels, touch,
    flick(distance = 60, duration = 40, pause = 0) {
      touch('touchstart', 130);
      for (let step = 1; step <= 4; step++) {
        h.advance(duration / 4); touch('touchmove', 130 - distance * step / 4);
      }
      h.advance(pause); touch('touchend', 130 - distance);
      wheels.length = 0;
    } };
}

test('only a quick release throws the wheel; stronger flicks travel farther', () => {
  const distances = [];
  for (const [distance, duration] of [[30, 60], [60, 40]]) {
    const h = flingHarness(); h.flick(distance, duration); h.flushAnimationFrames();
    assert.ok(h.wheels.length > 0);
    assert.ok(h.wheels.every(delta => delta > 0 && delta <= 20), 'wheel pulses never exceed one measured row');
    distances.push(h.wheels.reduce((sum, delta) => sum + delta, 0));
    h.disposable.dispose();
  }
  assert.ok(distances[1] > distances[0] * 2, 'release velocity controls travel');
  for (const [distance, duration, pause] of [[30, 300, 0], [60, 40, 100], [10, 20, 0]]) {
    const h = flingHarness(); h.flick(distance, duration, pause); h.flushAnimationFrames();
    assert.deepEqual(h.wheels, [], 'slow/short/paused drag must not coast');
    h.disposable.dispose();
  }
});

test('flick trajectory is independent of animation refresh rate', () => {
  const travelled = [];
  for (const hz of [60, 90, 120]) {
    const h = flingHarness(); h.flick();
    for (let frame = 0; frame < hz / 2; frame++) h.frame(1000 / hz);
    travelled.push(h.wheels.reduce((sum, delta) => sum + delta, 0));
    h.disposable.dispose();
  }
  assert.ok(Math.max(...travelled) - Math.min(...travelled) < 0.01);
});

test('regular and strong throws scale continuously to page height', () => {
  for (const pageHeight of [100, 532, 1000]) {
    const ranges = [];
    for (const [distance, duration, expected] of [[60, 60, 0.75], [60, 40, 1.6875], [100, 40, 4.5]]) {
      const h = flingHarness({ pageHeight, rows: 37 });
      h.flick(distance, duration); h.flushAnimationFrames();
      const pages = h.wheels.reduce((sum, delta) => sum + delta, 0) / pageHeight;
      assert.ok(pages >= expected - 0.015 && pages <= expected, `${pageHeight}px page, expected ${expected}, got ${pages}`);
      assert.ok(h.wheels.every(delta => delta <= pageHeight / 37));
      ranges.push(pages); h.disposable.dispose();
    }
    assert.ok(ranges[0] < 1 && ranges[2] >= 4);
    assert.ok(ranges[0] < ranges[1] && ranges[1] < ranges[2]);
  }
});

test('strong throws retain residual motion within a bounded per-frame pulse budget', () => {
  const h = flingHarness({ pageHeight: 2000, rows: 200 });
  h.flick(100, 40);
  let frames = 0;
  for (; frames < 138; frames++) {
    const before = h.wheels.length;
    h.frame(16);
    assert.ok(h.wheels.length - before <= 16);
  }
  const pages = h.wheels.reduce((sum, delta) => sum + delta, 0) / 2000;
  assert.ok(pages >= 4 && pages <= 4.5, String(pages));
  h.disposable.dispose();
});

test('a frame-start timestamp preceding release does not cancel the fling', () => {
  const h = flingHarness(); h.flick();
  // Captured Cefrium case: callback runs after release, but its frame timestamp
  // is from before the release handler. Mixing clocks formerly killed motion.
  h.frame(1.4, -13.8);
  assert.ok(h.wheels.length > 0);
  const first = h.wheels.reduce((sum, delta) => sum + delta, 0);
  h.frame(16, -10);
  assert.ok(h.wheels.reduce((sum, delta) => sum + delta, 0) > first);
  h.disposable.dispose();
});

test('recent direction reversal discards old velocity and never throws the wrong way', () => {
  const h = flingHarness(); h.touch('touchstart', 130);
  h.advance(20); h.touch('touchmove', 70);
  h.advance(20); h.touch('touchmove', 90);
  h.advance(20); h.touch('touchmove', 110);
  h.touch('touchend', 110); h.wheels.length = 0; h.flushAnimationFrames();
  assert.ok(h.wheels.length > 0); assert.ok(h.wheels.every(delta => delta < 0));
  h.disposable.dispose();
});

test('new touch, selection, resize, page lifecycle and terminal changes stop active inertia', () => {
  const stops = {
    touch: h => h.touch('touchstart', 100),
    outsideTouch: h => h.window.dispatchEvent(new h.window.Event('touchstart')),
    selection: h => h.signal('selection'), resize: h => h.signal('resize'),
    blur: h => h.window.dispatchEvent(new h.window.Event('blur')),
    pagehide: h => h.window.dispatchEvent(new h.window.Event('pagehide')),
    visibility: h => h.window.document.dispatchEvent(new h.window.Event('visibilitychange')),
    detached: h => h.root.remove(), dispose: h => h.disposable.dispose(),
    sessionHandoff: h => h.disposable.cancelGesture(),
    modes: h => { h.terminal.modes = { mouseTrackingMode: 'sgr' }; },
    buffer: h => { h.terminal.buffer.active = {}; },
    disabled: h => { h.window.__fileEditorCm6TerminalHelpersActive = false; },
  };
  for (const [name, stop] of Object.entries(stops)) {
    const h = flingHarness(); h.flick(); h.frame();
    assert.ok(h.wheels.length > 0, name);
    h.wheels.length = 0; stop(h); h.flushAnimationFrames();
    assert.deepEqual(h.wheels, [], name); h.disposable.dispose();
  }
});

test('bounds, reduced motion and delayed frames prevent runaway wheel output', () => {
  for (const variant of ['boundary', 'reduced', 'suspended']) {
    const h = flingHarness();
    if (variant === 'reduced') h.window.matchMedia = () => ({ matches: true });
    if (variant === 'boundary') Object.assign(h.terminal.buffer.active, { type: 'normal', baseY: 10 });
    h.flick(); if (variant === 'suspended') h.frame(1000);
    h.flushAnimationFrames(); assert.deepEqual(h.wheels, [], variant);
    h.disposable.dispose();
  }
});

test('application mouse tracking keeps wheel ownership even without normal scrollback', () => {
  const h = flingHarness();
  Object.assign(h.terminal.buffer.active, { type: 'normal', baseY: 0 });
  h.terminal.modes = { mouseTrackingMode: 'any' };
  h.flick(); h.frame();
  assert.ok(h.wheels.length > 0, 'normal-buffer scrollback bounds must not suppress app-owned wheels');
  h.disposable.dispose();
});

test('long press retains word selection without a synthetic mouse lifecycle', async () => {
  const harness = createHarness();
  const screen = harness.root.querySelector('.xterm-screen');
  const mouseEvents = [];
  harness.flushAnimationFrames();
  assert.equal(harness.menu().hidden, false);
  screen.addEventListener('mousedown', () => mouseEvents.push('mousedown'));
  screen.addEventListener('mouseup', () => mouseEvents.push('mouseup'));

  screen.dispatchEvent(touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }));
  assert.equal(harness.menu().hidden, true);
  await new Promise((resolve) => setTimeout(resolve, 470));
  screen.dispatchEvent(touchEvent(harness.window, 'touchmove', screen, { x: 141, y: 90 }));
  screen.dispatchEvent(touchEvent(harness.window, 'touchend', screen, { x: 140, y: 90 }));
  harness.flushAnimationFrames();

  assert.deepEqual(mouseEvents, []);
  assert.deepEqual(harness.wordSelectCalls, [{ column: 4, row: 11 }]);
  assert.deepEqual(harness.selectCalls, []);
  assert.equal(harness.terminal.hasSelection(), true);
  assert.deepEqual(harness.terminal.getSelectionPosition(), {
    start: { x: 2, y: 11 },
    end: { x: 7, y: 11 },
  });
  assert.equal(harness.menu().hidden, false);
  harness.disposable.dispose();
});

test('dragging after long press extends the direct cell selection', async () => {
  const harness = createHarness();
  const screen = harness.root.querySelector('.xterm-screen');
  const mouseEvents = [];
  screen.addEventListener('mousedown', () => mouseEvents.push('mousedown'));
  screen.addEventListener('mousemove', () => mouseEvents.push('mousemove'));
  screen.addEventListener('mouseup', () => mouseEvents.push('mouseup'));

  screen.dispatchEvent(touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }));
  await new Promise((resolve) => setTimeout(resolve, 470));
  screen.dispatchEvent(touchEvent(harness.window, 'touchmove', screen, { x: 160, y: 90 }));
  screen.dispatchEvent(touchEvent(harness.window, 'touchend', screen, { x: 160, y: 90 }));
  harness.flushAnimationFrames();

  assert.deepEqual(mouseEvents, []);
  assert.deepEqual(harness.wordSelectCalls, [{ column: 4, row: 11 }]);
  assert.deepEqual(harness.selectCalls, [
    { column: 4, row: 11, length: 3 },
  ]);
  assert.equal(harness.terminal.hasSelection(), true);
  assert.equal(harness.menu().hidden, false);
  harness.disposable.dispose();
});

test('double tap selects a word directly without a synthetic double click', () => {
  const harness = createHarness();
  const screen = harness.root.querySelector('.xterm-screen');
  let doubleClicks = 0;
  screen.addEventListener('dblclick', () => { doubleClicks += 1; });

  for (let tap = 0; tap < 2; tap += 1) {
    screen.dispatchEvent(touchEvent(harness.window, 'touchstart', screen, { x: 140, y: 90 }));
    screen.dispatchEvent(touchEvent(harness.window, 'touchend', screen, { x: 140, y: 90 }));
  }

  assert.equal(doubleClicks, 0);
  assert.deepEqual(harness.wordSelectCalls, [{ column: 4, row: 11 }]);
  harness.disposable.dispose();
});

test('dragging a handle across its peer preserves the physical moving handle', () => {
  const harness = createHarness();
  harness.flushAnimationFrames();
  const [physicalStart] = harness.handles();

  physicalStart.getBoundingClientRect = () => ({ top: 105, height: 58 });

  physicalStart.dispatchEvent(pointerEvent(harness.window, 'pointerdown', { x: 120, y: 134 }));
  assert.equal(harness.menu().hidden, true);
  physicalStart.dispatchEvent(pointerEvent(harness.window, 'pointermove', { x: 170, y: 140 }));
  harness.flushAnimationFrames();

  assert.deepEqual(harness.selectCalls.at(-1), { column: 7, row: 11, length: 8 });
  assert.equal(physicalStart.style.transform, 'translate3d(150px, 85px, 0)');

  physicalStart.dispatchEvent(pointerEvent(harness.window, 'pointerup', { x: 170, y: 140 }));
  harness.flushAnimationFrames();
  assert.equal(harness.menu().hidden, false);
  harness.disposable.dispose();
});

test('handle mapping advances off a wide-character continuation cell', () => {
  const harness = createHarness({ wideContinuationColumns: new Set([3]) });
  harness.flushAnimationFrames();
  const [, end] = harness.handles();

  end.getBoundingClientRect = () => ({ top: 105, height: 58 });

  end.dispatchEvent(pointerEvent(harness.window, 'pointerdown', { x: 150, y: 134 }));
  end.dispatchEvent(pointerEvent(harness.window, 'pointermove', { x: 130, y: 140 }));

  assert.deepEqual(harness.selectCalls.at(-1), { column: 4, row: 11, length: 8 });

  end.dispatchEvent(pointerEvent(harness.window, 'pointerup', { x: 130, y: 140 }));
  harness.disposable.dispose();
});

test('dragging near a screen edge scrolls by terminal rows', async () => {
  const harness = createHarness();
  harness.flushAnimationFrames();
  const [, end] = harness.handles();

  end.getBoundingClientRect = () => ({ top: 105, height: 58 });

  end.dispatchEvent(pointerEvent(harness.window, 'pointerdown', { x: 150, y: 134 }));
  end.dispatchEvent(pointerEvent(harness.window, 'pointermove', { x: 150, y: 189 }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  end.dispatchEvent(pointerEvent(harness.window, 'pointerup', { x: 150, y: 189 }));

  assert.ok(harness.scrollCalls.includes(1));
  harness.disposable.dispose();
});

test('dispose removes handles and xterm subscriptions', () => {
  const harness = createHarness();
  harness.flushAnimationFrames();
  assert.equal(harness.handles().length, 2);

  harness.disposable.dispose();

  assert.equal(harness.handles().length, 0);
  assert.deepEqual(harness.disposedSubscriptions.sort(), ['resize', 'scroll', 'selection', 'touch']);
});
