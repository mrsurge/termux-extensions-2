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
