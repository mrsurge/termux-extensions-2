import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  desktopEditorProjectKey,
  desktopStatePath,
  readDesktopIdentities,
  readDesktopSidebarState,
  readSecondaryEditorPresentation,
  resetDesktopIdentities,
  writeDesktopSidebarState,
  writeSecondaryEditorPresentation,
} from "./desktop-state-store";

function testEnvironment(root: string): NodeJS.ProcessEnv {
  return { ...process.env, TE2_CONFIG_HOME: root, XDG_CONFIG_HOME: "" };
}

async function temporaryRoot(): Promise<string> {
  const root =
    process.env.TEMPDIR ||
    process.env.TMPDIR ||
    join(process.cwd(), ".codex-scratch");
  await mkdir(root, { recursive: true });
  return root;
}

test("desktop state atomically composes identities, Sidebar state, and second-editor presentation", async () => {
  const root = await mkdtemp(
    join(await temporaryRoot(), "te2-electron-desktop-state-"),
  );
  const environment = testEnvironment(root);
  try {
    const identities = await readDesktopIdentities(environment);
    const sidebar = {
      version: 1 as const,
      order: ["agent"],
      foregroundHostId: "agent",
      lastAgentHostId: "agent",
      lastAgentPresentationId: "inline:agent:1",
      presentations: { agent: "embedded" as const },
    };
    const editor = {
      mode: "detached" as const,
      dockSize: 620,
      detachedBounds: { x: 80, y: 90, width: 940, height: 700 },
      maximized: false,
    };
    await Promise.all([
      writeDesktopSidebarState(sidebar, environment),
      writeSecondaryEditorPresentation(
        "http://100.64.0.10:8089",
        "/home/user/project",
        editor,
        environment,
      ),
    ]);

    assert.deepEqual(await readDesktopSidebarState(environment), sidebar);
    assert.deepEqual(
      await readSecondaryEditorPresentation(
        "http://100.64.0.10:8089",
        "/home/user/project",
        environment,
      ),
      editor,
    );
    assert.deepEqual(await readDesktopIdentities(environment), identities);
    const raw = JSON.parse(await readFile(desktopStatePath(environment), "utf8"));
    assert.equal(raw.version, 1);
    assert.deepEqual(raw.identities, identities);
    assert.deepEqual(raw.sidebar, sidebar);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identity reset rotates both editor clients and clears second-editor project presentation", async () => {
  const root = await mkdtemp(
    join(await temporaryRoot(), "te2-electron-desktop-state-"),
  );
  const environment = testEnvironment(root);
  try {
    const before = await readDesktopIdentities(environment);
    await writeSecondaryEditorPresentation(
      "http://127.0.0.1:8089",
      "/home/user/project",
      {
        mode: "docked",
        dockSize: 500,
        detachedBounds: { x: 20, y: 20, width: 900, height: 650 },
        maximized: false,
      },
      environment,
    );
    const after = await resetDesktopIdentities(environment);
    assert.notEqual(after.primaryClientInstanceId, before.primaryClientInstanceId);
    assert.notEqual(after.secondaryClientInstanceId, before.secondaryClientInstanceId);
    assert.equal(
      (
        await readSecondaryEditorPresentation(
          "http://127.0.0.1:8089",
          "/home/user/project",
          environment,
        )
      ).mode,
      "closed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("second-editor project keys retain configured-origin and project boundaries", () => {
  assert.equal(
    desktopEditorProjectKey("http://100.64.0.10:8089", "/home/user/project"),
    "http://100.64.0.10:8089\u0000/home/user/project",
  );
  assert.notEqual(
    desktopEditorProjectKey("http://100.64.0.10:8089", "/home/user/project"),
    desktopEditorProjectKey("http://127.0.0.1:8089", "/home/user/project"),
  );
});
