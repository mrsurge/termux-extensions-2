import assert from "node:assert/strict";
import * as http from "node:http";
import { Duplex } from "node:stream";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { DesktopAssetManager } from "./assets";
import { bridgeRelaySockets, startFrameworkRelay } from "./framework-relay";

class ControlledDuplex extends Duplex {
  readonly writes: Buffer[] = [];

  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes.push(Buffer.from(chunk));
    callback();
  }

  send(chunk: string): void {
    this.push(Buffer.from(chunk));
  }
}

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

test("relay socket bridge owns errors and tears down both peers", async () => {
  const downstream = new ControlledDuplex();
  const upstream = new ControlledDuplex();
  bridgeRelaySockets(downstream, upstream);

  downstream.send("browser payload");
  upstream.send("framework payload");
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(Buffer.concat(upstream.writes).toString(), "browser payload");
  assert.equal(Buffer.concat(downstream.writes).toString(), "framework payload");

  assert.doesNotThrow(() => {
    upstream.emit("error", new Error("This socket has been ended by the other party"));
  });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(downstream.destroyed, true);
  assert.equal(upstream.destroyed, true);
});

test("relay socket bridge closes its peer on a remote FIN", async () => {
  const downstream = new ControlledDuplex();
  const upstream = new ControlledDuplex();
  bridgeRelaySockets(downstream, upstream);

  upstream.push(null);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(downstream.destroyed, true);
  assert.equal(upstream.destroyed, true);
});
