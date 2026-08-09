import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { searchWorkspaceFiles } from "../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/file-search.mjs";

const scratchParent = process.env.TEMPDIR
  ? path.resolve(process.env.TEMPDIR)
  : path.resolve(".te2-test-tmp");

async function withWorkspace(run) {
  await fs.mkdir(scratchParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratchParent, "wba-file-search-"));
  try {
    await fs.mkdir(path.join(root, "static"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(path.join(root, "index.html"), '<div class="root"></div>');
    await fs.writeFile(path.join(root, "static", "index.html"), '<div class="nested"></div>');
    await fs.writeFile(path.join(root, "static", "index.tsx"), '<div className="tsx" />');
    await fs.writeFile(path.join(root, "static", "styles.css"), ".nested {}");
    await fs.writeFile(path.join(root, "node_modules", "ignored", "index.html"), "ignored");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    try {
      await fs.rmdir(scratchParent);
    } catch {
      // Another test process may still own this shared scratch parent.
    }
  }
}

function runtimeFor(root) {
  return {
    workspaceRoot: () => root,
    fsPathFromUri: (uri) => uri?.path ?? null,
    uriForPath: (filePath) => ({
      $mid: 1,
      scheme: "vscode-remote",
      authority: "remote",
      path: filePath,
      fsPath: filePath,
    }),
    log() {},
  };
}

test("workspace file search honors VS Code brace includes and explicit excludes", async () => {
  await withWorkspace(async (root) => {
    const results = await searchWorkspaceFiles(runtimeFor(root), null, {
      includePattern: "**/*.{html,js,jsx,ts,tsx,php}",
      excludePattern: [{ pattern: "**/{node_modules}/**" }],
      maxResults: 100,
    });
    assert.deepEqual(
      results.map((uri) => path.relative(root, uri.path)).sort(),
      ["index.html", "static/index.html", "static/index.tsx"],
    );
    assert.ok(results.every((uri) => uri.scheme === "vscode-remote"));
    assert.ok(results.every((uri) => uri.authority === "remote"));
  });
});

test("workspace file search uses a RelativePattern folder and enforces maxResults", async () => {
  await withWorkspace(async (root) => {
    const nested = path.join(root, "static");
    const results = await searchWorkspaceFiles(
      runtimeFor(root),
      { scheme: "vscode-remote", authority: "remote", path: nested },
      { includePattern: "**/*.{html,tsx}", maxResults: 1 },
    );
    assert.equal(results.length, 1);
    assert.ok(String(results[0].path).startsWith(`${nested}${path.sep}`));
  });
});
