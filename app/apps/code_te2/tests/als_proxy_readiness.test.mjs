import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../als_rs/main.js', import.meta.url), 'utf8');
const { default: init } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('ALS wrapper mounts after the framework gate without an HTTP health poll', async () => {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const requests = [];
  const frame = { src: '' };
  const loading = { style: {} };
  globalThis.window = { location: { pathname: '/app/als-rs', origin: 'http://framework.test',
    search: '?embed=1&te2_host_id=shared-slot&clientInstanceId=client-a&presentationId=p-a' } };
  globalThis.fetch = async (url) => {
    requests.push(url);
    assert.equal(url, '/api/apps/als-rs/proxy_shell');
    // No health_url needed: it is diagnostic metadata, not a second gate.
    return { ok: true, json: async () => ({ data: { start_url: '/api/app/als-rs/proxy/' } }) };
  };
  try {
    await init({ querySelector: selector => selector === '#ps-frame' ? frame : loading }, null, null);
    assert.deepEqual(requests, ['/api/apps/als-rs/proxy_shell']);
    const url = new URL(frame.src, 'http://framework.test');
    assert.equal(url.pathname, '/api/app/als-rs/proxy/');
    assert.equal(url.searchParams.get('te2_host_id'), 'shared-slot');
    assert.equal(url.searchParams.get('clientInstanceId'), 'client-a');
    assert.equal(url.searchParams.get('presentationId'), 'p-a');
    assert.equal(loading.style.display, 'none');
  } finally { Object.assign(globalThis, previous); }
});

test('app shell resolves lifecycle readiness before invoking the wrapper initializer', async () => {
  const shell = await readFile(new URL('../../../templates/app_shell.html', import.meta.url), 'utf8');
  const start = shell.indexOf('async function loadApp()');
  const wait = shell.indexOf('await waitForAppLifecycle(', start);
  const invoke = shell.indexOf('module.default(appContainer, api, host)', start);
  assert.ok(start >= 0 && wait > start && invoke > wait);
});
