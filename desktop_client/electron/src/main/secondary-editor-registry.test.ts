import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { ElectronSecondEditorCommand } from "../shared/app-view-contracts";

test("working pane docks directly, detaches to one native view and returns to the primary renderer", async () => {
  const commands: ElectronSecondEditorCommand[] = [];
  const native: ElectronSecondEditorCommand[] = [];
  let views = 0;
  let disposed = 0;
  let detached: EventEmitter | undefined;
  class View {
    constructor() { views++; }
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, close: () => { disposed++; },
      setZoomFactor() {}, setWindowOpenHandler() {}, async loadURL() {},
      send(_channel: string, command: ElectronSecondEditorCommand) { native.push(command); },
    });
    setBounds() {} setBackgroundColor() {} setVisible() {}
  }
  const bounds = { x: 0, y: 0, width: 800, height: 600 };
  class Window extends EventEmitter {
    constructor() { super(); detached = this; }
    contentView = { addChildView() {}, removeChildView() {} };
    isDestroyed() { return false; } isMaximized() { return false; }
    setMenu() {} show() {} focus() {} close() {}
    getContentSize() { return [800, 600]; } getBounds() { return bounds; }
  }
  const module = { exports: {} };
  const output = buildSync({ entryPoints: ["src/main/secondary-editor-registry.ts"], bundle: true,
    platform: "node", format: "cjs", external: ["electron", "./desktop-state-store"], write: false });
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, URL, console, setImmediate,
    require(name: string) {
      if (name === "electron") return { BrowserWindow: Window, WebContentsView: View,
        screen: { getDisplayMatching: () => ({ workArea: bounds }) } };
      if (name === "node:path") return { resolve: () => "." };
      if (name === "./desktop-state-store") return {
        readSecondaryEditorPresentation: () => ({ mode: "closed", dockSize: 480, detachedBounds: bounds, maximized: false }),
        writeSecondaryEditorPresentation: (_origin: string, _project: string, presentation: unknown) => presentation,
        clampEditorWindowBounds: () => bounds,
      };
      throw new Error(name);
    },
  });
  const { SecondaryEditorRegistry } = module.exports as typeof import("./secondary-editor-registry");
  const main = new Window();
  const registry = new SecondaryEditorRegistry({
    getMainWindow: () => main as unknown as Electron.BrowserWindow,
    getAppPath: () => ".", getAppViewBounds: () => bounds, getAppZoomFactor: () => 1,
    getConfiguredFrameworkOrigin: () => "http://localhost", getRelayOrigin: () => "http://localhost",
    getZoomFactor: () => 1, frameworkPartition: "test", registerContents() {}, unregisterContents() {},
    installContextMenu() {}, async installScrollbars() {}, async installAppChrome() {}, closeDialogs() {},
    publishPresentation: cmd => commands.push(cmd), layoutPrimary() {},
  });
  await registry.open("/project", "/project/file", undefined, true);
  assert.equal(views, 0);
  assert.equal(commands.some(command => command.type === "open"), false);
  assert.equal(registry.dockedReady(), true);
  assert.equal(commands.at(-1)?.type, "open");
  await registry.setMode("detached");
  assert.equal(views, 1);
  assert.equal(registry.dockedReady(), false);
  detached?.emit("close", { preventDefault() {} });
  assert.equal(native.at(-1)?.type, "close");
  await registry.setMode("docked");
  assert.equal(disposed, 1);
  assert.equal(views, 1);
  assert.equal(registry.dockedReady(), true);
  await registry.setHistoricalDock(true);
  assert.equal(views, 2);
  await registry.setHistoricalDock(false);
  assert.equal(disposed, 2);
});
