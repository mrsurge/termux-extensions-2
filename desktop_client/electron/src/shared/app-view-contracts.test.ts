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
  assert.equal(validateElectronAppViewCommand("read_client_identity"), "read_client_identity");
  assert.equal(validateElectronAppViewCommand("reset_client_identity"), "reset_client_identity");
  assert.equal(
    validateElectronAppViewCommand("wait_for_app_prerequisites"),
    "wait_for_app_prerequisites",
  );
  assert.equal(
    validateElectronAppViewCommand("register_run_target_surface"),
    "register_run_target_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("release_run_target_surface"),
    "release_run_target_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("read_sidebar_presentation_state"),
    "read_sidebar_presentation_state",
  );
  assert.equal(
    validateElectronAppViewCommand("write_sidebar_presentation_state"),
    "write_sidebar_presentation_state",
  );
  assert.equal(
    validateElectronAppViewCommand("detach_sidebar_surface"),
    "detach_sidebar_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("focus_sidebar_surface"),
    "focus_sidebar_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("close_sidebar_surface"),
    "close_sidebar_surface",
  );
  assert.equal(
    validateElectronAppViewCommand("reconcile_sidebar_surfaces"),
    "reconcile_sidebar_surfaces",
  );
  assert.throws(
    () => validateElectronAppViewCommand("execute_javascript"),
    /Unsupported Electron app-view command/,
  );
});
