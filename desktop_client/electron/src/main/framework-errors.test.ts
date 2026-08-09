import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRAMEWORK_REQUEST_TIMEOUT_MS,
  FRAMEWORK_UNAVAILABLE_CODE,
  frameworkConnectionError,
} from "./framework-errors";

function nestedFetchError(code: string): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("socket failure"), { code }),
  });
}

test("framework control requests use a bounded offline timeout", () => {
  assert.equal(FRAMEWORK_REQUEST_TIMEOUT_MS, 5_000);
});

test("connection refusal is reduced to a concise recoverable error", () => {
  const error = frameworkConnectionError(nestedFetchError("ECONNREFUSED"));
  assert.equal(error.message, "Framework unavailable (connection refused)");
  assert.equal(error.code, FRAMEWORK_UNAVAILABLE_CODE);
  assert.equal(error.message.includes("127.0.0.1"), false);
});

test("Undici connect timeout is reduced to a concise recoverable error", () => {
  const error = frameworkConnectionError(nestedFetchError("UND_ERR_CONNECT_TIMEOUT"));
  assert.equal(error.message, "Framework unavailable (connection timed out)");
  assert.equal(error.code, FRAMEWORK_UNAVAILABLE_CODE);
  assert.equal(error.message.includes("undici"), false);
});

test("socket reset is treated as an interruption instead of a fatal error", () => {
  const error = frameworkConnectionError(nestedFetchError("ECONNRESET"));
  assert.equal(error.message, "Framework connection was interrupted");
  assert.equal(error.code, FRAMEWORK_UNAVAILABLE_CODE);
});
