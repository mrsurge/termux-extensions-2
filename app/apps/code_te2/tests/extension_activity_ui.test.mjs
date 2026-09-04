import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the extension drawer and status projection in the host source graph", async () => {
  const [
    template,
    controller,
    bridge,
    editorHandlers,
    sidebarShortcuts,
    hostBundle,
  ] =
    await Promise.all([
      readFile("template.html", "utf8"),
      readFile("main_page/frontend/ui/extension-activity.ts", "utf8"),
      readFile(
        "main_page/frontend/connections/extension-activity-bridge.ts",
        "utf8",
      ),
      readFile("monaco_editor/editor_wba_runtime_handlers.ts", "utf8"),
      readFile("main_page/frontend/sidebar-shortcuts/runtime.ts", "utf8"),
      readFile("static/dist/host.js", "utf8"),
    ]);

  for (const requiredId of [
    "extension-statusbar",
    "extension-status-health",
    "extension-log-extension-filter",
    "extension-log-channel-filter",
    "extension-log-output",
  ]) {
    assert.match(template, new RegExp(`id="${requiredId}"`));
    assert.match(hostBundle, new RegExp(requiredId));
  }
  assert.match(
    template,
    /grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto auto/,
  );
  assert.match(
    template,
    /\.layout-mobile:has\(\.terminal-drawer\.fullscreen\)\s*\{\s*grid-template-rows:\s*auto auto 0 minmax\(0, 1fr\) auto auto;/,
  );
  assert.match(
    template,
    /\.layout-mobile \.terminal-drawer\.fullscreen\s*\{\s*height:\s*auto !important;\s*min-height:\s*0;/,
  );
  assert.doesNotMatch(
    template,
    /<select[^>]+id="extension-log-(?:extension|channel)-filter"/,
  );
  assert.match(
    template,
    /id="extension-log-extension-menu"[^>]+role="listbox"/,
  );
  assert.match(
    template,
    /id="extension-log-channel-menu"[^>]+role="listbox"/,
  );
  assert.match(controller, /MAX_RENDERED_LOG_CHARS\s*=\s*512 \* 1024/);
  assert.match(controller, /event\.key === "ArrowDown"/);
  assert.match(controller, /event\.key === "Escape"/);
  assert.match(
    sidebarShortcuts,
    /versionChanged\s*&&\s*!_isExtensionWebviewEntry\(sc\)/,
    "WBA HTML revisions must not reload the trusted Sidebar wrapper",
  );
  assert.match(controller, /extensions\.activity\.snapshot/);
  assert.match(controller, /extensions\.logs\.select/);
  assert.match(bridge, /code-te2:extension-activity/);
  assert.match(editorHandlers, /type\.startsWith\("extension\/"\)/);
});
