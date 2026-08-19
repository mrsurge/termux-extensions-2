import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  desktopSidebarPresentationPath,
  readDesktopSidebarPresentationState,
  validateDesktopSidebarPresentationState,
  writeDesktopSidebarPresentationState,
} from "./sidebar-presentation-store";
import { desktopStatePath } from "./desktop-state-store";

const sampleState = {
  version: 1 as const,
  order: ["agent", "terminal"],
  foregroundHostId: "terminal",
  lastAgentHostId: "agent",
  lastAgentPresentationId: "inline:agent:1",
  presentations: {
    agent: "embedded" as const,
    terminal: "hidden" as const,
  },
};

test("Sidebar presentation state is stored atomically under the TE2 config boundary", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "te2-electron-presentation-"));
  const environment = { ...process.env, TE2_CONFIG_HOME: "", XDG_CONFIG_HOME: configHome };

  const written = await writeDesktopSidebarPresentationState(
    sampleState,
    environment,
  );
  const loaded = await readDesktopSidebarPresentationState(environment);
  const raw = JSON.parse(
    await readFile(desktopStatePath(environment), "utf8"),
  );

  assert.deepEqual(written, sampleState);
  assert.deepEqual(loaded, sampleState);
  assert.deepEqual(raw.sidebar, sampleState);
});

test("Sidebar presentation validation rejects unknown modes and versions", () => {
  assert.throws(
    () => validateDesktopSidebarPresentationState({ ...sampleState, version: 2 }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      validateDesktopSidebarPresentationState({
        ...sampleState,
        presentations: { agent: "floating" },
      }),
    /Invalid Sidebar presentation mode/,
  );
});

test("missing presentation state resolves to an empty versioned state", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "te2-electron-presentation-"));
  const loaded = await readDesktopSidebarPresentationState({
    ...process.env,
    TE2_CONFIG_HOME: "",
    XDG_CONFIG_HOME: configHome,
  });

  assert.deepEqual(loaded, {
    version: 1,
    order: [],
    foregroundHostId: "",
    lastAgentHostId: "",
    lastAgentPresentationId: "",
    presentations: {},
  });
});

test("legacy Code TE2 identities are canonicalized and rewritten on read", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "te2-electron-presentation-"));
  const environment = { ...process.env, TE2_CONFIG_HOME: "", XDG_CONFIG_HOME: configHome };
  const path = desktopSidebarPresentationPath(environment);
  const legacy = {
    version: 1,
    order: ["slot:file_editor_cm6:primary", "terminal"],
    foregroundHostId: "slot:file_editor_cm6:primary",
    lastAgentHostId: "slot:file_editor_cm6:primary",
    lastAgentPresentationId: "frame:file_editor_cm6:primary",
    presentations: {
      "slot:file_editor_cm6:primary": "detached",
      terminal: "embedded",
    },
  };
  await mkdir(dirname(path), { recursive: true });
  // Seed the historical standalone file before the unified state exists.
  await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const loaded = await readDesktopSidebarPresentationState(environment);
  const raw = await readFile(desktopStatePath(environment), "utf8");

  assert.deepEqual(loaded.order, ["slot:code_te2:primary", "terminal"]);
  assert.equal(loaded.foregroundHostId, "slot:code_te2:primary");
  assert.equal(loaded.lastAgentPresentationId, "frame:code_te2:primary");
  assert.doesNotMatch(raw, /file_editor_cm6/);
});
