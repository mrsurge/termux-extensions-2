import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  desktopSidebarPresentationPath,
  readDesktopSidebarPresentationState,
  validateDesktopSidebarPresentationState,
  writeDesktopSidebarPresentationState,
} from "./sidebar-presentation-store";

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
  const environment = { ...process.env, XDG_CONFIG_HOME: configHome };

  const written = await writeDesktopSidebarPresentationState(
    sampleState,
    environment,
  );
  const loaded = await readDesktopSidebarPresentationState(environment);
  const raw = JSON.parse(
    await readFile(desktopSidebarPresentationPath(environment), "utf8"),
  );

  assert.deepEqual(written, sampleState);
  assert.deepEqual(loaded, sampleState);
  assert.deepEqual(raw, sampleState);
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

test("missing or corrupt presentation state resolves to an empty versioned state", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "te2-electron-presentation-"));
  const loaded = await readDesktopSidebarPresentationState({
    ...process.env,
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
