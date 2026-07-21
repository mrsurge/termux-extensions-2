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

test("desktop surface portal preserves live DOM and nests primitive dialogs", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const childWindow = new Window({ url: "http://127.0.0.1/app/test" });
  const runtimeStyle = childWindow.document.createElement("style");
  runtimeStyle.id = "runtime-style";
  runtimeStyle.textContent = ".runtime-preserved { color: blue; }";
  childWindow.document.head.appendChild(runtimeStyle);
  Object.defineProperty(window, "te2DesktopSurfaceWindows", {
    configurable: true,
    value: Object.freeze({ enabled: true }),
  });
  let openCall = null;
  window.open = (...args) => {
    openCall = args;
    return childWindow;
  };

  const { document } = window;
  const style = document.createElement("style");
  style.textContent = ".preserved { color: rgb(1, 2, 3); }";
  document.head.appendChild(style);
  const opener = document.createElement("button");
  const surface = document.createElement("div");
  surface.className = "fe-modal";
  surface.dataset.teDialogSurface = "test.settings";
  surface.setAttribute("aria-hidden", "true");
  surface.innerHTML = `
    <section role="dialog" aria-label="Settings">
      <button class="preserved" data-te-dialog-close>Close</button>
    </section>
  `;
  document.body.append(opener, surface);
  let clicks = 0;
  const close = surface.querySelector("button");
  close.addEventListener("click", () => {
    clicks += 1;
    surface.setAttribute("aria-hidden", "true");
  });
  opener.focus();

  const service = createDialogService(window);
  service.scanSurfaces(document);
  surface.setAttribute("aria-hidden", "false");
  await window.happyDOM.waitUntilComplete();
  await nextTask();

  assert.deepEqual(openCall, ["", "te2-modal-surface", "popup,width=1000,height=760"]);
  assert.equal(surface.ownerDocument, childWindow.document);
  assert.equal(childWindow.document.querySelector("[data-te-dialog-surface]"), surface);
  assert.match(childWindow.document.head.textContent, /\.preserved/);
  assert.equal(childWindow.document.getElementById("runtime-style"), runtimeStyle);

  close.click();
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(clicks, 1);
  assert.equal(surface.ownerDocument, document);
  assert.equal(surface.getAttribute("aria-hidden"), "true");

  const secondChild = new Window({ url: "http://127.0.0.1/app/test" });
  window.open = () => secondChild;
  surface.setAttribute("aria-hidden", "false");
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  const nested = service.confirm("Nested question");
  await nextTask();
  const nestedLayer = secondChild.document.querySelector(".te-dialog-layer");
  assert.ok(nestedLayer);
  nestedLayer.querySelector('[data-primary="true"]').click();
  assert.equal(await nested, true);

  secondChild.dispatchEvent(new secondChild.Event("beforeunload"));
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(surface.ownerDocument, document);
  assert.equal(surface.getAttribute("aria-hidden"), "true");
  assert.equal(clicks, 2);
  service.surfaceRegistry.destroy();
  window.close();
  childWindow.close();
  secondChild.close();
});

test("desktop surface portal cleans up a dynamically removed modal", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const childWindow = new Window({ url: "http://127.0.0.1/app/test" });
  Object.defineProperty(window, "te2DesktopSurfaceWindows", {
    configurable: true,
    value: Object.freeze({ enabled: true }),
  });
  window.open = () => childWindow;

  const surface = window.document.createElement("div");
  surface.dataset.teDialogSurface = "test.dynamic";
  surface.innerHTML = `
    <section role="dialog" aria-label="Dynamic modal">
      <button id="dynamic-cancel">Cancel</button>
    </section>
  `;
  surface.querySelector("button").addEventListener("click", () => surface.remove());
  window.document.body.appendChild(surface);

  const service = createDialogService(window);
  service.scanSurfaces(window.document);
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(surface.ownerDocument, childWindow.document);

  surface.querySelector("button").click();
  await childWindow.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(service.surfaceRegistry.get("test.dynamic"), null);
  assert.equal(
    [...window.document.body.childNodes].some((node) => node.nodeType === 8),
    false,
  );
  service.surfaceRegistry.destroy();
  window.close();
  childWindow.close();
});

test("desktop surface portal stacks nested stateful surfaces in one child", async () => {
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const childWindow = new Window({ url: "http://127.0.0.1/app/test" });
  Object.defineProperty(window, "te2DesktopSurfaceWindows", {
    configurable: true,
    value: Object.freeze({ enabled: true }),
  });
  let opens = 0;
  window.open = () => {
    opens += 1;
    return childWindow;
  };

  const makeSurface = (id) => {
    const surface = window.document.createElement("div");
    surface.dataset.teDialogSurface = id;
    surface.setAttribute("aria-hidden", "true");
    surface.innerHTML = `<section role="dialog"><button data-te-dialog-close>Close</button></section>`;
    surface.querySelector("button").addEventListener("click", () => {
      surface.setAttribute("aria-hidden", "true");
    });
    window.document.body.appendChild(surface);
    return surface;
  };
  const manager = makeSurface("test.manager");
  const config = makeSurface("test.config");
  const service = createDialogService(window);
  service.scanSurfaces(window.document);

  manager.setAttribute("aria-hidden", "false");
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  config.setAttribute("aria-hidden", "false");
  await window.happyDOM.waitUntilComplete();
  await nextTask();

  assert.equal(opens, 1);
  assert.equal(manager.ownerDocument, childWindow.document);
  assert.equal(config.ownerDocument, childWindow.document);
  assert.equal(childWindow.document.title, "test.config");
  assert.equal(manager.inert, true);
  assert.equal(config.inert, false);

  config.querySelector("button").click();
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(config.ownerDocument, window.document);
  assert.equal(manager.ownerDocument, childWindow.document);
  assert.equal(manager.inert, false);
  assert.equal(childWindow.document.title, "test.manager");

  manager.querySelector("button").click();
  await window.happyDOM.waitUntilComplete();
  await nextTask();
  assert.equal(manager.ownerDocument, window.document);
  service.surfaceRegistry.destroy();
  window.close();
  childWindow.close();
});
