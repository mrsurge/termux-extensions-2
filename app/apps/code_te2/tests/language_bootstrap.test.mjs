import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({
  entryPoints: [new URL('../main_page/frontend/boot/language-bootstrap.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createLanguageBootstrapRequest } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const ready = { ui_prefs: { webWorkersEnabled: false }, code_server: { compatible: true, state: 'ready' } };
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('language bootstrap is a small no-store HTTP read without socket identity', async () => {
  const request = createLanguageBootstrapRequest(async (url, options) => {
    assert.equal(url, '/api/app/code_te2/startup/language');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.ok(options.signal);
    return json({ ...ready, ignored: 'not projected' });
  });
  assert.deepEqual(await request(), ready);
});

test('404 is an older-server capability miss, retained for this page only', async () => {
  let calls = 0;
  const request = createLanguageBootstrapRequest(async () => { calls++; return new Response('Not Found', { status: 404 }); });
  assert.equal(await request(), null);
  assert.equal(await request(), null);
  assert.equal(calls, 1);
  assert.deepEqual(await createLanguageBootstrapRequest(async () => json(ready))(), ready);
});

test('errors and malformed replies never masquerade as unsupported or missing installation', async () => {
  for (const failure of [
    () => { throw new Error('network failed'); },
    () => new Response('busy', { status: 503 }),
    () => new Response('unauthorized', { status: 401 }),
    () => new Response('bad json'),
    () => json({}),
    () => json({ ui_prefs: { webWorkersEnabled: false }, code_server: { compatible: false, state: 'missing' } }),
    () => json({ ...ready, code_server: { compatible: true, state: 'missing' } }),
    () => new Response(' '.repeat(32769)),
  ]) {
    let calls = 0;
    const request = createLanguageBootstrapRequest(async () => ++calls === 1 ? failure() : json(ready));
    await assert.rejects(request());
    assert.deepEqual(await request(), ready);
    assert.equal(calls, 2);
  }
});

test('HTTP deadline aborts rather than silently switching transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = createLanguageBootstrapRequest((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const rejected = assert.rejects(request(), /abort/i);
  t.mock.timers.tick(60000);
  await rejected;
});
