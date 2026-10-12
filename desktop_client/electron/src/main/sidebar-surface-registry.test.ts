import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import type { WebContents } from "electron";
import type { ElectronSidebarSurfaceDescriptor } from "../shared/app-view-contracts";
import { ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION } from "../shared/app-view-contracts";
import type { DetachedSidebarSurfaceRegistryOptions } from "./sidebar-surface-registry";

class Contents extends EventEmitter {
  sent: unknown[] = [];
  reloads = 0;
  reloadIgnoringCache() { this.reloads++; }
  isDestroyed() { return false; }
  setWindowOpenHandler() {}
  async loadURL() {}
  async executeJavaScript() {}
  send(...args: unknown[]) { this.sent.push(args); }
}
class View {
  static all: View[] = [];
  constructor() { View.all.push(this); }
  webContents = new Contents();
  setBackgroundColor() {}
  setVisible() {}
  setBounds() {}
}
class Window extends EventEmitter {
  static all: Window[] = [];
  webContents = new Contents();
  contentView = { addChildView() {}, removeChildView() {} };
  minimized = false;
  destroyed = false;
  constructor() { super(); Window.all.push(this); }
  setMenu() {}
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  minimize() { this.minimized = true; }
  restore() { this.minimized = false; }
  show() {}
  focus() {}
  getContentSize() { return [980, 720]; }
  async loadURL() {}
}

test("detached minimize uses only the authenticated chrome owner and preserves restore", async () => {
  Window.all = [];
  View.all = [];
  const output = buildSync({ entryPoints: ["src/main/sidebar-surface-registry.ts"], bundle: true, platform: "node", format: "cjs", external: ["electron"], write: false });
  const module = { exports: {} };
  runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, console,
    require: (name: string) => {
      if (name === "electron") return { BrowserWindow: Window, WebContentsView: View };
      if (name === "node:path") return { resolve: (...parts: string[]) => parts.join("/") };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const { DetachedSidebarSurfaceRegistry } = module.exports as typeof import("./sidebar-surface-registry");
  const main = new Window();
  const app = new Contents();
  const registry = new DetachedSidebarSurfaceRegistry({
    getMainWindow: () => main,
    getAppContents: () => app,
    getAppPath: () => ".",
    shellUrl: "http://localhost/surface",
    frameworkPartition: "test",
    registerTrustedContents() {}, unregisterTrustedContents() {}, installContextMenu() {},
  } as unknown as DetachedSidebarSurfaceRegistryOptions);
  const descriptor: ElectronSidebarSurfaceDescriptor = {
    version: ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION, renderer: "url", hostId: "host", surfaceId: "one", presentationId: "p1",
    label: "One", url: "http://localhost/one", windowName: "", appId: "", projectPath: "",
    profileId: "", shellId: "", devRuntime: false, devTools: false, consoleWorkerId: "",
  };
  await registry.detach(descriptor, false);
  await registry.detach({ ...descriptor, surfaceId: "two", presentationId: "p2" }, false);
  registry.reloadAssets();
  assert.deepEqual(View.all.map(view => view.webContents.reloads), [1, 1]);
  const [, one, two] = Window.all;
  const sender = (value: Contents) => value as unknown as WebContents;
  assert.equal(registry.handleShellAction(sender(app), "minimize"), false);
  assert.equal(registry.handleShellAction(sender(new Contents()), "minimize"), false);
  assert.equal(registry.handleShellAction(sender(one.webContents), "minimize"), true);
  assert.equal(one.minimized, true);
  assert.equal(main.minimized, false);
  assert.equal(two.minimized, false);
  assert.equal(app.sent.length, 0, "minimize must not emit lifecycle actions");
  registry.focus("one", "p1");
  assert.equal(one.minimized, false);
  one.destroyed = true;
  assert.equal(registry.handleShellAction(sender(one.webContents), "minimize"), false);
});

test("detached chrome exposes the minimize action, not main window control", () => {
  const source = readFileSync("src/surface/index.tsx", "utf8");
  assert.match(source, /aria-label="Minimize detached window"/);
  assert.match(source, /act\("minimize"\)/);
  assert.doesNotMatch(source, /window_control/);
});
