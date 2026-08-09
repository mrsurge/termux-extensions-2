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
});
