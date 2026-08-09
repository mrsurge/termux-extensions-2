import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

async function loadModalKit() {
  const result = await build({
    entryPoints: [resolve(
      import.meta.dirname,
      "../main_page/frontend/ui/modal-kit/modal-frame.tsx",
    )],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "transform",
    jsxFactory: "jsx",
    jsxFragment: "Fragment",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function loadCm6FieldModule() {
  const result = await build({
    entryPoints: [resolve(
      import.meta.dirname,
      "../main_page/frontend/ui/cm6-json-textmate-field.ts",
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

test("JSX modal frame renders in the supplied document and preserves events", async () => {
  const { createModalFrame } = await loadModalKit();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  let closes = 0;
  const frame = createModalFrame(window.document, {
    id: "test-modal",
    surfaceId: "test.modal",
    title: "Test settings",
    width: "42rem",
    maxHeight: "80vh",
    onClose: () => { closes += 1; },
  });
  window.document.body.appendChild(frame.root);

  assert.equal(frame.root.ownerDocument, window.document);
  assert.equal(frame.root.id, "test-modal");
  assert.equal(frame.root.dataset.teDialogSurface, "test.modal");
  assert.equal(frame.root.getAttribute("aria-hidden"), "true");
  assert.equal(frame.root.querySelector("strong")?.textContent, "Test settings");
  assert.equal(frame.root.querySelector(".fe-modal-card")?.style.width, "42rem");
  assert.equal(frame.body.className, "fe-modal-body declarative-modal-body");
  assert.equal(frame.footer.className, "declarative-modal-footer");

  frame.root.querySelector('button[aria-label="Close"]')?.click();
  assert.equal(closes, 1);
  frame.root.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(closes, 2);
  frame.dispose();
  frame.root.querySelector('button[aria-label="Close"]')?.click();
  assert.equal(closes, 2);
  window.close();
});

test("CM6 modal fields retarget their root and token styles after adoption", async () => {
  const { syncJsonTextmateEditorRoot } = await loadCm6FieldModule();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  let receivedRoot = null;

  syncJsonTextmateEditorRoot({
    setRoot(root) { receivedRoot = root; },
  }, host, ".cm6-json-textmate .token { color: red; }");

  assert.equal(receivedRoot, window.document);
  assert.match(
    window.document.getElementById("cm6-json-textmate-token-styles")?.textContent || "",
    /color: red/,
  );
  window.close();
});
