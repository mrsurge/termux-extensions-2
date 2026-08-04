import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session, WebFrameMain } from "electron";

import { ElectronRunProfileRuntime } from "./run-profile-runtime";

type RequestHeaders = Record<string, string>;
type ResponseHeaders = Record<string, string[]>;
type BeforeRequestListener = (
  details: { url: string; resourceType: string; requestHeaders: RequestHeaders },
  callback: (result: { requestHeaders?: RequestHeaders }) => void,
) => void;
type ResponseListener = (
  details: { url: string; resourceType: string; responseHeaders?: ResponseHeaders },
  callback: (result: { responseHeaders?: ResponseHeaders }) => void,
) => void;

function createSessionHarness(): {
  session: Session;
  before(): BeforeRequestListener;
  response(): ResponseListener;
} {
  let beforeListener: BeforeRequestListener | undefined;
  let responseListener: ResponseListener | undefined;
  const session = {
    webRequest: {
      onBeforeSendHeaders(listener: BeforeRequestListener) {
        beforeListener = listener;
      },
      onHeadersReceived(listener: ResponseListener) {
        responseListener = listener;
      },
    },
  } as unknown as Session;
  return {
    session,
    before() {
      assert.ok(beforeListener);
      return beforeListener;
    },
    response() {
      assert.ok(responseListener);
      return responseListener;
    },
  };
}

function runtimeMetadata() {
  return {
    surfaceId: "run-profile:abc123:preview",
    profileId: "preview",
    devRuntime: true,
    devTools: false,
    workerIdBase: "rp-prev",
    workerLabel: "run-profile:abc123:preview",
    frameworkOrigin: "http://framework.example:8089",
  };
}

test("dev runtime cache policy is exact-origin and released with its surface", () => {
  const harness = createSessionHarness();
  const runtime = new ElectronRunProfileRuntime(
    harness.session,
    () => "http://framework.example:8089",
  );
  runtime.registerDirect(runtimeMetadata(), "http://127.0.0.1:5173/app");

  let matchingHeaders: RequestHeaders | undefined;
  harness.before()({
    url: "http://127.0.0.1:5173/app.js",
    resourceType: "script",
    requestHeaders: { Accept: "*/*", "Cache-Control": "max-age=3600" },
  }, (result) => {
    matchingHeaders = result.requestHeaders;
  });
  assert.deepEqual(matchingHeaders, {
    Accept: "*/*",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  });

  let unrelatedHeaders: RequestHeaders | undefined;
  harness.before()({
    url: "http://127.0.0.1:5174/app.js",
    resourceType: "script",
    requestHeaders: { Accept: "*/*" },
  }, (result) => {
    unrelatedHeaders = result.requestHeaders;
  });
  assert.deepEqual(unrelatedHeaders, { Accept: "*/*" });

  let responseHeaders: ResponseHeaders | undefined;
  harness.response()({
    url: "http://127.0.0.1:5173/app.js",
    resourceType: "script",
    responseHeaders: { ETag: ["abc"] },
  }, (result) => {
    responseHeaders = result.responseHeaders;
  });
  assert.deepEqual(responseHeaders, {
    ETag: ["abc"],
    "Cache-Control": ["no-store, no-cache, must-revalidate"],
    Pragma: ["no-cache"],
    Expires: ["0"],
  });

  runtime.release(runtimeMetadata().surfaceId);
  let releasedHeaders: RequestHeaders | undefined;
  harness.before()({
    url: "http://127.0.0.1:5173/app.js",
    resourceType: "script",
    requestHeaders: { Accept: "*/*" },
  }, (result) => {
    releasedHeaders = result.requestHeaders;
  });
  assert.deepEqual(releasedHeaders, { Accept: "*/*" });
});

test("dev runtime injects the shared console bridge into its exact marked frame", async () => {
  const harness = createSessionHarness();
  const runtime = new ElectronRunProfileRuntime(
    harness.session,
    () => "http://framework.example:8089",
  );
  const metadata = runtimeMetadata();
  runtime.registerDirect(metadata, "http://127.0.0.1:5173/app");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return new Response(
      url.endsWith("socket.io.min.js")
        ? "globalThis.io = () => ({ on() {}, emit() {} });"
        : "export function initConsoleBridge(options) { return options; }",
      { status: 200 },
    );
  };
  try {
    const injected: string[] = [];
    const marker = `te2-run-profile:${encodeURIComponent(JSON.stringify({
      ...metadata,
      targetId: metadata.surfaceId,
      targetLabel: "Preview",
    }))}`;
    const frame = {
      name: marker,
      url: "http://127.0.0.1:5173/app",
      async executeJavaScript(source: string) {
        injected.push(source);
      },
    } as unknown as WebFrameMain;

    await runtime.injectFrame(frame);

    assert.equal(injected.length, 1);
    assert.match(injected[0], /initConsoleBridge/);
    assert.match(injected[0], /run-profile:abc123:preview/);
    assert.match(injected[0], /rp-prev-elct/);
    assert.match(injected[0], /workerOwnerLength[^\n]*4/);
    assert.match(injected[0], /http:\/\/framework\.example:8089/);
    assert.doesNotMatch(injected[0], /export function/);

    const unrelatedFrame = {
      name: marker,
      url: "http://127.0.0.1:5174/app",
      async executeJavaScript(source: string) {
        injected.push(source);
      },
    } as unknown as WebFrameMain;
    await runtime.injectFrame(unrelatedFrame);
    assert.equal(injected.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
