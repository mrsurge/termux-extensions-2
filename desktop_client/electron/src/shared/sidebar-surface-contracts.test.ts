import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateElectronSidebarSurfaceAction,
  validateElectronSidebarMenuRequest,
  validateElectronSidebarSurfaceDescriptor,
  validateElectronSidebarSurfacePlaceRequest,
  validateElectronSidebarSurfaceReconcileRequest,
} from "./sidebar-surface-contracts";

function descriptor() {
  return {
    version: 2,
    renderer: "url",
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

test("persistent extension placement validates bounded renderer coordinates", () => {
  const request = validateElectronSidebarSurfacePlaceRequest({
    descriptor: { ...descriptor(), renderer: "persistent-extension" },
    bounds: { x: 12.5, y: 20, width: 640, height: 480 },
    visible: true,
  });
  assert.equal(request.descriptor.renderer, "persistent-extension");
  assert.deepEqual(request.bounds, { x: 12.5, y: 20, width: 640, height: 480 });
  assert.throws(
    () => validateElectronSidebarSurfacePlaceRequest({
      descriptor: descriptor(),
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      visible: true,
    }),
    /Only persistent extension surfaces/,
  );
});

test("native Sidebar menus accept only bounded declarative items", () => {
  assert.deepEqual(
    validateElectronSidebarMenuRequest({
      x: 12,
      y: 34,
      items: [
        { type: "label", label: "Preview" },
        { type: "separator" },
        { type: "item", id: "detach", label: "Detach", enabled: true },
      ],
    }),
    {
      x: 12,
      y: 34,
      items: [
        { type: "label", label: "Preview" },
        { type: "separator" },
        { type: "item", id: "detach", label: "Detach", enabled: true },
      ],
    },
  );
  assert.throws(
    () => validateElectronSidebarMenuRequest({
      x: 0,
      y: 0,
      items: [{ type: "item", id: "run", label: "Run" }],
    }),
    /enabled must be boolean/,
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
