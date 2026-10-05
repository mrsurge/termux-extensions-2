import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sendExt, sendExtPending, sendExtMixed, sendExtAwaitTerminalReply, disconnectSession }
  from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/transport-session.mjs';
import { WorkbenchClient }
  from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs';

test('all ordinary extension sends are rejected before initialization without allocating requests', () => {
  let initialized = false;
  const sent = [], allocated = [];
  const runtime = {
    refs: { extProtocol: { send: p => sent.push(p) } },
    isHandshakeInitialized: () => initialized,
    requestOwner: {
      allocReqId: () => { allocated.push(1); return allocated.length; },
      trackSent() {}, createPromise: () => Promise.resolve(null),
    },
    encodeJsonRequest: () => new Uint8Array([1]),
    encodeMixedRequest: () => new Uint8Array([2]),
    wrapPayload: p => p, onEvent() {}, nowMs: Date.now,
  };
  const calls = [sendExt, sendExtPending, sendExtMixed, sendExtAwaitTerminalReply];
  for (const send of calls) {
    assert.throws(() => send(runtime, 1, '$probe', []), /extension host is initializing/);
  }
  assert.deepEqual(sent, []);
  assert.deepEqual(allocated, []);
  initialized = true;
  for (const send of calls) send(runtime, 1, '$probe', []);
  assert.equal(sent.length, 4);
  assert.equal(allocated.length, 4);
});

test('WorkbenchClient wires the live handshake fence but teardown can dispose an uninitialized protocol', async () => {
  const base = process.env.TMPDIR || path.resolve('.codex-scratch');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'te2-handshake-fence-'));
  const client = new WorkbenchClient({ extensionStoragePath: path.join(root, 'storage'),
    webviewReconstructionStoragePath: path.join(root, 'webviews') });
  const sent = [];
  let disposed = 0;
  client.ext = { protocol: { send: p => sent.push(p), dispose: () => disposed++ } };
  try {
    assert.throws(() => client._sendExt(1, '$probe', []), /initializing/);
    client._extensionHostRuntime().sendExtInitText('{"extensions":[]}');
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(sent[0].toString()), { extensions: [] });
    client._extHandshake.initialized = true;
    client._sendExt(1, '$probe', []);
    assert.equal(sent.length, 2);
    client._extHandshake.initialized = false;
    disconnectSession(client._transportRuntime());
    assert.equal(disposed, 1);
    assert.equal(client.ext, null);
  } finally {
    client.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  }
});
