import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
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

test("Explorer overlay closes sit at the trailing edge without moving drawer close", async () => {
  const source = await readFile(path.join(appRoot, 'src/explorer/search/overlay-controller.ts'), 'utf8');
  assert.ok(source.indexOf('header.appendChild(modeContainer)') < source.indexOf('header.appendChild(closeBtn)'));
  const css = await readFile(path.join(appRoot, 'main_page/frontend/explorer.css'), 'utf8');
  for (const selector of ['fe-search-close', 'fe-marketplace-close']) {
    assert.match(css, new RegExp(`\\.${selector} \\{[^}]*flex-shrink: 0;[^}]*margin-left: auto;`));
  }
  assert.doesNotMatch(css, /#fe-drawer-close\s*\{[^}]*margin-left: auto/);
});

test("README rendering keeps unsafe markup inert and gives tables/code independent scroll surfaces", async () => {
  const window = new Window({ url: 'http://localhost/' }); const restore = installDomGlobals(window);
  try {
    const { renderExtensionReadme } = await importTypeScript('src/explorer/extensions/readme-renderer.ts');
    const container = window.document.createElement('div');
    renderExtensionReadme(container, '# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n![bad](data:text/html,bad)\n\n[good](https://example.com)\n\n```javascript\nconst value = 1;\n```\n\n| A | B |\n|---|---|\n| x | y |');
    assert.equal(container.querySelector('script'), null);
    assert.equal(container.querySelector('a[href^="javascript:"]'), null);
    assert.equal(container.querySelector('img[src^="data:"]'), null);
    assert.equal(container.querySelector('a[href="https://example.com/"]').getAttribute('rel'), 'noopener noreferrer');
    assert.ok(container.querySelector('.fe-readme-table-scroll > table'));
    assert.ok(container.querySelector('pre[tabindex="0"] > code .hljs-keyword'));
  } finally { restore(); window.close(); }
});

test("installed and marketplace sections are exclusive, installed loading uses the registry once", async () => {
  const window = new Window({ url: 'http://localhost/' }); const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript('src/explorer/extensions/marketplace-controller.ts');
    const button = window.document.createElement('button'), overlay = window.document.createElement('div');
    window.document.body.append(button, overlay); const calls = [];
    const controller = createExplorerMarketplaceController({ closeSearchOverlay() {}, confirm: async () => true,
      async requestExplorer(method) { calls.push(method); return { extensions: [
        { id: 'vendor.example', display_name: 'Example', version: '1.0.0', source: 'user', iconUrl: '/api/app/code_te2/extensions/icon?id=vendor.example&version=1.0.0' },
        { id: 'builtin.example', version: '1', source: 'builtin' }] }; } });
    controller.bindUi({button,overlay}); controller.openMarketplace();
    assert.equal(overlay.querySelector('.fe-marketplace-header').lastElementChild.className, 'fe-marketplace-close');
    assert.equal(overlay.querySelector('.fe-marketplace-note').textContent, 'UI extensions have limited support; your mileage may vary.');
    const toggle = overlay.querySelector('[data-section="installed"]'); toggle.click(); await tick();
    assert.equal(overlay.querySelector('[data-section="marketplace"]').getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(overlay.querySelectorAll('.fe-marketplace-section:not([hidden]) .fe-marketplace-result').length, 1);
    assert.deepEqual(calls, ['explorer.extensions.list']);
    const image = overlay.querySelector('.fe-marketplace-icon-image');
    assert.equal(image.getAttribute('src'), '/api/app/code_te2/extensions/icon?id=vendor.example&version=1.0.0');
    image.dispatchEvent(new window.Event('error'));
    assert.equal(overlay.querySelector('.fe-marketplace-result-glyph').textContent, '🧩');
    toggle.click(); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  } finally { restore(); window.close(); }
});

test("README is fetched only on expansion and discarded after changing selection", async () => {
  const window = new Window({ url: 'http://localhost/' }); const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript('src/explorer/extensions/marketplace-controller.ts');
    const button = window.document.createElement('button'), overlay = window.document.createElement('div');
    window.document.body.append(button, overlay); let release; let reads = 0;
    const extension = id => ({ id, namespace: 'vendor', name: id.split('.')[1], version: '1.0.0', installedVersion: '1.0.0' });
    const controller = createExplorerMarketplaceController({ closeSearchOverlay() {}, confirm: async () => true,
      async requestExplorer(method, payload) {
        if (method.endsWith('.search')) return { items: [extension('vendor.first'), extension('vendor.second')], total: 2 };
        if (payload.readme) { reads++; await new Promise(resolve => { release = resolve; }); return { extension: { ...extension(payload.ext_id), readme: '# Obsolete README' } }; }
        return { extension: extension(payload.ext_id) };
      } });
    controller.bindUi({button,overlay}); controller.openMarketplace();
    const input = overlay.querySelector('input'); input.value = 'vendor'; input.dispatchEvent(new window.Event('input', {bubbles:true}));
    await tick(400); overlay.querySelector('.fe-marketplace-result').click(); await tick();
    assert.equal(reads, 0);
    const readme = overlay.querySelector('.fe-marketplace-readme'); readme.open = true;
    readme.dispatchEvent(new window.Event('toggle')); await tick(); assert.equal(reads, 1);
    findButton(overlay, '← Back').click(); overlay.querySelectorAll('.fe-marketplace-result')[1].click(); await tick();
    release(); await tick();
    assert.equal(overlay.querySelector('.fe-marketplace-detail-id').textContent, 'vendor.second');
    assert.equal(overlay.querySelector('.fe-marketplace-markdown').textContent.includes('Obsolete'), false);
  } finally { restore(); window.close(); }
});

test("marketplace settings gear targets the selected installed extension", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript("src/explorer/extensions/marketplace-controller.ts");
    const button = window.document.createElement("button"), overlay = window.document.createElement("div");
    window.document.body.append(button, overlay);
    const extension = { id: "vendor.example", namespace: "vendor", name: "example", displayName: "Example", version: "1.0.0", installedVersion: "1.0.0", installSupported: true };
    const configured = [], calls = [];
    const controller = createExplorerMarketplaceController({
      closeSearchOverlay() {}, confirm: async () => true,
      async requestExplorer(method) {
        calls.push(method);
        if (method.endsWith(".search")) return { items: [extension], total: 1, offset: 0 };
        if (method.endsWith(".detail")) return { extension };
        throw Error(method);
      },
      onConfigure(id, label) {
        assert.equal(overlay.style.display, "none");
        configured.push([id, label]);
      },
    });
    controller.bindUi({ button, overlay }); controller.openMarketplace();
    const input = overlay.querySelector(".fe-marketplace-search-input");
    input.value = "example"; input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(400); overlay.querySelector(".fe-marketplace-result").click(); await tick();
    const gear = overlay.querySelector('.fe-marketplace-settings');
    assert.equal(gear.textContent, '⚙');
    assert.equal(gear.getAttribute('aria-label'), 'Settings for Example');
    gear.click();
    assert.deepEqual(configured, [[extension.id, extension.displayName]]);
    assert.equal(calls.some(method => /install|restart/.test(method)), false);
  } finally { restore(); window.close(); }
});

test("shared settings loader preserves scoped values and fences obsolete opens", async () => {
  const { createSettingsManagerController } = await importTypeScript("main_page/frontend/ui/settings-manager.ts");
  let scope = 'user'; const opened = []; let release;
  const manager = createSettingsManagerController({
    getActiveScope: () => scope,
    openExtConfigModal: (...args) => opened.push(args),
    async busRequest(method, payload) {
      if (method.endsWith('configSchema.get')) {
        if (payload.ext_id === 'old') await new Promise(resolve => { release = resolve; });
        return { schema: { properties: { 'example.enabled': { type: 'boolean' } } } };
      }
      if (method.endsWith('workspaceSettings.get')) return { settings: { 'example.enabled': false, unrelated: true } };
      return { extensions: [{ id: 'new', configuration_values: { 'example.enabled': true } }] };
    },
  });
  const old = manager.openExtensionSettings('old', 'Old');
  await manager.openExtensionSettings('new', 'New'); release(); await old;
  assert.equal(opened.length, 1); assert.equal(opened[0][0], 'new');
  assert.deepEqual(opened[0][3], { 'example.enabled': true });
  scope = 'workspace'; await manager.openExtensionSettings('new', 'New');
  assert.deepEqual(opened[1][3], { 'example.enabled': false });
  const staleScope = manager.openExtensionSettings('old', 'Old');
  scope = 'user'; release(); await staleScope;
  assert.equal(opened.length, 2);
  const failed = createSettingsManagerController({
    getActiveScope: () => 'user', openExtConfigModal: () => assert.fail('must not open on read failure'),
    busRequest: async () => { throw Error('offline'); },
  });
  await assert.rejects(failed.openExtensionSettings('new', 'New'), /offline/);
});

test("marketplace install hands configuration to the host after closing its overlay", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDomGlobals(window);
  try {
    const { createExplorerMarketplaceController } = await importTypeScript(
      "src/explorer/extensions/marketplace-controller.ts",
    );
    const button = window.document.createElement("button");
    const overlay = window.document.createElement("div");
    window.document.body.append(button, overlay);
    const extension = { id: "vendor.example", namespace: "vendor", name: "example",
      displayName: "Example", version: "1.0.0", installSupported: true };
    const schema = { properties: { "example.enabled": { type: "boolean" } } };
    const configured = [];
    const controller = createExplorerMarketplaceController({
      closeSearchOverlay() {}, confirm: async () => true,
      async requestExplorer(method) {
        if (method.endsWith(".search")) return { items: [extension], total: 1, offset: 0 };
        if (method.endsWith(".detail")) return { extension };
        if (method.endsWith(".install")) return { ok: true, extension, config_schema: schema };
        throw Error(method);
      },
      onInstalled(installed, configuration) {
        assert.equal(overlay.style.display, "none");
        configured.push([installed, configuration]);
      },
    });
    controller.bindUi({ button, overlay });
    controller.openMarketplace();
    const input = overlay.querySelector(".fe-marketplace-search-input");
    input.value = "example";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(400);
    overlay.querySelector(".fe-marketplace-result").click();
    await tick();
    findButton(overlay, "Install").click();
    await tick();
    assert.deepEqual(configured, [[extension, schema]]);
  } finally {
    restore();
    window.close();
  }
});

test("marketplace overlay can reopen UI-only details and install without losing search state", async () => {
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
              extensionKind: ["ui"],
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
    assert.match(overlay.textContent, /UI extensions have limited support; your mileage may vary/);

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
    assert.match(overlay.textContent, /Extensions are installed into the Code TE2 extension host/);

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
