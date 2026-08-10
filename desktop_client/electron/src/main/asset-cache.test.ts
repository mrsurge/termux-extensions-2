import assert from "node:assert/strict";
import { test } from "node:test";

import { clearFrameworkAssetCaches } from "./asset-cache";

test("framework asset activation clears HTTP and generated code caches", async () => {
  const calls: Array<{ method: string; options?: unknown }> = [];
  await clearFrameworkAssetCaches({
    async clearCache() {
      calls.push({ method: "clearCache" });
    },
    async clearCodeCaches(options) {
      calls.push({ method: "clearCodeCaches", options });
    },
  });

  assert.deepEqual(calls, [
    { method: "clearCache" },
    { method: "clearCodeCaches", options: {} },
  ]);
});
