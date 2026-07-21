import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { DesktopAssetManager } from "./assets";
import { startFrameworkRelay } from "./framework-relay";

function startUpstream(body: string): Promise<{ origin: string; stop(): Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server = http.createServer((request, response) => {
      response.end(`${request.url}:${body}`);
    });
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise((resolveStop) => server.close(() => resolveStop())),
      });
    });
  });
}

test("relay proxies HTTP and keeps its browser origin while retargeting", async () => {
  const first = await startUpstream("first");
  const second = await startUpstream("second");
  const assets = new DesktopAssetManager("/nonexistent/te2-electron-test-assets");
  const relay = await startFrameworkRelay(first.origin, assets);
  try {
    assert.equal(await fetch(`${relay.browserOrigin}/probe`).then((value) => value.text()), "/probe:first");
    const stableOrigin = relay.browserOrigin;
    relay.retarget(second.origin);
    assert.equal(relay.browserOrigin, stableOrigin);
    assert.equal(await fetch(`${relay.browserOrigin}/probe`).then((value) => value.text()), "/probe:second");
  } finally {
    await relay.stop();
    await Promise.all([first.stop(), second.stop()]);
  }
});
