import assert from "node:assert/strict";
import { test } from "node:test";

import { compareAssetVersions, mapLocalAssetPath } from "./assets";

test("asset versions compare monotonically", () => {
  assert.equal(compareAssetVersions("0.2.320", "0.2.319"), 1);
  assert.equal(compareAssetVersions("0.2.320", "0.2.320"), 0);
  assert.equal(compareAssetVersions("0.2.9", "0.2.10"), -1);
});

test("only inventory paths map into the installed tree", () => {
  assert.equal(
    mapLocalAssetPath("/apps/by-id/file_editor_cm6/template.html"),
    "/apps/file_editor_cm6/template.html",
  );
  assert.equal(mapLocalAssetPath("/api/apps/catalog"), null);
});
