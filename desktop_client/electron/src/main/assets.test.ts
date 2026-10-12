import assert from "node:assert/strict";
import { test } from "node:test";

import { compareAssetVersions, desktopAssetRoot, mapLocalAssetPath } from "./assets";

test("asset versions compare monotonically", () => {
  assert.equal(compareAssetVersions("0.2.320", "0.2.319"), 1);
  assert.equal(compareAssetVersions("0.2.320", "0.2.320"), 0);
  assert.equal(compareAssetVersions("0.2.9", "0.2.10"), -1);
});

test("desktop assets honor the explicit TE2 data root", () => {
  assert.equal(
    desktopAssetRoot({ HOME: "/home/test", TE2_DATA_HOME: "/custom/te2-data" }),
    "/custom/te2-data/desktop_assets",
  );
});

test("only inventory paths map into the installed tree", () => {
  assert.equal(
    mapLocalAssetPath("/apps/by-id/code_te2/template.html"),
    "/apps/code_te2/template.html",
  );
  assert.equal(mapLocalAssetPath("/api/apps/catalog"), null);
  assert.equal(mapLocalAssetPath("/apps/by-id/file_explorer/main.js"), "/apps/file_explorer/main.js");
  assert.equal(mapLocalAssetPath("/apps/by-id/terminal/static/dist/main.js"), "/apps/terminal/static/dist/main.js");
  assert.equal(mapLocalAssetPath("/apps/by-id/als-rs/template.html"), "/apps/als_rs/template.html");
  assert.equal(mapLocalAssetPath("/apps/by-id/terminal/vendor/android-terminalapp-assets-js/ctrl_key_handler.js"), "/apps/terminal/vendor/android-terminalapp-assets-js/ctrl_key_handler.js");
  assert.equal(mapLocalAssetPath("/apps/file_explorer/file_explorer.py"), null);
  assert.equal(mapLocalAssetPath("/apps/by-id/custom/main.js"), null);
});
