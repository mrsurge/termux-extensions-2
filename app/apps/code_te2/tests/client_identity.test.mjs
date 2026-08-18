import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importClientIdentity() {
  const result = await build({
    entryPoints: [path.join(appRoot, "main_page/frontend/client-identity.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("client identity is stable per browser profile and reset is explicit", async () => {
  const runtimeWindow = new Window({
    url: "http://127.0.0.1:8089/app/code_te2",
  });
  globalThis.window = runtimeWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    const first = await resolveCodeTe2ClientIdentity();
    const second = await resolveCodeTe2ClientIdentity();
    assert.equal(first.provider, "browser");
    assert.equal(second.clientInstanceId, first.clientInstanceId);
    assert.equal(second.windowId, first.windowId);
    assert.equal(
      first.consoleWorkerId,
      `main_page:${first.clientInstanceId}:${first.windowId}`,
    );

    const reset = await resolveCodeTe2ClientIdentity({ reset: true });
    assert.notEqual(reset.clientInstanceId, first.clientInstanceId);
    assert.equal(reset.windowId, first.windowId);
  } finally {
    delete globalThis.window;
    runtimeWindow.close();
  }
});

test("native identity providers override relay-origin browser storage", async () => {
  const electronWindow = new Window({
    url: "http://127.0.0.1:42000/app/code_te2?gv_native=1",
  });
  electronWindow.te2Electron = {
    readClientIdentity: async () => ({
      clientInstanceId: "client_electronidentity000001",
    }),
    resetClientIdentity: async () => ({
      clientInstanceId: "client_electronidentity000002",
    }),
  };
  globalThis.window = electronWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    const electron = await resolveCodeTe2ClientIdentity();
    assert.equal(electron.provider, "electron");
    assert.equal(electron.clientInstanceId, "client_electronidentity000001");
    const reset = await resolveCodeTe2ClientIdentity({ reset: true });
    assert.equal(reset.clientInstanceId, "client_electronidentity000002");
  } finally {
    delete globalThis.window;
    electronWindow.close();
  }

  const geckoWindow = new Window({
    url: "http://127.0.0.1:43000/app/code_te2?gv_native=1&te2_renderer=gecko",
  });
  geckoWindow.postMessage = (message) => {
    if (message?.channel !== "te2.clientIdentity.request") return;
    queueMicrotask(() => {
      geckoWindow.dispatchEvent(
        new geckoWindow.MessageEvent("message", {
          data: {
            channel: "te2.clientIdentity.response",
            requestId: message.requestId,
            result: { ok: true, clientInstanceId: "client_a1b2c3d4e5f6" },
          },
          origin: geckoWindow.location.origin,
          source: geckoWindow,
        }),
      );
    });
  };
  globalThis.window = geckoWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    const gecko = await resolveCodeTe2ClientIdentity();
    assert.equal(gecko.provider, "gecko");
    assert.equal(gecko.clientInstanceId, "client_a1b2c3d4e5f6");
  } finally {
    delete globalThis.window;
    geckoWindow.close();
  }

  const cefriumWindow = new Window({
    url: "http://127.0.0.1:44000/app/code_te2?gv_native=1&te2_renderer=cefrium",
  });
  cefriumWindow.cefriumQuery = ({ request, onSuccess }) => {
    const method = JSON.parse(request).method;
    onSuccess(JSON.stringify({
      ok: true,
      clientInstanceId: method.endsWith("reset")
        ? "client_112233445566"
        : "client_abcdef123456",
    }));
  };
  globalThis.window = cefriumWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    const cefrium = await resolveCodeTe2ClientIdentity();
    assert.equal(cefrium.provider, "cefrium");
    assert.equal(cefrium.clientInstanceId, "client_abcdef123456");
    const reset = await resolveCodeTe2ClientIdentity({ reset: true });
    assert.equal(reset.clientInstanceId, "client_112233445566");
  } finally {
    delete globalThis.window;
    cefriumWindow.close();
  }
});

test("legacy native pages without a renderer retain the Gecko installation identity", async () => {
  const runtimeWindow = new Window({
    url: "http://127.0.0.1:45000/app/code_te2?gv_native=1",
  });
  runtimeWindow.postMessage = (message) => {
    if (message?.channel !== "te2.clientIdentity.request") return;
    queueMicrotask(() => {
      runtimeWindow.dispatchEvent(
        new runtimeWindow.MessageEvent("message", {
          data: {
            channel: "te2.clientIdentity.response",
            requestId: message.requestId,
            result: { ok: true, clientInstanceId: "client_legacygecko12" },
          },
          origin: runtimeWindow.location.origin,
          source: runtimeWindow,
        }),
      );
    });
  };
  globalThis.window = runtimeWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    const identity = await resolveCodeTe2ClientIdentity();
    assert.equal(identity.provider, "gecko");
    assert.equal(identity.clientInstanceId, "client_legacygecko12");
  } finally {
    delete globalThis.window;
    runtimeWindow.close();
  }
});

test("native pages fail explicitly for an unknown renderer", async () => {
  const runtimeWindow = new Window({
    url: "http://127.0.0.1:45000/app/code_te2?gv_native=1&te2_renderer=unknown",
  });
  globalThis.window = runtimeWindow;
  try {
    const { resolveCodeTe2ClientIdentity } = await importClientIdentity();
    await assert.rejects(
      resolveCodeTe2ClientIdentity(),
      /renderer identity is missing or unsupported/,
    );
  } finally {
    delete globalThis.window;
    runtimeWindow.close();
  }
});
