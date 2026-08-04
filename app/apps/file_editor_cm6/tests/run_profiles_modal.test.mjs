import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

async function loadDeclarativeForm() {
  const result = await build({
    entryPoints: [resolve(
      import.meta.dirname,
      "../main_page/frontend/ui/declarative-modal.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("labeled port list edits and removes auxiliary service routes", async () => {
  const { createDeclarativeForm } = await loadDeclarativeForm();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  let current = {};
  const form = createDeclarativeForm(host, {
    fields: [{
      key: "additionalPorts",
      label: "Additional Service Ports",
      kind: "labeledPortList",
      placeholder: "5173",
      secondaryPlaceholder: "Vite / HMR",
      maxItems: 8,
    }],
  }, { additionalPorts: [] }, {
    onChange(values) { current = values; },
  });

  host.querySelector(".declarative-labeled-port-add")?.click();
  const inputs = host.querySelectorAll("input");
  assert.equal(inputs.length, 2);
  inputs[0].value = "5173";
  inputs[0].dispatchEvent(new window.Event("input", { bubbles: true }));
  inputs[1].value = "Vite / HMR";
  inputs[1].dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(current.additionalPorts, [{ port: 5173, label: "Vite / HMR" }]);

  host.querySelector(".declarative-labeled-port-remove")?.click();
  assert.deepEqual(current.additionalPorts, []);
  form.destroy();
  window.close();
});

test("runner visibility updates when Page Preview is selected", async () => {
  const { createDeclarativeForm } = await loadDeclarativeForm();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const form = createDeclarativeForm(host, {
    fields: [
      {
        key: "runner",
        label: "Runner",
        kind: "select",
        options: [
          { value: "custom", label: "Custom" },
          { value: "pagePreview", label: "Page Preview" },
        ],
      },
      {
        key: "exec",
        label: "Exec",
        kind: "text",
        visibleWhen: { field: "runner", notEquals: "pagePreview" },
      },
      {
        key: "entry",
        label: "Entry",
        kind: "text",
        visibleWhen: { field: "runner", equals: "pagePreview" },
      },
    ],
  }, { runner: "custom", exec: "node", entry: "index.html" });
  const rowsByLabel = new Map(
    [...host.querySelectorAll(".declarative-field-row")].map((row) => [
      row.querySelector(".declarative-field-label")?.textContent,
      row,
    ]),
  );
  assert.equal(rowsByLabel.get("Exec")?.style.display, "");
  assert.equal(rowsByLabel.get("Entry")?.style.display, "none");

  host.querySelector(".declarative-select-button")?.click();
  [...window.document.querySelectorAll(".declarative-select-option")]
    .find((option) => option.textContent === "Page Preview")
    ?.click();
  assert.equal(rowsByLabel.get("Exec")?.style.display, "none");
  assert.equal(rowsByLabel.get("Entry")?.style.display, "");

  form.destroy();
  window.close();
});

test("boolean controls use the left-aligned checkbox class", async () => {
  const { createDeclarativeForm } = await loadDeclarativeForm();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const form = createDeclarativeForm(host, {
    fields: [{
      key: "devRuntime",
      label: "Development runtime",
      kind: "checkbox",
    }],
  }, { devRuntime: true });

  const checkbox = host.querySelector('input[type="checkbox"]');
  assert.ok(checkbox?.classList.contains("declarative-checkbox"));
  assert.equal(checkbox?.checked, true);

  form.destroy();
  window.close();
});
