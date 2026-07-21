import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { test } from "node:test";

const APP_ROOT = resolve(import.meta.dirname, "../..");
const SOURCE_EXTENSIONS = new Set([".html", ".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([
  "build",
  "dist",
  "node_modules",
  "vendor",
  "vscode_oss_src",
  "workbench_protocol_proxy",
]);
const DIRECT_DIALOG_CALL = /(?<![.\w])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)\s*\(/g;
const TYPE_DECLARATION = /^\s*(alert|confirm|prompt)\s*\([^)]*\)\s*:\s*/;

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        found.push(...await sourceFiles(resolve(directory, entry.name)));
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.name.startsWith("te_dialog")) continue;
    found.push(resolve(directory, entry.name));
  }
  return found;
}

test("built-in frontend source has no blocking browser dialog calls", async () => {
  const violations = [];
  for (const file of await sourceFiles(APP_ROOT)) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      DIRECT_DIALOG_CALL.lastIndex = 0;
      if (!DIRECT_DIALOG_CALL.test(line) || TYPE_DECLARATION.test(line)) return;
      violations.push(`${relative(APP_ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations, [], `Blocking dialog calls found:\n${violations.join("\n")}`);
});

test("every active modal family has a stable surface id", async () => {
  const expectedSurfaceIds = [
    "framework.recents",
    "framework.file-picker",
    "code-te2.export-diagnostics",
    "code-te2.autosave-enable",
    "code-te2.watcher-limit",
    "code-te2.projects-debug",
    "code-te2.run-profiles",
    "code-te2.new-project",
    "code-te2.editor-settings",
    "code-te2.agent-shortcuts",
    "code-te2.themes",
    "code-te2.extension-manager",
    "code-te2.extension-config",
    "file-editor.unsaved",
    "file-explorer.properties",
    "file-explorer.bookmarks",
    "file-explorer.bookmark-form",
    "archive-manager.bookmarks",
    "archive-manager.bookmark-form",
    "aria-downloader.new-task",
  ];
  const corpus = (await Promise.all(
    (await sourceFiles(APP_ROOT)).map((file) => readFile(file, "utf8")),
  )).join("\n");
  const missing = expectedSurfaceIds.filter((surfaceId) => !corpus.includes(surfaceId));
  assert.deepEqual(missing, []);
  assert.equal(corpus.includes("code-te2.android-config"), false);
  assert.equal(corpus.includes("code-te2.crash"), false);
});
