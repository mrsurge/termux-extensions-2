import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importRuntime() {
  const result = await build({
    entryPoints: [path.join(
      appRoot,
      "main_page/frontend/mobile-secondary-editor.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}`);
}

async function importStateRuntime() {
  const result = await build({
    entryPoints: [path.join(
      appRoot,
      "main_page/frontend/secondary-editor-state.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}`);
}

async function importIssueRuntime() {
  const result = await build({
    entryPoints: [path.join(
      appRoot,
      "main_page/frontend/ui/diagnostic-issue-pills.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}`);
}

test("mobile second editor follows client capability rather than viewport width", async () => {
  const { supportsMobileSecondEditor } = await importRuntime();
  const mobileNavigator = {
    userAgent: "Desktop-like UA",
    userAgentData: { mobile: true },
  };
  const desktopNavigator = {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    userAgentData: { mobile: false },
  };

  assert.equal(supportsMobileSecondEditor(
    mobileNavigator,
    { location: new URL("http://127.0.0.1/app/code_te2") },
  ), true);
  assert.equal(supportsMobileSecondEditor(
    desktopNavigator,
    { location: new URL("http://127.0.0.1/app/code_te2") },
  ), false);
  assert.equal(supportsMobileSecondEditor(
    desktopNavigator,
    {
      location: new URL(
        "http://127.0.0.1/app/code_te2?gv_native=1&te2_renderer=cefrium",
      ),
    },
  ), true);
  assert.equal(supportsMobileSecondEditor(
    mobileNavigator,
    {
      location: new URL("http://127.0.0.1/app/code_te2"),
      te2Electron: {},
    },
  ), false);
});

test("an explicit null secondary foreground stays empty", async () => {
  const { secondaryEditorActivePath } = await importStateRuntime();

  assert.equal(secondaryEditorActivePath({
    currentPath: "/project/primary.ts",
    clientForeground: { path: null },
  }), "");
  assert.equal(secondaryEditorActivePath({
    currentPath: "/project/legacy.ts",
  }), "/project/legacy.ts");
  assert.equal(secondaryEditorActivePath({
    currentPath: "/project/legacy.ts",
    clientForeground: { path: "/project/secondary.ts" },
  }), "/project/secondary.ts");
});

test("mobile Second Window tab requires populated, non-dismissed state", async () => {
  const { mobileSecondaryTabVisible } = await importStateRuntime();
  const base = { supported: true, mobileLayout: true, populated: true, dismissed: false };

  assert.equal(mobileSecondaryTabVisible(base), true);
  assert.equal(mobileSecondaryTabVisible({ ...base, populated: false }), false);
  assert.equal(mobileSecondaryTabVisible({ ...base, dismissed: true }), false);
  assert.equal(mobileSecondaryTabVisible({ ...base, mobileLayout: false }), false);
  assert.equal(mobileSecondaryTabVisible({ ...base, supported: false }), false);
});

test("mobile Second Window shortcut survives local tab dismissal", async () => {
  const { mobileSecondaryShortcutVisible } = await importStateRuntime();

  assert.equal(mobileSecondaryShortcutVisible({
    supported: true,
    mobileLayout: true,
    populated: true,
  }), true);
  assert.equal(mobileSecondaryShortcutVisible({
    supported: true,
    mobileLayout: true,
    populated: false,
  }), false);
  assert.equal(mobileSecondaryShortcutVisible({
    supported: true,
    mobileLayout: false,
    populated: true,
  }), false);
});

test("diagnostic issue pills normalize the shared count projection", async () => {
  const { diagnosticIssueCounts } = await importIssueRuntime();

  assert.deepEqual(diagnosticIssueCounts({ errors: 2, warnings: 3, hints: 4 }), {
    errors: 2,
    warnings: 3,
    hints: 4,
    total: 9,
  });
  assert.deepEqual(diagnosticIssueCounts({ errors: -1, warnings: NaN }), {
    errors: 0,
    warnings: 0,
    hints: 0,
    total: 0,
  });
});

test("mobile collapse and close preserve the retained renderer geometry", async () => {
  const { mobileSecondaryModeTransition } = await importStateRuntime();

  assert.deepEqual(mobileSecondaryModeTransition("collapsed"), {
    hostMode: "collapsed",
    rendererMode: "docked",
  });
  assert.deepEqual(mobileSecondaryModeTransition("closed"), {
    hostMode: "closed",
    rendererMode: "docked",
  });
  assert.deepEqual(mobileSecondaryModeTransition("detached"), {
    hostMode: "docked",
    rendererMode: "docked",
  });
});
