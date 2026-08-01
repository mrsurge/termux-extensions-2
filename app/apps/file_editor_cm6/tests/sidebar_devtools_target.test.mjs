import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importTargetMarker() {
  const result = await build({
    entryPoints: [
      path.join(
        appRoot,
        "main_page/frontend/sidebar-shortcuts/devtools-target.ts",
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
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
}

test("enabled Run Profile iframe receives an encoded native target marker", async () => {
  const {
    DEVTOOLS_TARGET_WINDOW_NAME_PREFIX,
    devToolsTargetWindowName,
  } = await importTargetMarker();
  const marker = devToolsTargetWindowName({
    key: "url:preview",
    label: "Run preview",
    url: "http://127.0.0.1:3000/",
    load: "lazy",
    devTools: true,
    devToolsTargetId: "run-profile:abc123:preview",
  });

  assert.ok(marker.startsWith(DEVTOOLS_TARGET_WINDOW_NAME_PREFIX));
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(marker.slice(DEVTOOLS_TARGET_WINDOW_NAME_PREFIX.length)),
    ),
    {
      targetId: "run-profile:abc123:preview",
      targetLabel: "Run preview",
    },
  );
});

test("disabled or unidentified iframe is not exposed to native Inspector", async () => {
  const { devToolsTargetWindowName } = await importTargetMarker();
  const base = {
    key: "url:preview",
    label: "Run preview",
    url: "http://127.0.0.1:3000/",
    load: "lazy",
  };

  assert.equal(
    devToolsTargetWindowName({
      ...base,
      devTools: false,
      devToolsTargetId: "run-profile:abc123:preview",
    }),
    "",
  );
  assert.equal(devToolsTargetWindowName({ ...base, devTools: true }), "");
});

test("a loaded iframe is recreated when its native target marker changes", async () => {
  const {
    devToolsTargetWindowName,
    shouldRecreateDevToolsTargetFrame,
  } = await importTargetMarker();
  const enabled = {
    key: "url:preview",
    label: "Run preview",
    url: "http://127.0.0.1:3000/",
    load: "lazy",
    devTools: true,
    devToolsTargetId: "run-profile:abc123:preview",
  };
  const disabled = { ...enabled, devTools: false };
  const enabledMarker = devToolsTargetWindowName(enabled);

  assert.equal(shouldRecreateDevToolsTargetFrame("", true, enabled), true);
  assert.equal(
    shouldRecreateDevToolsTargetFrame(enabledMarker, true, enabled),
    false,
  );
  assert.equal(
    shouldRecreateDevToolsTargetFrame(enabledMarker, true, disabled),
    true,
  );
  assert.equal(shouldRecreateDevToolsTargetFrame("", false, enabled), false);
});

test("target marker and final URL are assigned before frame insertion", async () => {
  const { configureDevToolsTargetNavigation } = await importTargetMarker();
  const assignments = [];
  const iframe = {
    set name(value) {
      assignments.push(["name", value]);
    },
    set src(value) {
      assignments.push(["src", value]);
    },
    removeAttribute(name) {
      assignments.push(["removeAttribute", name]);
    },
  };
  const marker = configureDevToolsTargetNavigation(
    iframe,
    {
      key: "url:preview",
      label: "Run preview",
      url: "http://127.0.0.1:3000/",
      load: "lazy",
      devTools: true,
      devToolsTargetId: "run-profile:abc123:preview",
    },
    "http://127.0.0.1:3000/",
  );

  assert.deepEqual(assignments, [
    ["name", marker],
    ["src", "http://127.0.0.1:3000/"],
  ]);
});
