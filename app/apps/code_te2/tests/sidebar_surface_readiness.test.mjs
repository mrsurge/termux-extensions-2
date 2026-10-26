import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['main_page/frontend/sidebar-shortcuts/surface-readiness.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { extensionSurfaceReady } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('persisted extension windows wait for their own current surface, not global readiness', () => {
  const sc = { url: '/surface', webviewSurface: { dto: 'ExtensionWebviewSurface', surfaceId: 'one' } };
  assert.equal(extensionSurfaceReady(sc, null), false);
  assert.equal(extensionSurfaceReady(sc, sc), false);
  const ready = { ...sc, readiness: { status: 'ready' } };
  assert.equal(extensionSurfaceReady(sc, ready), true);
  assert.equal(extensionSurfaceReady(sc, { ...ready, readiness: { status: 'starting' } }), false);
  assert.equal(extensionSurfaceReady(sc, { ...ready, url: '/old' }), false);
  assert.equal(extensionSurfaceReady(sc, { ...ready, webviewSurface: { ...sc.webviewSurface, surfaceId: 'other' } }), false);
  assert.equal(extensionSurfaceReady({ url: '/ordinary' }, null), true);
});

test('embedded, native and detached mounting all consult backend readiness', async () => {
  const source = await readFile('main_page/frontend/sidebar-shortcuts/runtime.ts', 'utf8');
  for (const name of ['_placeElectronNativeSurface', '_ensureDetachedShortcut', '_ensureIframeLoadedForShortcut']) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf('\n  function ', start);
    assert.match(source.slice(start, end), /if \(!_extensionSurfaceReady\(sc\)\) return false;/);
  }
});
