import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreferredAppStartupUrl } from "./preferred-app-startup";

const configuredFrameworkOrigin = "http://100.64.0.5:8089";
const browserFrameworkOrigin = "http://127.0.0.1:43127";

function options(overrides: Record<string, unknown> = {}) {
  return {
    settings: { autostart: true, preferredAppId: "code_te2" },
    environment: {},
    configuredFrameworkOrigin,
    browserFrameworkOrigin,
    request: async ({ path }: { path: string }) => {
      if (path === "/api/apps/catalog") return [{ id: "code_te2" }];
      return { url: `${configuredFrameworkOrigin}/app/code_te2` };
    },
    ...overrides,
  };
}

test("preferred-app startup is inert when autostart is disabled", async () => {
  let requests = 0;
  const target = await resolvePreferredAppStartupUrl(options({
    settings: { autostart: false, preferredAppId: "code_te2" },
    request: async () => {
      requests += 1;
      return [];
    },
  }));
  assert.equal(target, null);
  assert.equal(requests, 0);
});

test("preferred-app startup uses catalog plus the ordinary app open action", async () => {
  const requests: Array<{ path: string; method?: string; body?: unknown }> = [];
  const target = await resolvePreferredAppStartupUrl(options({
    request: async (request: { path: string; method?: string; body?: unknown }) => {
      requests.push(request);
      return request.path === "/api/apps/catalog"
        ? [{ id: "terminal" }, { id: "code_te2" }]
        : { url: `${configuredFrameworkOrigin}/app/code_te2?ready=1` };
    },
  }));

  assert.equal(target, `${browserFrameworkOrigin}/app/code_te2?ready=1`);
  assert.deepEqual(requests, [
    { path: "/api/apps/catalog" },
    {
      path: "/api/apps/code_te2/open",
      method: "POST",
      body: { params: {} },
    },
  ]);
});

test("preferred-app startup fails closed when the saved app is unavailable", async () => {
  await assert.rejects(
    resolvePreferredAppStartupUrl(options({
      request: async () => [{ id: "terminal" }],
    })),
    /Preferred app is unavailable: code_te2/,
  );
});

test("preferred-app startup propagates framework and open failures", async () => {
  await assert.rejects(
    resolvePreferredAppStartupUrl(options({
      request: async () => {
        throw new Error("framework offline");
      },
    })),
    /framework offline/,
  );
  await assert.rejects(
    resolvePreferredAppStartupUrl(options({
      request: async ({ path }: { path: string }) => {
        if (path === "/api/apps/catalog") return [{ id: "code_te2" }];
        throw new Error("open rejected");
      },
    })),
    /open rejected/,
  );
});

test("development auto-open keeps the historical code_te2 default", async () => {
  const target = await resolvePreferredAppStartupUrl(options({
    settings: { autostart: false, preferredAppId: "" },
    environment: { TE2_DESKTOP_AUTO_OPEN: "1" },
  }));
  assert.equal(target, `${browserFrameworkOrigin}/app/code_te2`);
});
