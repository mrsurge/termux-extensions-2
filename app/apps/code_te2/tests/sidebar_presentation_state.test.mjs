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
  const reads = [];
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
      async readSidebarPresentationState(projectPath) {
        reads.push(projectPath);
        return state({ foregroundHostId: "alpha" });
      },
      async writeSidebarPresentationState(projectPath, value) {
        writes.push({ projectPath, value });
        return { ok: true };
      },
    },
  };

  const loaded = await loadSidebarPresentationState("/workspace/a", runtimeWindow);
  await saveSidebarPresentationState(loaded, "/workspace/a", runtimeWindow);

  assert.equal(loaded.foregroundHostId, "alpha");
  assert.deepEqual(reads, ["/workspace/a"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].projectPath, "/workspace/a");
  assert.equal(writes[0].value.lastAgentPresentationId, "");
});

test("Electron-loaded presentation state canonicalizes stable ids and clears transient ids", async () => {
  const { loadSidebarPresentationState } = await importPresentationState();
  const writes = [];
  let persisted = state({
    order: ["slot:file_editor_cm6:primary", "terminal"],
    foregroundHostId: "slot:file_editor_cm6:primary",
    lastAgentHostId: "slot:file_editor_cm6:primary",
    lastAgentPresentationId: "frame:file_editor_cm6:primary",
    presentations: {
      "slot:file_editor_cm6:primary": "detached",
      terminal: "embedded",
    },
  });
  const runtimeWindow = {
    te2Electron: {
      async readSidebarPresentationState() {
        return persisted;
      },
      async writeSidebarPresentationState(_projectPath, value) {
        writes.push(value);
        persisted = value;
        return value;
      },
    },
  };

  const first = await loadSidebarPresentationState("/workspace/a", runtimeWindow);
  const second = await loadSidebarPresentationState("/workspace/a", runtimeWindow);

  assert.deepEqual(first.order, ["slot:code_te2:primary", "terminal"]);
  assert.equal(first.foregroundHostId, "slot:code_te2:primary");
  assert.equal(first.lastAgentPresentationId, "");
  assert.equal(first.presentations["slot:code_te2:primary"], "detached");
  assert.deepEqual(second, first);
  assert.equal(writes.length, 0);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

test("browser persistence partitions by selected framework origin and project", async () => {
  const {
    loadSidebarPresentationState,
    saveSidebarPresentationState,
  } = await importPresentationState();
  const localStorage = memoryStorage();
  const remote = {
    localStorage,
    location: {
      origin: "http://127.0.0.1:40000",
      search: "?te2_framework_origin=http%3A%2F%2Fserver-a%3A8089",
    },
  };
  const otherServer = {
    localStorage,
    location: {
      origin: "http://127.0.0.1:40001",
      search: "?te2_framework_origin=http%3A%2F%2Fserver-b%3A8089",
    },
  };

  await saveSidebarPresentationState(
    state({ foregroundHostId: "alpha" }),
    "/workspace/a/",
    remote,
  );
  await saveSidebarPresentationState(
    state({ foregroundHostId: "gamma" }),
    "/workspace/b",
    remote,
  );

  assert.equal(
    (await loadSidebarPresentationState("/workspace/a", remote)).foregroundHostId,
    "alpha",
  );
  assert.equal(
    (await loadSidebarPresentationState("/workspace/b", remote)).foregroundHostId,
    "gamma",
  );
  assert.equal(
    (await loadSidebarPresentationState("/workspace/a", otherServer)).foregroundHostId,
    "",
  );
  assert.equal(
    (await loadSidebarPresentationState("/workspace/a", remote)).lastAgentPresentationId,
    "",
  );
});

test("browser persistence rewrites transient presentation ids during load", async () => {
  const {
    SIDEBAR_PRESENTATION_STORAGE_KEY,
    loadSidebarPresentationState,
  } = await importPresentationState();
  const key = "http://server-a:8089\u0000/workspace/a";
  const localStorage = memoryStorage({
    [SIDEBAR_PRESENTATION_STORAGE_KEY]: JSON.stringify({
      version: 2,
      projects: {
        [key]: {
          updatedAt: 1,
          state: state({ lastAgentPresentationId: "transient-frame" }),
        },
      },
    }),
  });
  const runtimeWindow = {
    localStorage,
    location: {
      origin: "http://127.0.0.1:40000",
      search: "?te2_framework_origin=http%3A%2F%2Fserver-a%3A8089",
    },
  };

  const loaded = await loadSidebarPresentationState(
    "/workspace/a",
    runtimeWindow,
  );
  const rewritten = JSON.parse(
    localStorage.values.get(SIDEBAR_PRESENTATION_STORAGE_KEY),
  );

  assert.equal(loaded.lastAgentPresentationId, "");
  assert.equal(
    rewritten.projects[key].state.lastAgentPresentationId,
    "",
  );
});

test("legacy browser presentation migrates into only the first project", async () => {
  const { loadSidebarPresentationState } = await importPresentationState();
  const localStorage = memoryStorage({
    "te2.sidebar.presentation.v1": JSON.stringify(
      state({ foregroundHostId: "gamma" }),
    ),
  });
  const runtimeWindow = {
    localStorage,
    location: { origin: "http://localhost:8089", search: "" },
  };

  assert.equal(
    (await loadSidebarPresentationState("/workspace/a", runtimeWindow)).foregroundHostId,
    "gamma",
  );
  assert.equal(
    (await loadSidebarPresentationState("/workspace/b", runtimeWindow)).foregroundHostId,
    "",
  );
  assert.equal(localStorage.values.has("te2.sidebar.presentation.v1"), false);
});
