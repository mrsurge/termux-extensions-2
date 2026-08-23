import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { Window } from "happy-dom";

const templates = [
  ["app shell", new URL("../../../templates/app_shell.html", import.meta.url)],
  ["framework index", new URL("../../../templates/index.html", import.meta.url)],
];

function nativeBootstrapScript(source) {
  const marker = source.indexOf("window.teNativeServiceWorkerReady");
  assert.notEqual(marker, -1, "native Service Worker bootstrap must exist");
  const open = source.lastIndexOf("<script", marker);
  const body = source.indexOf(">", open) + 1;
  const close = source.indexOf("</script>", marker);
  assert.ok(open >= 0 && body > open && close > body);
  return source.slice(body, close);
}

function nativeWindow(renderer, script, hangingTe2Unregister) {
  const window = new Window({
    url: `http://127.0.0.1:8089/app/code_te2?gv_native=1&te2_renderer=${renderer}`,
  });
  const calls = { unregister: [], cacheDelete: [] };
  const never = new Promise(() => {});
  const te2Registration = {
    scope: `${window.location.origin}/`,
    installing: null,
    waiting: null,
    active: null,
    unregister() {
      calls.unregister.push("te2");
      return hangingTe2Unregister ? never : Promise.resolve(true);
    },
  };
  const appRegistration = {
    scope: `${window.location.origin}/embedded-app/`,
    installing: null,
    waiting: null,
    active: { scriptURL: `${window.location.origin}/embedded-app/sw.js` },
    unregister() {
      calls.unregister.push("app");
      return Promise.resolve(true);
    },
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: null,
      getRegistrations: async () => [te2Registration, appRegistration],
    },
  });
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: {
      keys: async () => ["te2-v0.2.333", "embedded-app-cache"],
      delete: async (name) => {
        calls.cacheDelete.push(name);
        return true;
      },
    },
  });
  window.eval(script);
  return { window, calls };
}

for (const [label, templateUrl] of templates) {
  test(`${label} does not let stalled Cefrium TE2 cleanup block boot`, async (t) => {
    const source = await fs.readFile(templateUrl, "utf8");
    const { window, calls } = nativeWindow(
      "cefrium",
      nativeBootstrapScript(source),
      true,
    );
    t.after(() => window.close());

    const ready = await Promise.race([
      window.teNativeServiceWorkerReady,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(ready, true);
    assert.deepEqual(calls.unregister, ["te2"]);
    assert.deepEqual(calls.cacheDelete, ["te2-v0.2.333"]);
    assert.equal(window.sessionStorage.getItem("te_android_renderer"), "cefrium");
  });

  test(`${label} keeps Gecko TE2 cleanup exact and awaited`, async (t) => {
    const source = await fs.readFile(templateUrl, "utf8");
    const { window, calls } = nativeWindow(
      "gecko",
      nativeBootstrapScript(source),
      false,
    );
    t.after(() => window.close());

    assert.equal(await window.teNativeServiceWorkerReady, true);
    assert.deepEqual(calls.unregister, ["te2"]);
    assert.deepEqual(calls.cacheDelete, ["te2-v0.2.333"]);
    assert.equal(window.sessionStorage.getItem("te_android_renderer"), "gecko");
  });
}
