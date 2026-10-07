import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../desktop_client/android_shell/electromux-platform.js', import.meta.url), 'utf8');
const {createRemoteElectromuxPlatform} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let event, reply, requests = 0, unsubscribed = false;
const platform = createRemoteElectromuxPlatform({
  gatewayRequest: () => {throw new Error('State must not use HTTP');},
  getBrowserOrigin: () => 'http://127.0.0.1:44100', navigate() {},
  on: (_, callback) => {event = callback; return () => {unsubscribed = true;};},
  nativeRequest: () => {requests++; return new Promise(resolve => {reply = resolve;});},
});
const snapshot = (revision, phase, session = 'actor-one') => ({supported: true,
  stateSessionId: session, stateRevision: revision, phase});
const seen = [];
platform.on('local-framework-state', state => seen.push(state));
const start = platform.request('start_local_framework');
event(snapshot(3, 'running'));
reply(snapshot(1, 'starting'));
assert.equal((await start).phase, 'running', 'late acknowledgement cannot roll back a newer event');
event(snapshot(2, 'starting'));
assert.deepEqual(seen.map(state => state.phase), ['running'], 'old queued events are also rejected');
const first = platform.reconcileLocalState(), second = platform.reconcileLocalState();
assert.equal(first, second);
assert.equal(requests, 2, 'reconciliation is single-flight');
reply(snapshot(4, 'running')); await first;
event(snapshot(1, 'idle', 'actor-two'));
assert.equal(seen.at(-1).phase, 'idle', 'a new actor session can reset its revision');
const pending = platform.reconcileLocalState();
platform.dispose(); reply(snapshot(2, 'running', 'actor-two')); await pending;
assert.equal(seen.at(-1).phase, 'idle', 'teardown fences pending replies');
await platform.reconcileLocalState();
assert.equal(requests, 3, 'disposed activation does not reconnect');
assert.equal(unsubscribed, true);
console.log('Local state ordering, activation coalescing and disposal passed');
