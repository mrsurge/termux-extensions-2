import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

async function importPresentationState() {
  const result = await build({
    entryPoints: [
      path.join(
        appRoot,
        "main_page/frontend/sidebar-shortcuts/presentation-state.ts",
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

function state(overrides = {}) {
  return {
    version: 1,
    order: ["alpha", "beta", "gamma"],
    foregroundHostId: "beta",
    lastAgentHostId: "alpha",
    lastAgentPresentationId: "presentation-alpha",
    presentations: {
      alpha: "embedded",
      beta: "embedded",
      gamma: "hidden",
    },
    ...overrides,
  };
}

test("ledger reconcile preserves local order and appends new slots deterministically", async () => {
  const { reconcileSidebarPresentationState } = await importPresentationState();

  const reconciled = reconcileSidebarPresentationState(
    state({
      order: ["gamma", "alpha", "beta"],
      foregroundHostId: "gamma",
    }),
    ["delta", "alpha", "gamma", "charlie"],
  );

  assert.deepEqual(reconciled.order, [
    "gamma",
    "alpha",
    "charlie",
    "delta",
  ]);
  assert.equal(reconciled.foregroundHostId, "gamma");
  assert.equal(reconciled.presentations.gamma, "hidden");
  assert.equal(reconciled.presentations.charlie, "embedded");
});

test("removing the foreground chooses its next surviving local neighbor", async () => {
  const { reconcileSidebarPresentationState } = await importPresentationState();

  const nextNeighbor = reconcileSidebarPresentationState(state(), [
    "alpha",
    "gamma",
  ]);
  assert.equal(nextNeighbor.foregroundHostId, "gamma");

  const previousNeighbor = reconcileSidebarPresentationState(
    state({ foregroundHostId: "gamma" }),
    ["alpha", "beta"],
  );
  assert.equal(previousNeighbor.foregroundHostId, "beta");
});

test("reconcile prunes stale presentation and agent identities", async () => {
  const { reconcileSidebarPresentationState } = await importPresentationState();

  const reconciled = reconcileSidebarPresentationState(state(), ["beta"]);

  assert.deepEqual(reconciled.order, ["beta"]);
  assert.deepEqual(reconciled.presentations, { beta: "embedded" });
  assert.equal(reconciled.lastAgentHostId, "");
  assert.equal(reconciled.lastAgentPresentationId, "");
});

test("activation keeps foreground and last agent target as separate facts", async () => {
  const { activateSidebarPresentation } = await importPresentationState();

  const agent = activateSidebarPresentation(state(), "alpha", {
    agent: true,
    presentationId: "agent-frame-2",
  });
  const nonAgent = activateSidebarPresentation(agent, "gamma");

  assert.equal(nonAgent.foregroundHostId, "gamma");
  assert.equal(nonAgent.lastAgentHostId, "alpha");
  assert.equal(nonAgent.lastAgentPresentationId, "agent-frame-2");
});

test("presentation mode changes preserve membership, order, and foreground", async () => {
  const { setSidebarPresentationMode } = await importPresentationState();

  const detached = setSidebarPresentationMode(state(), "beta", "detached");
  assert.deepEqual(detached.order, ["alpha", "beta", "gamma"]);
  assert.equal(detached.foregroundHostId, "beta");
  assert.equal(detached.presentations.beta, "detached");
  assert.deepEqual(
    setSidebarPresentationMode(detached, "missing", "embedded"),
    detached,
  );
});

test("mention target prefers the last active agent over a non-agent foreground", async () => {
  const { resolveSidebarMentionTarget } = await importPresentationState();

  assert.deepEqual(
    resolveSidebarMentionTarget(
      state({ foregroundHostId: "gamma" }),
      "client-a",
      ["alpha"],
      { alpha: "current-alpha-frame" },
    ),
    {
      clientId: "client-a",
      hostId: "alpha",
      presentationId: "presentation-alpha",
    },
  );
});

test("mention target uses the foreground agent only with a live presentation", async () => {
  const { resolveSidebarMentionTarget } = await importPresentationState();
  const firstUseState = state({
    foregroundHostId: "beta",
    lastAgentHostId: "",
    lastAgentPresentationId: "",
  });

  assert.deepEqual(
    resolveSidebarMentionTarget(
      firstUseState,
      "client-a",
      ["beta"],
      { beta: "inline-beta" },
    ),
    {
      clientId: "client-a",
      hostId: "beta",
      presentationId: "inline-beta",
    },
  );
  assert.equal(
    resolveSidebarMentionTarget(firstUseState, "client-a", ["beta"], {}),
    null,
  );
});

test("Electron persistence takes precedence over origin local storage", async () => {
  const {
    loadSidebarPresentationState,
    saveSidebarPresentationState,
  } = await importPresentationState();
  const writes = [];
  const runtimeWindow = {
    localStorage: {
      getItem() {
        throw new Error("localStorage must not be read in Electron");
      },
      setItem() {
        throw new Error("localStorage must not be written in Electron");
      },
    },
    te2Electron: {
      async readSidebarPresentationState() {
        return state({ foregroundHostId: "alpha" });
      },
      async writeSidebarPresentationState(value) {
        writes.push(value);
        return { ok: true };
      },
    },
  };

  const loaded = await loadSidebarPresentationState(runtimeWindow);
  await saveSidebarPresentationState(loaded, runtimeWindow);

  assert.equal(loaded.foregroundHostId, "alpha");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], loaded);
});
