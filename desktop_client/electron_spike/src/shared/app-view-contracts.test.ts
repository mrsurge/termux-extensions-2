import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ELECTRON_APP_VIEW_IDENTITY,
  validateElectronAppViewCommand,
} from "./app-view-contracts";

test("Electron app-view identity is explicit and console-visible", () => {
  assert.deepEqual(ELECTRON_APP_VIEW_IDENTITY, {
    client: "electron",
    surface: "framework-app-view",
    consoleWorkerLabel: "electron:main_page",
  });
  assert.equal(Object.isFrozen(ELECTRON_APP_VIEW_IDENTITY), true);
});

test("Electron app-view commands are strictly allowlisted", () => {
  assert.equal(validateElectronAppViewCommand("inspect"), "inspect");
  assert.equal(validateElectronAppViewCommand("force_asset_update"), "force_asset_update");
  assert.equal(validateElectronAppViewCommand("resolve_run_target"), "resolve_run_target");
  assert.equal(
    validateElectronAppViewCommand("register_run_target_surface"),
    "register_run_target_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("release_run_target_surface"),
    "release_run_target_surface",
  );
  assert.throws(
    () => validateElectronAppViewCommand("execute_javascript"),
    /Unsupported Electron app-view command/,
  );
});
