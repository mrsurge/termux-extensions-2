import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, copyFile, chmod, writeFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';

async function harness(t, env = {}, isolateLauncherConfig = false) {
  const root = await mkdtemp(join(process.env.TMPDIR || join(process.cwd(), '.codex-scratch'), 'electromux-test-'));
  const command = join(root, 'te2');
  await copyFile('tests/fixtures/electromux_framework.cjs', command); await chmod(command, 0o700);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const config = join(root, 'config'); await mkdir(config);
  await writeFile(join(config, 'desktop-local-framework.json'), JSON.stringify({version: 1, command, port, env}));
  const frameworkConfigHome = isolateLauncherConfig ? join(root, 'framework-config') : config;
  const child = spawn(process.execPath, ['desktop_client/electromux/dist/local-framework-backend.mjs'], {
    env: {...process.env, TE2_CONFIG_HOME: frameworkConfigHome,
      ...(isolateLauncherConfig ? {TE2_ELECTROMUX_CONFIG_HOME: config} : {})}, stdio: ['pipe', 'pipe', 'pipe']});
  let buffer = Buffer.alloc(0), seq = 0, waiters = [], frames = [], stderr = '', events = [], eventWaiters = [];
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
      const size = buffer.readUInt32BE(0); assert.ok(size > 0 && size <= 65536);
      const frame = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
      if (frame.event === 'local-framework-state') {
        events.push(frame.data);
        for (const waiter of [...eventWaiters]) waiter(frame.data);
        continue;
      }
      const waiter = waiters.shift(); if (waiter) waiter(frame); else frames.push(frame);
    }
  });
  const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise(resolve => waiters.push(resolve));
  const ready = await next(); assert.deepEqual(ready, {version: 1, event: 'ready'});
  async function call(method, params) {
    const id = ++seq, body = Buffer.from(JSON.stringify({id, method, params}));
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length); child.stdin.write(Buffer.concat([header, body]));
    const reply = await next(); assert.equal(reply.id, id); return reply;
  }
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'close'); }
    await rm(root, {recursive: true, force: true});
  });
  function waitState(predicate) {
    const existing = events.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { eventWaiters = eventWaiters.filter(x => x !== receive); reject(new Error(`state event timeout: ${JSON.stringify(events.at(-1))}; ${stderr}`)); }, 12000);
      const receive = value => {
        if (!predicate(value)) return;
        clearTimeout(timer); eventWaiters = eventWaiters.filter(x => x !== receive); resolve(value);
      };
      eventWaiters.push(receive);
    });
  }
  return {child, call, port, waitState, frameworkConfigHome, logs: () => stderr};
}

test('normal launch waits beyond old FD3 deadline and starts only once', {timeout: 20000}, async t => {
  const h = await harness(t, {TEST_BUILD_DELAY: '5300'});
  const start = await h.call('start_local_framework'); assert.equal(start.result.operationPending, true);
  assert.equal((await h.call('start_local_framework')).result.operationPending, true);
  const state = await h.waitState(value => value.phase === 'running' && !value.operationPending);
  assert.equal(typeof state.stateSessionId, 'string');
  assert.ok(state.stateRevision > start.result.stateRevision);
  const current = (await h.call('get_local_framework_state')).result;
  assert.equal(current.stateSessionId, state.stateSessionId);
  assert.ok(current.stateRevision > state.stateRevision);
  assert.equal(state.phase, 'running'); assert.equal(state.operationError, null);
  assert.equal(state.ownership, 'electron'); // Existing DTO, not a claim this is Electron.
  const pid = state.processId;
  assert.equal((await h.call('start_local_framework')).result.processId, pid);
  assert.match(h.logs(), /ordinary stdout/);
  const exit = once(h.child, 'close'); assert.deepEqual((await h.call('shutdown')).result, {stopped: true});
  assert.equal((await exit)[0], 0);
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});

test('existing TE2 is external and consumer shutdown leaves it running', {timeout: 10000}, async t => {
  const h = await harness(t);
  const external = createServer((req, res) => res.end(JSON.stringify({status: 'ok', app: 'te2', port: h.port, instanceId: 'external'})));
  external.listen(h.port, '127.0.0.1'); await once(external, 'listening');
  t.after(() => new Promise(resolve => external.close(resolve)));
  assert.equal((await h.call('refresh_local_framework')).result.ownership, 'external');
  const exit = once(h.child, 'close'); await h.call('shutdown'); await exit;
  assert.equal((await fetch(`http://127.0.0.1:${h.port}/api/health`)).status, 200);
});

test('native endpoint observation is independent of explicit local selection', {timeout: 10000}, async t => {
  const h = await harness(t);
  const remote = await h.call('set_selected_framework', {origin: 'http://remote.test:8089'});
  assert.equal(remote.result.selectedOrigin, 'http://remote.test:8089');
  assert.equal(remote.result.selectionRevision, 0);
  assert.equal(remote.result.selected, false);
  for (const origin of ['file:///secret', 'http://user:pass@remote.test', 'http://remote.test/path', 'http://remote.test/?q=1'])
    assert.match((await h.call('set_selected_framework', {origin})).error, /Invalid selected framework/);
  const external = createServer((req, res) => res.end(JSON.stringify({status: 'ok', app: 'te2', port: h.port, instanceId: 'external'})));
  external.listen(h.port, '127.0.0.1'); await once(external, 'listening');
  t.after(() => new Promise(resolve => external.close(resolve)));
  assert.equal((await h.call('refresh_local_framework')).result.selectedOrigin, 'http://remote.test:8089');
  const local = (await h.call('use_local_framework')).result;
  assert.equal(local.selectionRevision, 1);
  assert.equal(local.selectedOrigin, `http://127.0.0.1:${h.port}`);
  assert.equal(local.ownership, 'external');
  const observed = (await h.call('set_selected_framework', {origin: 'http://other.test:9090'})).result;
  assert.equal(observed.selectionRevision, 1);
  assert.equal(observed.selected, false);
});

test('consumer launch configuration does not change framework child roots', {timeout: 10000}, async t => {
  const h = await harness(t, {}, true);
  assert.equal((await h.call('get_local_framework_config')).result.commandDetected, true);
  await h.call('start_local_framework');
  await h.waitState(value => value.phase === 'running' && !value.operationPending);
  assert.ok(h.logs().includes(`framework-config-home=${h.frameworkConfigHome}`));
});

test('bootstrap failure ends indefinite startup wait', {timeout: 15000}, async t => {
  const h = await harness(t, {TEST_BUILD_EXIT: '7'});
  await h.call('start_local_framework');
  const state = await h.waitState(value => value.phase === 'failed' && !value.operationPending);
  assert.equal(state.phase, 'failed'); assert.equal(state.processId, null);
  assert.match(state.operationError, /exited before|closed before hello/);
});

test('consumer signal during preparation reaps only its owned build child', {timeout: 10000}, async t => {
  const h = await harness(t, {TEST_BUILD_DELAY: '30000'});
  await h.call('start_local_framework');
  let pid;
  for (let i = 0; i < 30; i++) {
    pid = Number(/build-pid=(\d+)/.exec(h.logs())?.[1]);
    if (pid) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(pid);
  const exit = once(h.child, 'close'); h.child.kill('SIGTERM');
  assert.equal((await exit)[0], 0);
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});

test('Cancel SIGTERMs pending normal bootstrap without selecting local', {timeout: 10000}, async t => {
  const h = await harness(t, {TEST_BUILD_DELAY: '30000'});
  await h.call('start_local_framework');
  const pending = await h.waitState(value => value.cancellableStartup && value.startupOutput === 'bootstrap preparing');
  assert.equal(pending.phase, 'starting');
  const stopped = await h.call('stop_local_framework');
  assert.equal(stopped.result.phase, 'exited');
  assert.equal(stopped.result.operationPending, false);
  assert.equal(stopped.result.selectionRevision, 0);
  assert.throws(() => process.kill(pending.processId, 0), {code: 'ESRCH'});
});
