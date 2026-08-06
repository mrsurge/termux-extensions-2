import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

async function importRunTargetResolver() {
  const result = await build({
    entryPoints: [
      path.join(
        appRoot,
        "main_page/frontend/sidebar-shortcuts/run-target-resolver.ts",
      ),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence++}`
  );
}

function routeSet(port = 43123) {
  const ticket = "a".repeat(64);
  return {
    dto: "RunTargetRouteSet",
    version: 1,
    ownerId: "file_editor_cm6:run-profile:project:preview",
    shellId: "shell-generation-1",
    relayGroupId: ticket,
    primary: {
      dto: "RunTargetRoute",
      version: 1,
      ticket,
      tunnelPath: `/api/run-targets/${ticket}/tunnel`,
      preferredPort: port,
      originalUrl: `http://localhost:${port}/`,
    },
    additional: [],
  };
}

test("route URL stays canonical while Electron receives instrumentation metadata", async () => {
  const { prepareRunTargetUrl } = await importRunTargetResolver();
  let registration = null;
  globalThis.window = {
    te2Electron: {
      registerRunTargetSurface: async (runtime, url, route) => {
        registration = { runtime, url, route };
        return { ok: true };
      },
    },
  };

  const runtime = {
    surfaceId: "run-profile:project:preview",
    profileId: "preview",
    devRuntime: true,
    devTools: false,
    workerIdBase: "rp-prev-elct-ownr",
    workerLabel: "run-profile:preview",
    frameworkOrigin: "http://framework.example:8089",
  };

  const resolved = await prepareRunTargetUrl(
    routeSet(),
    "http://localhost:43123/",
    runtime,
  );
  await Promise.resolve();

  assert.equal(resolved, "http://localhost:43123/");
  assert.equal(registration.runtime, runtime);
  assert.equal(registration.url, "http://localhost:43123/");
  assert.equal(
    registration.route.ownerId,
    "file_editor_cm6:run-profile:project:preview",
  );
  assert.equal(registration.route.shellId, "shell-generation-1");
});

test("native surface release preserves the dev-runtime policy id", async () => {
  const { releaseRunTargetSurface } = await importRunTargetResolver();
  const released = [];
  globalThis.window = {
    te2Electron: {
      releaseRunTargetSurface: async (surfaceId) => {
        released.push(surfaceId);
        return { ok: true };
      },
    },
  };

  await releaseRunTargetSurface("  run-profile:project:preview  ");

  assert.deepEqual(released, ["run-profile:project:preview"]);
});
