import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { installCloseOnBlur } from "./blur-close-policy";

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
}

function harness(initiallyFocused = false): {
  window: FakeWindow;
  closeCount(): number;
  flush(): void;
} {
  const window = new FakeWindow();
  window.focused = initiallyFocused;
  const deferred: Array<() => void> = [];
  let closes = 0;
  installCloseOnBlur(window, () => {
    closes += 1;
  }, (callback) => deferred.push(callback));
  return {
    window,
    closeCount: () => closes,
    flush: () => {
      for (const callback of deferred.splice(0)) callback();
    },
  };
}

test("blur close does not arm before the child has held focus", () => {
  const state = harness();
  state.window.blurWindow();
  state.flush();
  assert.equal(state.closeCount(), 0);
});

test("blur close runs once after an armed child loses focus", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  assert.equal(state.closeCount(), 0);
  state.flush();
  assert.equal(state.closeCount(), 1);
  state.window.blurWindow();
  state.flush();
  assert.equal(state.closeCount(), 1);
});

test("focus recovery cancels a pending blur close", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.window.focusWindow();
  state.flush();
  assert.equal(state.closeCount(), 0);
});

test("an already-focused child starts armed", () => {
  const state = harness(true);
  state.window.blurWindow();
  state.flush();
  assert.equal(state.closeCount(), 1);
});

test("a destroyed child ignores its pending blur close", () => {
  const state = harness();
  state.window.focusWindow();
  state.window.blurWindow();
  state.window.destroyed = true;
  state.flush();
  assert.equal(state.closeCount(), 0);
});
