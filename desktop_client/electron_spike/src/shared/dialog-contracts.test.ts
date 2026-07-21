import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DIALOG_FIELDS,
  validateDialogRequest,
  validateDialogResult,
} from "./dialog-contracts.ts";

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    requestId: "te-dialog-test",
    kind: "prompt",
    title: "Rename",
    message: "Choose a name",
    detail: "",
    severity: "info",
    fields: [{
      key: "value",
      kind: "text",
      label: "Name",
      description: "",
      placeholder: "",
      required: true,
      rows: 4,
      value: "old",
      options: [],
    }],
    actions: [
      { id: "cancel", label: "Cancel", role: "cancel", primary: false, validate: false },
      { id: "accept", label: "Rename", role: "accept", primary: true, validate: true },
    ],
    initialFocus: "value",
    defaultAction: "accept",
    cancelAction: "cancel",
    width: "small",
    dismissible: true,
    ...overrides,
  };
}

test("validates and copies a normalized dialog request", () => {
  const raw = request();
  const validated = validateDialogRequest(raw);
  assert.notEqual(validated, raw);
  assert.equal(validated.fields[0]?.value, "old");
  assert.deepEqual(
    validateDialogResult(validated, {
      status: "accepted",
      action: "accept",
      values: { value: "new" },
    }),
    { status: "accepted", action: "accept", values: { value: "new" } },
  );
});

test("rejects executable or presentation escape hatches", () => {
  assert.throws(() => validateDialogRequest(request({ html: "<script>bad()</script>" })), /unsupported key: html/);
  assert.throws(() => validateDialogRequest(request({ url: "file:///etc/passwd" })), /unsupported key: url/);
  assert.throws(() => validateDialogRequest(request({ module: "node:fs" })), /unsupported key: module/);
});

test("rejects invalid actions, cycles, and oversized collections", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () => validateDialogRequest(request({
      fields: [{
        key: "value",
        kind: "text",
        label: "Name",
        description: "",
        placeholder: "",
        required: false,
        rows: 4,
        value: cyclic,
        options: [],
      }],
    })),
    /cycle/,
  );
  assert.throws(
    () => validateDialogRequest(request({ defaultAction: "missing" })),
    /Unknown default dialog action/,
  );
  assert.throws(
    () => validateDialogRequest(request({ fields: Array.from({ length: MAX_DIALOG_FIELDS + 1 }) })),
    /at most/,
  );
});

test("accepts only stable surface identifiers and portable state", () => {
  const validated = validateDialogRequest(request({
    kind: "surface",
    surface: { id: "code-te2.example", state: { selected: ["one"] } },
  }));
  assert.deepEqual(validated.surface, {
    id: "code-te2.example",
    state: { selected: ["one"] },
  });
  assert.throws(
    () => validateDialogRequest(request({ kind: "surface", surface: { id: "Bad ID" } })),
    /Invalid dialog surface id/,
  );
});
