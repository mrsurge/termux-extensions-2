import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebContents } from "electron";
import { toggleDetachedDevTools } from "./devtools";

const key = 'Symbol.for("te2.mobile-inspector")';
let bundle: Promise<string> | undefined;
const injected = new WeakSet<WebContents>();

export async function toggleInspector(enabled: boolean, target: WebContents | null | undefined,
  mode: "eruda" | "chromium"): Promise<void> {
  if (!enabled || !target || target.isDestroyed()) {
    throw new Error(enabled ? "No live app or launcher to inspect." : "Enable the DevTools button in Settings first.");
  }
  if (mode === "chromium") {
    if (injected.delete(target)) await target.executeJavaScript(`window[${key}]?.destroy()`);
    toggleDetachedDevTools(true, target);
    return;
  }
  if (target.isDevToolsOpened()) target.closeDevTools();
  bundle ??= readFile(join(__dirname, "mobile-inspector.js"), "utf8").catch(error => {
    bundle = undefined;
    throw error;
  });
  const script = await bundle;
  await target.executeJavaScript(`(() => { if (window[${key}]) window[${key}].toggle(); else { ${script}\n } })()`);
  injected.add(target);
}
