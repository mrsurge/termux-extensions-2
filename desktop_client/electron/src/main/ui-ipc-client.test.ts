import assert from "node:assert/strict";
import { test } from "node:test";

import type { Socket } from "socket.io-client";

import { ElectronUiIpcClient } from "./ui-ipc-client";

class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  removeAllListenersCalls = 0;

  on(): this {
    return this;
  }

  connect(): this {
    this.connectCalls += 1;
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    return this;
  }

  removeAllListeners(): this {
    this.removeAllListenersCalls += 1;
    return this;
  }
}

test("app readiness replaces a disconnected UI IPC client instead of waiting for backoff", () => {
  const sockets: FakeSocket[] = [];
  const factory = (() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as Socket;
  }) as unknown as typeof import("socket.io-client").io;
  const client = new ElectronUiIpcClient("electron:test", () => {}, () => {}, factory);

  client.connect("http://framework.example:8089");
  assert.equal(sockets.length, 1);
  client.ensureConnected("http://framework.example:8089");

  assert.equal(sockets.length, 2);
  assert.equal(sockets[0]?.removeAllListenersCalls, 1);
  assert.equal(sockets[0]?.disconnectCalls, 1);

  sockets[1]!.connected = true;
  client.ensureConnected("http://framework.example:8089");
  assert.equal(sockets.length, 2);
});
