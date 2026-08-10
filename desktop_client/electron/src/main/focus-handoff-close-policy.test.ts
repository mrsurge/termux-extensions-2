import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { installCloseOnFocusHandoff } from "./focus-handoff-close-policy";

class FakeWindow extends EventEmitter {
  focused = false;
  destroyed = false;

  isFocused(): boolean {
    return this.focused;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  focusWindow(): void {
    this.focused = true;
    this.emit("focus");
  }

  blurWindow(): void {
    this.focused = false;
    this.emit("blur");
  }

  closeWindow(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

class FakeWindowFocusSource extends EventEmitter {
  focusWindow(window: FakeWindow): void {
    this.emit("browser-window-focus", {}, window);
  }
}

function harness(initiallyFocused = false): {
  window: FakeWindow;
  focusSource: FakeWindowFocusSource;
  closeCount(): number;
  dispose(): void;
} {
  const window = new FakeWindow();
  window.focused = initiallyFocused;
  const focusSource = new FakeWindowFocusSource();
  let closes = 0;
  const dispose = installCloseOnFocusHandoff(window, focusSource, () => {
    closes += 1;
  });
  return {
    window,
    focusSource,
    closeCount: () => closes,
    dispose,
  };
}

test("focus handoff does not arm before the child has held focus", () => {
  const state = harness();
  state.window.blurWindow();
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
});

test("blur alone does not close without a TE2 window focus handoff", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  assert.equal(state.closeCount(), 0);
});

test("focus handoff to another TE2 window closes once", () => {
  const state = harness();
  const peer = new FakeWindow();
  state.window.focusWindow();
  state.window.blurWindow();
  state.focusSource.focusWindow(peer);
  assert.equal(state.closeCount(), 1);
  state.focusSource.focusWindow(peer);
  assert.equal(state.closeCount(), 1);
});

test("focus recovery in the child cancels the pending handoff", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.focusSource.focusWindow(state.window);
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
});

test("an already-focused child starts armed", () => {
  const state = harness(true);
  state.window.blurWindow();
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 1);
});

test("focus handoff before blur does not close the child", () => {
  const state = harness();
  state.window.focusWindow();
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
});

test("a destroyed child ignores a pending focus handoff", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.window.destroyed = true;
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
});

test("disposing removes listeners and cancels a pending focus handoff", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.dispose();
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
  assert.equal(state.window.listenerCount("focus"), 0);
  assert.equal(state.window.listenerCount("blur"), 0);
  assert.equal(state.window.listenerCount("closed"), 0);
  assert.equal(state.focusSource.listenerCount("browser-window-focus"), 0);
});

test("child close automatically removes the application focus listener", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.window.closeWindow();
  state.focusSource.focusWindow(new FakeWindow());
  assert.equal(state.closeCount(), 0);
  assert.equal(state.window.listenerCount("focus"), 0);
  assert.equal(state.window.listenerCount("blur"), 0);
  assert.equal(state.window.listenerCount("closed"), 0);
  assert.equal(state.focusSource.listenerCount("browser-window-focus"), 0);
});
