import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const codeTe2Root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("installed WBA provider registry resolves only its vendored matcher", async () => {
  const scratchRoot = process.env.TEMPDIR
    ? path.resolve(process.env.TEMPDIR)
    : codeTe2Root;
  await mkdir(scratchRoot, { recursive: true });
  const tempRoot = await mkdtemp(
    path.join(scratchRoot, ".wba-vendor-test-"),
  );
  const isolatedCodeTe2 = path.join(tempRoot, "app", "apps", "code_te2");
  const isolatedRegistry = path.join(
    isolatedCodeTe2,
    "workbench_protocol_proxy",
    "node_workbench_adapter",
    "dist",
    "extensions",
    "provider-registry.mjs",
  );

  try {
    await mkdir(path.dirname(isolatedRegistry), { recursive: true });
    await cp(
      path.join(
        codeTe2Root,
        "workbench_protocol_proxy",
        "node_workbench_adapter",
        "dist",
        "extensions",
        "provider-registry.mjs",
      ),
      isolatedRegistry,
    );
    await cp(
      path.join(codeTe2Root, "vendor", "picomatch"),
      path.join(isolatedCodeTe2, "vendor", "picomatch"),
      { recursive: true },
    );

    const generated = await readFile(isolatedRegistry, "utf8");
    assert.doesNotMatch(generated, /(?:from|require\()\s*["']picomatch["']/);

    const { ProviderRegistry } = await import(
      `${pathToFileURL(isolatedRegistry).href}?isolated=1`
    );
    const registry = new ProviderRegistry();
    registry.registerFromRequest("$registerHoverProvider", [
      71,
      [{ scheme: "vscode-remote", pattern: "**/*.{css,scss}" }],
    ]);

    assert.deepEqual(
      registry.findAllProviderHandlesForDocument("hover", {
        languageId: "css",
        scheme: "vscode-remote",
        authority: "remote",
        path: "/workspace/static/styles.css",
      }),
      [71],
    );
    assert.deepEqual(
      registry.findAllProviderHandlesForDocument("hover", {
        languageId: "javascript",
        scheme: "vscode-remote",
        authority: "remote",
        path: "/workspace/static/index.js",
      }),
      [],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
