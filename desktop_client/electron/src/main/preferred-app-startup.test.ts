import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePreferredAppStartupUrl,
  runDesktopStartupSequence,
} from "./preferred-app-startup";

const configuredFrameworkOrigin = "http://100.64.0.5:8089";
const browserFrameworkOrigin = "http://127.0.0.1:43127";

function options(overrides: Record<string, unknown> = {}) {
  return {
    settings: { autostart: true, preferredAppId: "code_te2" },
    environment: {},
    configuredFrameworkOrigin,
    browserFrameworkOrigin,
    request: async ({ path }: { path: string }) => {
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

test("preferred-app startup uses the ordinary app open action directly", async () => {
  const requests: Array<{ path: string; method?: string; body?: unknown }> = [];
  const target = await resolvePreferredAppStartupUrl(options({
    request: async (request: { path: string; method?: string; body?: unknown }) => {
      requests.push(request);
      return { url: `${configuredFrameworkOrigin}/app/code_te2?ready=1` };
    },
  }));

  assert.equal(target, `${browserFrameworkOrigin}/app/code_te2?ready=1`);
  assert.deepEqual(requests, [
    {
      path: "/api/apps/code_te2/open",
      method: "POST",
      body: { params: {} },
    },
  ]);
});

test("preferred-app startup propagates an unavailable saved app", async () => {
  await assert.rejects(
    resolvePreferredAppStartupUrl(options({
      request: async () => {
        throw new Error("Preferred app is unavailable: code_te2");
      },
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
      request: async () => {
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

test("desktop startup starts the local framework before opening the preferred app", async () => {
  const events: string[] = [];
  await runDesktopStartupSequence({
    startLocalFrameworkOnLaunch: true,
    startLocalFramework: async () => { events.push("framework"); },
    preparePreferredApp: async () => {
      events.push("app");
      return "/app/code_te2";
    },
    navigatePreferredApp: async () => { events.push("navigate"); },
    onLocalFrameworkError: () => { events.push("error"); },
  });
  assert.deepEqual(events, ["framework", "app", "navigate"]);
});

test("desktop startup can open an app through an already-running framework", async () => {
  const events: string[] = [];
  await runDesktopStartupSequence({
    startLocalFrameworkOnLaunch: false,
    startLocalFramework: async () => { events.push("framework"); },
    preparePreferredApp: async () => {
      events.push("app");
      return "/app/code_te2";
    },
    navigatePreferredApp: async () => { events.push("navigate"); },
    onLocalFrameworkError: () => { events.push("error"); },
  });
  assert.deepEqual(events, ["app", "navigate"]);
});

test("desktop startup prepares and navigates the app without a renderer gate", async () => {
  const events: string[] = [];
  await runDesktopStartupSequence({
    startLocalFrameworkOnLaunch: false,
    startLocalFramework: async () => { events.push("framework"); },
    preparePreferredApp: async () => {
      events.push("app");
      return "/app/code_te2";
    },
    navigatePreferredApp: async () => { events.push("navigate"); },
    onLocalFrameworkError: () => { events.push("error"); },
  });
  assert.deepEqual(events, ["app", "navigate"]);
});

test("desktop startup leaves the launcher visible without an app target", async () => {
  const events: string[] = [];
  await runDesktopStartupSequence({
    startLocalFrameworkOnLaunch: false,
    startLocalFramework: async () => { events.push("framework"); },
    preparePreferredApp: async () => {
      events.push("app");
      return null;
    },
    navigatePreferredApp: async () => { events.push("navigate"); },
    onLocalFrameworkError: () => { events.push("error"); },
  });
  assert.deepEqual(events, ["app"]);
});

test("desktop startup leaves the launcher active when local startup fails", async () => {
  const events: string[] = [];
  await runDesktopStartupSequence({
    startLocalFrameworkOnLaunch: true,
    startLocalFramework: async () => {
      events.push("framework");
      throw new Error("unavailable");
    },
    preparePreferredApp: async () => {
      events.push("app");
      return "/app/code_te2";
    },
    navigatePreferredApp: async () => { events.push("navigate"); },
    onLocalFrameworkError: (error) => {
      assert.match(String(error), /unavailable/);
      events.push("error");
    },
  });
  assert.deepEqual(events, ["framework", "error"]);
});
