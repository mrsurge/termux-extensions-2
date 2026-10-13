import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import test from 'node:test';

const root = new URL('../../../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const desktop = JSON.parse(read('desktop_client/desktop_asset_inventory.json'));
const bundle = JSON.parse(read('app/android_editor_assets_bundle.json'));
const manifest = JSON.parse(read('app/apps/als_rs/vendor/frontend/manifest.json'));
const geckoSource = read('android/app/src/gecko/assets/asset_intercept/background.js');
const gecko = vm.runInNewContext(geckoSource.slice(geckoSource.indexOf('const LOCAL_PREFIXES'),
  geckoSource.indexOf('browser.webRequest.onBeforeRequest')) + '\nlocalPathFor;');
function electron(path) {
  if (!desktop.localFiles.includes(path) && !desktop.localPrefixes.some(p => path.startsWith(p))) return null;
  const entry = desktop.localMappings.find(m => m.kind === 'exact' ? path === m.source : path.startsWith(m.source));
  return entry ? entry.destination + (entry.kind === 'prefix' ? path.slice(entry.source.length) : '') : path;
}

test('every pinned ALS static resource is packaged and mapped for Gecko/Electron', () => {
  const entry = bundle.entries.find(e => e.kind === 'tree' && e.dest === 'apps/als_rs/frontend');
  assert.equal(entry.src, 'app/apps/als_rs/vendor/frontend');
  assert.equal(manifest.version, '0.2.132');
  assert.equal(Object.keys(manifest.files).length, 148);
  for (const [path, info] of Object.entries(manifest.files)) {
    const local = `/apps/als_rs/frontend/static/${path}`;
    const proxy = `/api/app/als-rs/proxy/static/${path}`;
    assert.equal(electron(proxy), local); assert.equal(gecko(proxy), local);
    const bytes = fs.readFileSync(new URL(`${entry.src}/static/${path}`, root));
    assert.equal(bytes.length, info.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), info.sha256);
    assert.ok(!path.endsWith('.map'));
  }
});
test('ALS pages/runtime endpoints remain proxied, not cached frontend authority', () => {
  for (const path of ['/api/app/als-rs/proxy/', '/api/app/als-rs/proxy/agent-log',
    '/api/app/als-rs/proxy/api/health', '/api/app/als-rs/proxy/socket.io/',
    '/api/app/als-rs/proxy/api/extensions/codex/assets/ui/main.js']) {
    assert.equal(electron(path), null); assert.equal(gecko(path), null);
  }
  const index = read('app/apps/als_rs/manifest.json');
  assert.ok(index.includes('"/static/"'));
  assert.ok(!manifest.files['index.html']);
});
test('shared Android aliases, WASM MIME, non-stale cache and required OTA inputs cover ALS', () => {
  const cef = read('android/cefrium/src/main/java/com/termux/extensions/CefriumAssetRoutes.kt');
  const localServer = read('android/app/src/main/java/com/termux/extensions/LocalAssetServer.kt');
  assert.ok(cef.includes('AlsProxyAssets.localPath(requestPath)'));
  assert.ok(localServer.includes('AlsProxyAssets.localPath(requestPath)'));
  assert.ok(localServer.includes('"application/wasm"'));
  assert.ok(localServer.includes('assetPath.startsWith("/apps/als_rs/frontend/static/")'));
  const required = read('android/app/src/main/java/com/termux/extensions/EditorAssetManager.kt');
  for (const path of ['manifest.json', 'static/dist/codex_agent.js', 'static/codex_agent.css',
    'static/js/console_bridge.js', 'static/vendor/socket.io/socket.io.min.js']) {
    assert.ok(desktop.requiredFiles.includes(`apps/als_rs/frontend/${path}`));
    assert.ok(required.includes(`"apps/als_rs/frontend/${path}"`));
  }
});
