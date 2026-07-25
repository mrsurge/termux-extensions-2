import assert from "node:assert/strict";
import { test } from "node:test";

import {
  settleNativeRequest,
  unwrapNativeRequestResult,
} from "./native-request-contracts";

test("native request results preserve successful values", async () => {
  const result = await settleNativeRequest(async () => ({ online: true }));
  assert.deepEqual(result, { ok: true, value: { online: true } });
  assert.deepEqual(unwrapNativeRequestResult(result), { online: true });
});

test("native request failures cross IPC as short structured errors", async () => {
  const source = Object.assign(new Error("Framework unavailable (connection refused)"), {
    code: "FRAMEWORK_UNAVAILABLE",
  });
  const result = await settleNativeRequest(async () => {
    throw source;
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      message: "Framework unavailable (connection refused)",
      code: "FRAMEWORK_UNAVAILABLE",
    },
  });
  assert.throws(
    () => unwrapNativeRequestResult(result),
    (error: unknown) => error instanceof Error &&
      error.name === "DesktopNativeRequestError" &&
      (error as Error & { code?: string }).code === "FRAMEWORK_UNAVAILABLE" &&
      !error.message.includes("ipcMain"),
  );
});

test("native request result validation rejects malformed IPC values", () => {
  assert.throws(
    () => unwrapNativeRequestResult({ error: "no status" }),
    /invalid result/,
  );
});
