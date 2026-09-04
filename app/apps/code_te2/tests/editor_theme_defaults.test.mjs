import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importThemeResolver() {
  const result = await build({
    entryPoints: [
      path.join(appRoot, "monaco_editor/editor_theme_resolver_utils.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
}

test("uses vanilla GitHub Dark for fresh and legacy dark theme keys", async () => {
  const { resolveMonacoThemeId } = await importThemeResolver();

  assert.equal(resolveMonacoThemeId("", {}), "github-dark");
  assert.equal(resolveMonacoThemeId("cm6-dark", {}), "github-dark");
  assert.equal(resolveMonacoThemeId("vs-dark", {}), "github-dark");
});

test("preserves an explicit registered GitHub Dark Default selection", async () => {
  const { resolveMonacoThemeId } = await importThemeResolver();

  assert.equal(
    resolveMonacoThemeId("github-dark-default", {
      "github-dark-default": { name: "GitHub Dark Default" },
    }),
    "github-dark-default",
  );
});
