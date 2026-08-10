import assert from "node:assert/strict";
import { test } from "node:test";

import { DESKTOP_MODAL_WINDOW_POLICY } from "./modal-window-policy";

test("Electron modal windows retain parent-modal ownership without global topmost", () => {
  assert.deepEqual(DESKTOP_MODAL_WINDOW_POLICY, {
    modal: true,
  });
});
