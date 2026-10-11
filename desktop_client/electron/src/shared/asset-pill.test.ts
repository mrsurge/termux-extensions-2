import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('asset pill reuses forced OTA request, prevents double clicks and recovers from errors', async () => {
  const source = readFileSync('src/renderer/index.ts', 'utf8');
  const start = source.indexOf('assetVersion.addEventListener("click"');
  const end = source.indexOf('\nframeworkOffline.addEventListener', start);
  assert.ok(start >= 0 && end > start);
  let click: () => Promise<void> = async () => {};
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const calls: string[] = [], messages: string[] = [], versions: unknown[] = [];
  const attributes = new Map<string, string>();
  const assetVersion = {
    disabled: false,
    addEventListener(_event: string, listener: () => Promise<void>) { click = listener; },
    setAttribute(key: string, value: string) { attributes.set(key, value); },
    removeAttribute(key: string) { attributes.delete(key); },
  };
  const context = vm.createContext({ assetVersion,
    bridge: { request(method: string) { calls.push(method); return new Promise((yes, no) => { resolve = yes; reject = no; }); } },
    toast: (message: string) => messages.push(message),
    setAssetBadge: (value: unknown) => versions.push(value),
    errorMessage: (error: Error) => error.message,
  });
  vm.runInContext(transformSync(source.slice(start, end), { loader: 'ts' }).code, context);
  const first = click();
  await click();
  assert.deepEqual(calls, ['update_assets']);
  assert.equal(attributes.get('aria-busy'), 'true');
  resolve({ updated: true, localVersion: 'test' }); await first;
  assert.deepEqual(versions, ['test']);
  assert.equal(assetVersion.disabled, false);
  const second = click(); reject(new Error('offline')); await second;
  assert.equal(messages.at(-1), 'offline');
  assert.equal(assetVersion.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
  assert.match(readFileSync('src/renderer/index.html', 'utf8'), /<button id="asset-version"[^>]+type="button"/);
});
