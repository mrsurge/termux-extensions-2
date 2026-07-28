import assert from "node:assert/strict";
import { test } from "node:test";

import { installChromiumScrollbars } from "./chromium-scrollbars";
import { CHROMIUM_SCROLLBAR_STYLE } from "../shared/chromium-scrollbars";

test("Electron scrollbar CSS stays native and excludes terminal/editor scrollbars", () => {
  assert.match(CHROMIUM_SCROLLBAR_STYLE, /scrollbar-width:\s*thin/);
  assert.match(CHROMIUM_SCROLLBAR_STYLE, /scrollbar-color:/);
  assert.match(CHROMIUM_SCROLLBAR_STYLE, /\.xterm-viewport/);
  assert.match(CHROMIUM_SCROLLBAR_STYLE, /\.monaco-scrollable-element/);
});

test("Electron scrollbar CSS is inserted at author origin", async () => {
  const calls: unknown[][] = [];
  await installChromiumScrollbars(
    {
      isDestroyed: () => false,
      insertCSS: async (...args: unknown[]) => {
        calls.push(args);
        return "style-key";
      },
    },
    "test",
  );
  assert.deepEqual(calls, [
    [CHROMIUM_SCROLLBAR_STYLE, { cssOrigin: "author" }],
  ]);
});

test("destroyed Electron contents are not styled", async () => {
  let called = false;
  await installChromiumScrollbars(
    {
      isDestroyed: () => true,
      insertCSS: async () => {
        called = true;
        return "style-key";
      },
    },
    "test",
  );
  assert.equal(called, false);
});
