import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createLocalFrameworkConsumer} from '../desktop_client/electromux/dist/local-framework-consumer.mjs';

async function harness(t, script, options = {}) {
  const root = await mkdtemp(join(process.env.TMPDIR || join(process.cwd(), '.codex-scratch'), 'installer-test-'));
  const bin = join(root, 'bin'), config = join(root, 'config');
  await mkdir(bin); await mkdir(config);
  if (options.config) await writeFile(join(config, 'desktop-local-framework.json'), JSON.stringify({version: 1, ...options.config}));
  const events = [];
  const consumer = await createLocalFrameworkConsumer({
    environment: {...process.env, HOME: root, PATH: bin, PREFIX: '/usr', TMPDIR: root,
      TE2_ELECTROMUX_CONFIG_HOME: config},
    enableInstaller: options.enabled !== false,
    ...(options.nativeDownload ? {} : {installerDownload: options.download || (async () => new TextEncoder().encode(script))}),
    emit: async (_name, state) => events.push(state), log() {},
  });
  t.after(async () => { await consumer.dispose(); await rm(root, {recursive: true, force: true}); });
  async function wait(predicate) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await consumer.dispatch('get_local_framework_state');
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(JSON.stringify(events.at(-1)));
  }
  return {consumer, root, wait};
}

test('installer requires exact consent and native opt-in, excludes manual configuration', async t => {
  const h = await harness(t, 'exit 0');
  assert.equal((await h.consumer.dispatch('get_local_framework_state')).canInstall, true);
  await assert.rejects(h.consumer.dispatch('install_local_framework', {}));
  await assert.rejects(h.consumer.dispatch('install_local_framework', {confirmed: true, url: 'https://example.test'}));
  const disabled = await harness(t, 'exit 0', {enabled: false});
  assert.equal((await disabled.consumer.dispatch('get_local_framework_state')).canInstall, false);
  const manual = await harness(t, 'exit 0', {config: {command: '/missing/manual/te2'}});
  assert.equal((await manual.consumer.dispatch('get_local_framework_state')).canInstall, false);
});

test('successful installer rediscovers executable without starting framework and cleans scratch', async t => {
  const h = await harness(t, 'printf "#!/bin/sh\\nexit 0\\n" > "$HOME/bin/te2"\n/bin/chmod 700 "$HOME/bin/te2"\nprintf "finished\\n"\n');
  await h.consumer.dispatch('install_local_framework', {confirmed: true});
  const state = await h.wait(s => s.installation.phase === 'succeeded' && s.commandDetected);
  assert.equal(state.installation.exitCode, 0);
  assert.equal(state.processId, null);
  assert.equal(state.canInstall, false);
  assert.equal((await readdir(h.root)).some(name => name.startsWith('te2-electromux-install-')), false);
});

test('failed installer preserves bounded output and authoritative exit', async t => {
  const h = await harness(t, 'i=0; while [ "$i" -lt 3000 ]; do printf x; i=$((i+1)); done; printf "\\nfailed\\n" >&2; exit 7');
  await h.consumer.dispatch('install_local_framework', {confirmed: true});
  const state = await h.wait(s => s.installation.phase === 'failed' && s.canInstall);
  assert.equal(state.installation.exitCode, 7);
  assert.match(state.installation.error, /status 7/);
  assert.ok(state.installation.output.length <= 2048);
});

test('zero exit without executable is not reported as ready', async t => {
  const h = await harness(t, 'exit 0');
  await h.consumer.dispatch('install_local_framework', {confirmed: true});
  const state = await h.wait(s => s.installation.phase === 'failed' && s.canInstall);
  assert.match(state.installation.error, /not found on PATH/);
});

test('Cancel terminates the owned installer and warns about partial changes', async t => {
  const h = await harness(t, 'printf "waiting\\n"; /usr/bin/sleep 60');
  await h.consumer.dispatch('install_local_framework', {confirmed: true});
  const running = await h.wait(s => s.installation.processId !== null);
  await assert.rejects(h.consumer.dispatch('start_local_framework'), /Installation is active/);
  await h.consumer.dispatch('cancel_local_framework_install');
  const state = await h.wait(s => s.installation.phase === 'cancelled' && s.canInstall);
  assert.match(state.installation.error, /Partial changes may remain/);
  assert.throws(() => process.kill(running.installation.processId, 0), {code: 'ESRCH'});
});

test('Cancel during download aborts before spawning a shell', async t => {
  const h = await harness(t, '', {download: signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    if (signal.aborted) reject(new Error('aborted'));
  })});
  await h.consumer.dispatch('install_local_framework', {confirmed: true});
  await h.wait(s => s.installation.phase === 'downloading');
  await h.consumer.dispatch('cancel_local_framework_install');
  assert.equal((await h.wait(s => s.installation.phase === 'cancelled')).installation.processId, null);
});

test('published download uses fixed URL and rejects insecure redirects and oversized bootstrap', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requested = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) throw new Error('No fixture framework');
    requested.push(String(url)); assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {location: 'http://insecure.test/install'}});
  };
  const insecure = await harness(t, '', {nativeDownload: true});
  await insecure.consumer.dispatch('install_local_framework', {confirmed: true});
  const failure = await insecure.wait(s => s.installation.phase === 'failed');
  assert.match(failure.installation.error, /HTTPS/);
  assert.deepEqual(requested, ['https://github.com/mrsurge/termux-extensions-2/releases/latest/download/install-te2']);
  globalThis.fetch = async url => {
    if (String(url).startsWith('http://127.0.0.1:')) throw new Error('No fixture framework');
    return new Response(new Uint8Array(2 * 1024 * 1024 + 1));
  };
  const oversized = await harness(t, '', {nativeDownload: true});
  await oversized.consumer.dispatch('install_local_framework', {confirmed: true});
  assert.match((await oversized.wait(s => s.installation.phase === 'failed')).installation.error, /exceeds 2MiB/);
});
