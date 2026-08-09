import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateElectronSidebarSurfaceAction,
  validateElectronSidebarSurfaceDescriptor,
  validateElectronSidebarSurfaceReconcileRequest,
} from "./sidebar-surface-contracts";

function descriptor() {
  return {
    version: 1,
    hostId: "run-profile:project:preview",
    surfaceId: "run-profile:project:preview",
    presentationId: "detached:run-profile:project:preview:one",
    label: "Preview",
    url: "http://127.0.0.1:43123/app",
    windowName: `te2-run-profile:${encodeURIComponent(JSON.stringify({
      surfaceId: "run-profile:project:preview",
      devRuntime: true,
    }))}`,
    appId: "",
    projectPath: "/home/test/project",
    profileId: "preview",
    shellId: "shell-one",
    devRuntime: true,
    devTools: false,
    consoleWorkerId: "rp-prev-elct-abcd",
  };
}

test("detached Sidebar descriptors retain bounded immutable presentation metadata", () => {
  assert.deepEqual(validateElectronSidebarSurfaceDescriptor(descriptor()), {
    ...descriptor(),
    url: "http://127.0.0.1:43123/app",
  });
  assert.throws(
    () => validateElectronSidebarSurfaceDescriptor({ ...descriptor(), url: "file:///etc/passwd" }),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => validateElectronSidebarSurfaceDescriptor({ ...descriptor(), windowName: "arbitrary" }),
    /not a TE2 marker/,
  );
  assert.throws(
    () => validateElectronSidebarSurfaceDescriptor({ ...descriptor(), devRuntime: "yes" }),
    /must be boolean/,
  );
});

test("surface reconciliation is bounded and de-duplicates stable ids", () => {
  assert.deepEqual(
    validateElectronSidebarSurfaceReconcileRequest({
      surfaceIds: ["one", "two", "one"],
    }),
    { surfaceIds: ["one", "two"] },
  );
});

test("detached surface actions use a closed allowlist", () => {
  assert.equal(validateElectronSidebarSurfaceAction("attach"), "attach");
  assert.equal(validateElectronSidebarSurfaceAction("devtools"), "devtools");
  assert.throws(() => validateElectronSidebarSurfaceAction("shell"), /Unsupported/);
});
