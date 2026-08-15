import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("Electron app navigation delegates backend readiness to the shared app shell", async () => {
  const [mainSource, appShell] = await Promise.all([
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(
      resolve(process.cwd(), "../../app/templates/app_shell.html"),
      "utf8",
    ),
  ]);
  const navigateStart = mainSource.indexOf("async function navigateApp");
  const navigateEnd = mainSource.indexOf(
    "function connectElectronUiIpc",
    navigateStart,
  );
  const navigateSource = mainSource.slice(navigateStart, navigateEnd);
  assert.match(navigateSource, /loadURL\(target\.href\)/);
  assert.doesNotMatch(navigateSource, /waitUntilProjectionReady/);

  const lifecycle = appShell.indexOf(
    "const appDef = await waitForAppLifecycle()",
  );
  const nativePrerequisite = appShell.indexOf(
    "await waitForNativeAppPrerequisites(appId)",
  );
  const templateFetch = appShell.indexOf(
    "const template = await fetch",
    nativePrerequisite,
  );
  assert.ok(lifecycle >= 0 && lifecycle < nativePrerequisite);
  assert.ok(nativePrerequisite < templateFetch);
});
