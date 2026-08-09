import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

const appRoot = path.resolve(import.meta.dirname, "..");
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url =
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}` +
    `#${moduleSequence++}`;
  return import(url);
}

function installDomGlobals(window) {
  const names = [
    "window",
    "document",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "Element",
    "Event",
    "KeyboardEvent",
    "CSS",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, globalThis[name]]),
  );
  for (const name of names) {
    globalThis[name] = name === "window" ? window : window[name];
  }
  return () => {
    for (const name of names) {
      globalThis[name] = previous[name];
    }
  };
}

function findButton(root, text) {
  return Array.from(root.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
}

function tick(delay = 0) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

test("marketplace overlay can reopen details and install without losing search state", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript(
      "src/explorer/extensions/marketplace-controller.ts",
    );
    const button = window.document.createElement("button");
    const overlay = window.document.createElement("div");
    window.document.body.append(button, overlay);

    const calls = [];
    let searchCloseReason = null;
    const controller = createExplorerMarketplaceController({
      closeSearchOverlay(reason) {
        searchCloseReason = reason;
      },
      confirm: async () => true,
      async requestExplorer(method, payload) {
        calls.push([method, payload]);
        if (method === "explorer.extensions.marketplace.search") {
          return {
            query: "python",
            offset: 0,
            total: 1,
            items: [
              {
                id: "vendor.python",
                namespace: "vendor",
                name: "python",
                displayName: "Python",
                version: "1.0.0",
                description: "Language support",
                iconUrl:
                  "https://open-vsx.org/api/vendor/python/1.0.0/file/icon.png",
                installedVersion: null,
                verified: true,
              },
            ],
          };
        }
        if (method === "explorer.extensions.marketplace.detail") {
          return {
            extension: {
              id: "vendor.python",
              namespace: "vendor",
              name: "python",
              displayName: "Python",
              version: "1.0.0",
              description: "Language support",
              iconUrl:
                "https://open-vsx.org/api/vendor/python/1.0.0/file/icon.png",
              installedVersion: null,
              verified: true,
              extensionKind: ["workspace"],
              engine: "^1.100.0",
              license: "MIT",
              repository: "https://example.com/repository",
              homepage: null,
              installSupported: true,
              unsupportedReason: null,
            },
          };
        }
        if (method === "explorer.extensions.marketplace.install") {
          return {
            ok: true,
            extension: { id: "vendor.python", version: "1.0.0" },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    });

    controller.bindUi({ button, overlay });
    controller.openMarketplace();
    assert.equal(searchCloseReason, "marketplaceOpened");
    assert.equal(overlay.style.display, "flex");
    assert.match(overlay.textContent, /UI extensions are not currently supported/);

    const input = overlay.querySelector(".fe-marketplace-search-input");
    input.value = "python";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(400);

    let result = overlay.querySelector(".fe-marketplace-result");
    assert.ok(result);
    assert.match(result.textContent, /vendor\.python/);
    const resultIcon = result.querySelector(".fe-marketplace-icon-image");
    assert.equal(
      resultIcon.src,
      "https://open-vsx.org/api/vendor/python/1.0.0/file/icon.png",
    );
    assert.equal(resultIcon.loading, "lazy");
    assert.equal(resultIcon.referrerPolicy, "no-referrer");
    resultIcon.dispatchEvent(new window.Event("error"));
    assert.equal(
      result.querySelector(".fe-marketplace-result-glyph").textContent,
      "🧩",
    );
    result.click();
    await tick();
    assert.ok(overlay.querySelector(".fe-marketplace-detail.is-open"));
    assert.ok(
      overlay.querySelector(
        ".fe-marketplace-detail-icon .fe-marketplace-icon-image",
      ),
    );
    assert.match(overlay.textContent, /Workspace extensions are installed/);

    findButton(overlay, "← Back").click();
    await tick();
    assert.equal(
      overlay.querySelector(".fe-marketplace-detail").classList.contains("is-open"),
      false,
    );

    result = overlay.querySelector(".fe-marketplace-result");
    result.click();
    await tick();
    findButton(overlay, "Install").click();
    await tick();
    assert.match(overlay.textContent, /Installed1\.0\.0|Installed\s*1\.0\.0/);
    assert.ok(
      calls.some(([method]) => method === "explorer.extensions.marketplace.install"),
    );

    controller.closeMarketplace();
    controller.openMarketplace();
    assert.equal(overlay.style.display, "flex");
    assert.equal(input.value, "python");
  } finally {
    restore();
    window.close();
  }
});

test("newer marketplace searches suppress stale responses", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript(
      "src/explorer/extensions/marketplace-controller.ts",
    );
    const button = window.document.createElement("button");
    const overlay = window.document.createElement("div");
    window.document.body.append(button, overlay);

    let resolveAlpha;
    const alphaResponse = new Promise((resolve) => {
      resolveAlpha = resolve;
    });
    const controller = createExplorerMarketplaceController({
      closeSearchOverlay() {},
      confirm: async () => false,
      async requestExplorer(method, payload) {
        assert.equal(method, "explorer.extensions.marketplace.search");
        if (payload.query === "alpha") return alphaResponse;
        return {
          query: "beta",
          offset: 0,
          total: 1,
          items: [
            {
              id: "vendor.beta",
              namespace: "vendor",
              name: "beta",
              displayName: "Beta",
              version: "2.0.0",
              description: "",
              installedVersion: null,
              verified: false,
            },
          ],
        };
      },
    });
    controller.bindUi({ button, overlay });
    controller.openMarketplace();

    const input = overlay.querySelector(".fe-marketplace-search-input");
    input.value = "alpha";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(370);
    input.value = "beta";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(370);
    assert.match(overlay.textContent, /vendor\.beta/);

    resolveAlpha({
      query: "alpha",
      offset: 0,
      total: 1,
      items: [
        {
          id: "vendor.alpha",
          namespace: "vendor",
          name: "alpha",
          displayName: "Alpha",
          version: "1.0.0",
          description: "",
          installedVersion: null,
          verified: false,
        },
      ],
    });
    await tick();
    assert.doesNotMatch(overlay.textContent, /vendor\.alpha/);
    assert.match(overlay.textContent, /vendor\.beta/);
  } finally {
    restore();
    window.close();
  }
});

test("branch label formatter covers repository lifecycle states", async () => {
  const { formatExplorerBranchLabel } = await importTypeScript(
    "src/explorer/chrome/explorer-chrome-controller.ts",
  );

  assert.deepEqual(formatExplorerBranchLabel(null), {
    text: "…",
    title: "Git status pending",
  });
  assert.deepEqual(
    formatExplorerBranchLabel({ isRepository: false, hasHead: false }),
    {
      text: "(no branch)",
      title: "Not a Git repository",
    },
  );
  assert.deepEqual(
    formatExplorerBranchLabel({ isRepository: true, hasHead: false }),
    {
      text: "(no commits)",
      title: "Git repository has no commits",
    },
  );
  assert.deepEqual(
    formatExplorerBranchLabel({
      isRepository: true,
      hasHead: true,
      detached: true,
      head: { full: "0123456789abcdef", short: "0123456" },
    }),
    {
      text: "HEAD @ 0123456",
      title: "0123456789abcdef",
    },
  );
  assert.deepEqual(
    formatExplorerBranchLabel({
      isRepository: true,
      hasHead: true,
      branch: "feature/open-vsx",
      head: { full: "fedcba9876543210", short: "fedcba9" },
    }),
    {
      text: "feature/open-vsx @ fedcba9",
      title: "feature/open-vsx @ fedcba9876543210",
    },
  );
});
