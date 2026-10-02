import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

const appRoot = path.resolve(import.meta.dirname, "..");

for (const destination of ['sidebar', 'drawer', null]) {
  test(`Open in Terminal uses chosen destination (${destination}) without navigation`, async () => {
    const dom = new Window({ url: 'http://127.0.0.1/apps/by-id/code_te2' });
    Object.assign(globalThis, { window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement });
    const menu = document.createElement('div'); menu.className = 'fe-card-menu'; document.body.append(menu);
    const anchor = document.createElement('button'); document.body.append(anchor);
    const calls = [];
    dom.teUI = { dialog: { open: async (request) => {
      assert.equal(request.title, 'Open in Terminal');
      return { status: destination ? 'accepted' : 'cancelled', action: destination };
    } } };
    const { createExplorerTreeMenuController } = await importController();
    const controller = createExplorerTreeMenuController({
      getTreeElement: () => null, getSelectedEntries: () => new Set(), getProjectPath: () => '/project',
      supportsSecondEditor: () => false, hasExplorerRpc: () => true, notifyExplorer() {},
      requestExplorer: async (method, payload) => { calls.push({ method, payload }); return { ok: true }; },
      buildSidebarMentionPayload: (payload) => payload, toast(message) { assert.fail(message); },
      isInSelectMode: () => false, enableSelectMode() {}, disableSelectMode() {},
      openFileAndMaybeJump: async () => {}, isCancelledError: () => false,
      getErrorMessage: (_error, fallback) => fallback,
    });
    controller.openCardMenuForEntry({ rel: 'nested', name: 'nested', kind: 'dir' }, anchor);
    const items = [...document.querySelectorAll('.fe-card-menu > .fe-dd-item')];
    const index = items.findIndex((item) => item.textContent === 'Open in Terminal');
    assert.equal(items[index - 1].textContent, 'Open in File Explorer');
    items[index].dispatchEvent(new dom.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const launches = calls.filter((call) => call.method === 'explorer.directory.openInTerminal');
    assert.deepEqual(launches, destination ? [{ method: 'explorer.directory.openInTerminal', payload: { rel: 'nested', destination } }] : []);
    assert.equal(window.location.pathname, '/apps/by-id/code_te2');
    window.happyDOM.abort();
  });
}

async function importController() {
  const result = await build({
    entryPoints: [path.join(appRoot, "src/explorer/tree/menu-controller.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("Open in File Explorer stays on Code TE2 and uses only Explorer RPC", async () => {
  const dom = new Window({ url: "http://127.0.0.1/apps/by-id/code_te2" });
  Object.assign(globalThis, { window: dom, document: dom.document, Element: dom.Element, HTMLElement: dom.HTMLElement });
  const menu = document.createElement("div"); menu.className = "fe-card-menu"; document.body.append(menu);
  const anchor = document.createElement("button"); document.body.append(anchor);
  const before = window.location.href;
  const calls = [];
  const { createExplorerTreeMenuController } = await importController();
  const controller = createExplorerTreeMenuController({
    getTreeElement: () => null, getSelectedEntries: () => new Set(), getProjectPath: () => "/project",
    supportsSecondEditor: () => false, hasExplorerRpc: () => true, notifyExplorer() {},
    requestExplorer: async (method, payload) => { calls.push({ method, payload }); return { ok: true }; },
    buildSidebarMentionPayload: (payload) => payload, toast(message) { assert.fail(message); },
    isInSelectMode: () => false, enableSelectMode() {}, disableSelectMode() {},
    openFileAndMaybeJump: async () => {}, isCancelledError: () => false,
    getErrorMessage: (_error, fallback) => fallback,
  });
  controller.openCardMenuForEntry({ rel: "nested", name: "nested", kind: "dir" }, anchor);
  const item = [...document.querySelectorAll(".fe-card-menu > .fe-dd-item")].find((element) => element.textContent === "Open in File Explorer");
  assert.ok(item);
  item.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls.find((call) => call.method === "explorer.directory.openInFileExplorer"), {
    method: "explorer.directory.openInFileExplorer", payload: { rel: "nested" },
  });
  assert.equal(window.location.href, before);
  window.happyDOM.abort();
});

test("Explorer resolves and executes contributed context commands through its RPC lane", async () => {
  const dom = new Window({ url: "http://127.0.0.1/apps/by-id/code_te2" });
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
  });
  const menu = document.createElement("div");
  menu.className = "fe-card-menu";
  document.body.appendChild(menu);
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const calls = [];
  const { createExplorerTreeMenuController } = await importController();
  const controller = createExplorerTreeMenuController({
    getTreeElement: () => null,
    getSelectedEntries: () => new Set(["src"]),
    getProjectPath: () => "/workspace",
    supportsSecondEditor: () => false,
    hasExplorerRpc: () => true,
    notifyExplorer() {},
    requestExplorer: async (method, payload) => {
      calls.push({ method, payload });
      return method === "explorer.extensions.menu.resolve"
        ? {
            actions: [{
              command: "sample.inspect",
              title: "Inspect Folder",
              category: "Sample",
              enabled: true,
              alternate: null,
            }],
          }
        : { ok: true };
    },
    buildSidebarMentionPayload: (payload) => payload,
    toast() {},
    isInSelectMode: () => false,
    enableSelectMode() {},
    disableSelectMode() {},
    openFileAndMaybeJump: async () => {},
    isCancelledError: () => false,
    getErrorMessage: (_error, fallback) => fallback,
  });

  controller.openCardMenuForEntry(
    { rel: "src", name: "src", kind: "dir" },
    anchor,
  );
  await Promise.resolve();
  await Promise.resolve();
  const extensionAction = document.querySelector(
    ".fe-extension-context-submenu .fe-dd-item",
  );
  assert.ok(extensionAction);
  extensionAction.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [
    {
      method: "explorer.extensions.menu.resolve",
      payload: { rel: "src" },
    },
    {
      method: "explorer.extensions.command.execute",
      payload: {
        rel: "src",
        selected_rels: ["src"],
        command: "sample.inspect",
      },
    },
  ]);
});

test("Explorer routes file cards to the source client's second editor", async () => {
  const dom = new Window({ url: "http://127.0.0.1/apps/by-id/code_te2" });
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
  });
  const menu = document.createElement("div");
  menu.className = "fe-card-menu";
  document.body.appendChild(menu);
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const calls = [];
  const { createExplorerTreeMenuController } = await importController();
  const controller = createExplorerTreeMenuController({
    getTreeElement: () => null,
    getSelectedEntries: () => new Set(),
    getProjectPath: () => "/workspace",
    supportsSecondEditor: () => true,
    hasExplorerRpc: () => true,
    notifyExplorer() {},
    requestExplorer: async (method, payload) => {
      calls.push({ method, payload });
      return { ok: true };
    },
    buildSidebarMentionPayload: (payload) => payload,
    toast() {},
    isInSelectMode: () => false,
    enableSelectMode() {},
    disableSelectMode() {},
    openFileAndMaybeJump: async () => {},
    isCancelledError: () => false,
    getErrorMessage: (_error, fallback) => fallback,
  });

  controller.openCardMenuForEntry(
    { rel: "src/main.ts", name: "main.ts", kind: "file" },
    anchor,
  );
  const secondWindowItem = Array.from(
    document.querySelectorAll(".fe-card-menu > .fe-dd-item"),
  ).find((element) => element.textContent === "Open in a Second Window");
  assert.ok(secondWindowItem);
  secondWindowItem.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls.find((call) =>
    call.method === "explorer.editor.openSecondWindow"
  ), {
    method: "explorer.editor.openSecondWindow",
    payload: { rel: "src/main.ts" },
  });
});
