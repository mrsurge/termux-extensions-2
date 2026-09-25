import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SOURCE_ROOTS = [
  "template.html",
  "main_page/frontend",
  "monaco_editor",
  "src/explorer",
];

const EXCLUDED_SEGMENTS = [
  `${path.sep}history${path.sep}vscode_scm${path.sep}tree${path.sep}upstream${path.sep}`,
];

const SOURCE_EXTENSIONS = new Set([".html", ".js", ".jsx", ".ts", ".tsx"]);
const NATIVE_SELECT_PATTERNS = [
  { label: "native <select> markup", pattern: /<\s*select\b/i },
  {
    label: "programmatic native select creation",
    pattern: /createElement\s*\(\s*["']select["']\s*\)/,
  },
  { label: "native select binding", pattern: /\bHTMLSelectElement\b/ },
];

async function collectSourceFiles(target) {
  const stats = await stat(target);
  if (stats.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(target, entry.name);
    if (EXCLUDED_SEGMENTS.some((segment) => resolved.includes(segment))) continue;
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(resolved)));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(resolved);
    }
  }
  return files;
}

test("authored Code TE2 UI does not introduce native browser dropdowns", async () => {
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((relativePath) =>
        collectSourceFiles(path.join(APP_ROOT, relativePath)),
      ),
    )
  ).flat();
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const { label, pattern } of NATIVE_SELECT_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(APP_ROOT, file)}: ${label}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Use an app-owned popup/listbox instead:\n${violations.join("\n")}`,
  );
});
