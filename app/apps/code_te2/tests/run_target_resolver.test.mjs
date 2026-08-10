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
    ownerId: "code_te2:run-profile:project:preview",
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
    "code_te2:run-profile:project:preview",
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

test("Gecko runtime registration remains event-driven and surface-scoped", async () => {
  const { prepareRunTargetUrl } = await importRunTargetResolver();
  const posted = [];
  const listeners = new Set();
  const runtimeWindow = {
    location: { origin: "http://framework.example:8089" },
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message, origin) {
      posted.push({ message, origin });
      if (message.channel !== "te2.runTarget.register.request") return;
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          listener({
            source: runtimeWindow,
            origin: runtimeWindow.location.origin,
            data: {
              channel: "te2.runTarget.register.response",
              requestId: message.requestId,
              result: { ok: true },
            },
          });
        }
      });
    },
  };
  globalThis.window = runtimeWindow;
  globalThis.document = {
    documentElement: { dataset: { te2RunTargetBridge: "1" } },
  };
  const runtime = {
    surfaceId: "run-profile:project:preview",
    profileId: "preview",
    devRuntime: true,
    devTools: false,
    workerIdBase: "rp-prev",
    workerLabel: "run-profile:project:preview",
    frameworkOrigin: runtimeWindow.location.origin,
  };

  const resolved = await prepareRunTargetUrl(
    routeSet(),
    "http://localhost:43123/",
    runtime,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(resolved, "http://localhost:43123/");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].message.channel, "te2.runTarget.register.request");
  assert.equal(posted[0].message.runtime.surfaceId, runtime.surfaceId);
  assert.equal(posted[0].message.route.shellId, "shell-generation-1");
  assert.equal(posted[0].origin, runtimeWindow.location.origin);
  assert.equal(listeners.size, 0);
});

test("Gecko surface release is a single exact event, not route polling", async () => {
  const { releaseRunTargetSurface } = await importRunTargetResolver();
  const posted = [];
  globalThis.window = {
    location: { origin: "http://framework.example:8089" },
    postMessage(message, origin) {
      posted.push({ message, origin });
    },
  };
  globalThis.document = {
    documentElement: { dataset: { te2RunTargetBridge: "1" } },
  };

  await releaseRunTargetSurface("run-profile:project:preview");

  assert.deepEqual(posted, [{
    message: {
      channel: "te2.runTarget.release.request",
      surfaceId: "run-profile:project:preview",
    },
    origin: "http://framework.example:8089",
  }]);
});
