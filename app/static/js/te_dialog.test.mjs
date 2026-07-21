import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDialogService,
  createSettlement,
  normalizeDialogRequest,
  normalizeDialogResult,
} from "./te_dialog.mjs";

test("normalizes confirm defaults without raw HTML", () => {
  const request = normalizeDialogRequest({
    kind: "confirm",
    title: "Delete",
    message: "Continue?",
    confirmLabel: "Delete",
  });
  assert.equal(request.schemaVersion, 1);
  assert.equal(request.defaultAction, "accept");
  assert.equal(request.cancelAction, "cancel");
  assert.deepEqual(request.actions.map((action) => action.id), ["cancel", "accept"]);
  assert.equal(request.actions[1].label, "Delete");
  assert.throws(() => normalizeDialogRequest({ kind: "alert", html: "<b>unsafe</b>" }), /raw HTML/);
  assert.throws(() => normalizeDialogRequest({ schemaVersion: 2, kind: "alert" }), /schema version/);
  assert.throws(() => normalizeDialogRequest({ kind: "surface", title: "Missing ID" }), /surface.id/);
  assert.equal(normalizeDialogRequest({
    kind: "surface",
    title: "Portable",
    surface: { id: "code-te2.example" },
  }).surface.id, "code-te2.example");
});

test("normalizes prompt values and rejects unknown result actions", () => {
  const request = normalizeDialogRequest({ kind: "prompt", message: "Name", initialValue: "old" });
  assert.equal(request.fields[0].key, "value");
  assert.equal(request.fields[0].value, "old");
  assert.deepEqual(
    normalizeDialogResult(request, { status: "accepted", action: "accept", values: { value: "new" } }),
    { status: "accepted", action: "accept", values: { value: "new" } },
  );
  assert.throws(
    () => normalizeDialogResult(request, { status: "accepted", action: "missing" }),
    /Unknown dialog result action/,
  );
});

test("settles a dialog exactly once", () => {
  const values = [];
  const settlement = createSettlement((value) => values.push(value));
  assert.equal(settlement.settle("first"), true);
  assert.equal(settlement.settle("second"), false);
  assert.deepEqual(values, ["first"]);
});

test("external presenter failure falls back inline", async () => {
  const calls = [];
  const targetWindow = { console: { warn: () => calls.push("warn") } };
  const inlinePresenter = {
    open: async (request) => {
      calls.push(`inline:${request.kind}`);
      return { status: "accepted", action: "accept", values: { value: "inline" } };
    },
    closeAll: () => {},
  };
  const service = createDialogService(targetWindow, { inlinePresenter });
  service.registerPresenter({ open: async () => { throw new Error("offline"); } });
  assert.equal(await service.confirm("Continue?"), true);
  assert.deepEqual(calls, ["warn", "inline:confirm"]);
});

test("prompt wrapper preserves cancellation", async () => {
  const service = createDialogService({}, {
    inlinePresenter: {
      open: async () => ({ status: "cancelled", action: "cancel", values: { value: "ignored" } }),
      closeAll: () => {},
    },
  });
  assert.equal(await service.prompt("Name", "old"), null);
});
