import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

const appRoot = path.resolve(import.meta.dirname, "..");

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
