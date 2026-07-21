import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import {
  createDialogService,
} from "../../../static/js/te_dialog.mjs";

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("inline dialogs stack, trap focus, settle, and restore focus", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const { document } = window;
  const opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.appendChild(opener);
  opener.focus();

  const service = createDialogService(window);
  const outerResult = service.confirm("Outer question");
  await nextTask();
  const innerResult = service.prompt("Inner value", "before");
  await nextTask();

  const layers = document.querySelectorAll(".te-dialog-layer");
  assert.equal(layers.length, 2);
  assert.equal(layers[0].getAttribute("aria-hidden"), "true");
  assert.equal(layers[0].inert, true);
  assert.equal(layers[1].getAttribute("aria-hidden"), "false");

  const input = layers[1].querySelector("input");
  input.value = "after";
  layers[1].querySelector('[data-primary="true"]').click();
  assert.equal(await innerResult, "after");
  await nextTask();
  assert.equal(layers[0].getAttribute("aria-hidden"), "false");

  const outerButtons = layers[0].querySelectorAll("button");
  const lastButton = outerButtons[outerButtons.length - 1];
  lastButton.focus();
  lastButton.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(document.activeElement, outerButtons[0]);

  layers[0].dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(await outerResult, false);
  await nextTask();
  assert.equal(document.activeElement, opener);
  assert.equal(document.querySelectorAll(".te-dialog-layer").length, 0);
  service.surfaceRegistry.destroy();
  window.close();
});

test("declared surfaces have stable stack, Escape close, and focus restoration", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const { document } = window;
  const opener = document.createElement("button");
  opener.textContent = "Open surface";
  const surface = document.createElement("div");
  surface.dataset.teDialogSurface = "test.settings";
  surface.setAttribute("aria-hidden", "true");
  surface.innerHTML = `
    <section role="dialog" aria-label="Settings">
      <button data-te-dialog-close>Close</button>
    </section>
  `;
  document.body.append(opener, surface);
  surface.querySelector("button").addEventListener("click", () => {
    surface.setAttribute("aria-hidden", "true");
  });
  opener.focus();

  const service = createDialogService(window);
  service.scanSurfaces(document);
  assert.equal(service.surfaceRegistry.size, 1);
  surface.setAttribute("aria-hidden", "false");
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.deepEqual(service.surfaceRegistry.openIds, ["test.settings"]);

  surface.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  }));
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(surface.getAttribute("aria-hidden"), "true");
  assert.deepEqual(service.surfaceRegistry.openIds, []);
  assert.equal(document.activeElement === opener, true);
  service.surfaceRegistry.destroy();
  window.close();
});

test("page navigation settles generated dialogs and restores focus", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const { document } = window;
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  const service = createDialogService(window);

  const result = service.confirm("Leave this page?");
  await nextTask();
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(await result, false);
  await window.happyDOM.waitUntilComplete();
  assert.equal(document.querySelectorAll(".te-dialog-layer").length, 0);
  assert.equal(document.activeElement === opener, true);
  service.surfaceRegistry.destroy();
  window.close();
});
