import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, mkdir, copyFile, chmod, writeFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';

test('consumer import does not register process hooks or start stdin', async () => {
  const before = {term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT'),
    data: process.stdin.listenerCount('data')};
  const module = await import('../desktop_client/electromux/dist/local-framework-consumer.mjs');
  assert.equal(typeof module.createLocalFrameworkConsumer, 'function');
  assert.deepEqual({term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT'),
    data: process.stdin.listenerCount('data')}, before);
});
async function harness(t, overrides = {}) {
  const {createLocalFrameworkConsumer} = await import('../desktop_client/electromux/dist/local-framework-consumer.mjs');
  const root = await mkdtemp(join(process.env.TMPDIR || join(process.cwd(), '.codex-scratch'), 'electromux-factory-'));
  const command = join(root, 'te2');
  await copyFile('tests/fixtures/electromux_framework.cjs', command); await chmod(command, 0o700);
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const config = join(root, 'launcher-config'); await mkdir(config);
  const childRoot = join(root, 'framework-config');
  await writeFile(join(config, 'desktop-local-framework.json'), JSON.stringify({version: 1, command, port, env: overrides}));
  const events = []; let logs = '';
  const consumer = await createLocalFrameworkConsumer({
    environment: {...process.env, TE2_ELECTROMUX_CONFIG_HOME: config, TE2_CONFIG_HOME: childRoot},
    emit: async (name, data) => { assert.equal(name, 'local-framework-state'); events.push(data); },
    log: (_lane, text) => { logs = (logs + text).slice(-8192); },
  });
  t.after(async () => { await consumer.dispose(); await rm(root, {recursive: true, force: true}); });
  async function waitState(predicate) {
    const deadline = Date.now() + 10000;
    while (true) {
      const state = events.findLast(predicate); if (state) return state;
      assert.ok(Date.now() < deadline, logs);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return {consumer, events, port, childRoot, waitState, logs: () => logs};
}
test('factory preserves owned start, revisions, config isolation and graceful disposal', {timeout: 15000}, async t => {
  const h = await harness(t);
  const config = await h.consumer.dispatch('get_local_framework_config');
  config.env.INJECTED = 'must not alter actor';
  assert.equal((await h.consumer.dispatch('get_local_framework_config')).env.INJECTED, undefined);
  const start = await h.consumer.dispatch('start_local_framework');
  assert.equal(start.operationPending, true);
  const running = await h.waitState(state => state.phase === 'running' && !state.operationPending);
  assert.equal(running.ownership, 'electron');
  assert.equal(typeof running.stateSessionId, 'string'); assert.ok(running.stateRevision > start.stateRevision);
  assert.ok(h.logs().includes(`framework-config-home=${h.childRoot}`));
  const same = await h.consumer.dispatch('start_local_framework'); assert.equal(same.processId, running.processId);
  await Promise.all([h.consumer.dispose(), h.consumer.dispose()]);
  assert.throws(() => process.kill(running.processId, 0), {code: 'ESRCH'});
  await assert.rejects(h.consumer.dispatch('get_local_framework_state'), /closing/);
  const count = h.events.length; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.events.length, count);
});
test('factory disposal preserves an externally owned framework', {timeout: 10000}, async t => {
  const h = await harness(t);
  const external = createServer((_req, res) => res.end(JSON.stringify({status: 'ok', app: 'te2', port: h.port, instanceId: 'external'})));
  external.listen(h.port, '127.0.0.1'); await once(external, 'listening');
  t.after(() => new Promise(resolve => external.close(resolve)));
  assert.equal((await h.consumer.dispatch('refresh_local_framework')).ownership, 'external');
  await h.consumer.dispose();
  assert.equal((await fetch(`http://127.0.0.1:${h.port}/api/health`)).status, 200);
});
test('factory cancels source preparation without selecting local or replaying', {timeout: 10000}, async t => {
  const h = await harness(t, {TEST_BUILD_DELAY: '30000'});
  await h.consumer.dispatch('start_local_framework');
  const pending = await h.waitState(state => state.cancellableStartup && state.startupOutput === 'bootstrap preparing');
  const stopped = await h.consumer.dispatch('stop_local_framework');
  assert.equal(stopped.phase, 'exited'); assert.equal(stopped.selectionRevision, 0);
  assert.throws(() => process.kill(pending.processId, 0), {code: 'ESRCH'});
});
test('factory validates native endpoint observation and rejects unknown commands', async t => {
  const h = await harness(t);
  assert.ok(h.consumer.methods.includes('set_selected_framework'));
  assert.deepEqual(h.consumer.events, ['local-framework-state']);
  const observed = await h.consumer.dispatch('set_selected_framework', {origin: 'http://remote.test:8089'});
  assert.equal(observed.selectionRevision, 0); assert.equal(observed.selectedOrigin, 'http://remote.test:8089');
  await assert.rejects(h.consumer.dispatch('set_selected_framework', {origin: 'file:///secret'}), /Invalid/);
  await assert.rejects(h.consumer.dispatch('spawn', {}), /Unknown/);
});
