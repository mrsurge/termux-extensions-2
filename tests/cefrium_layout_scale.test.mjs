import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const policy = readFileSync(new URL('../android/cefrium/src/main/java/com/termux/extensions/CefriumViewportPolicy.kt', import.meta.url), 'utf8');
const selection = readFileSync(new URL('../android/cefrium/src/main/java/com/termux/extensions/CefriumSelectionIntegration.kt', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../android/cefrium/src/main/java/com/cefrium/Te2CefriumBrowserAccess.kt', import.meta.url), 'utf8');
assert.match(policy, /Te2CefriumBrowserAccess\.setAccessibilityPageZoom\(/);
assert.match(guard, /HostZoomMap\.setZoomLevel\(webContents, level\)/);
assert.doesNotMatch(policy, /evaluateJavaScript|setProperty|layoutScript/);
assert.doesNotMatch(selection, /setZoomLevel|setAccessibilityPageZoom/);
assert.doesNotMatch(policy + guard, /browser\.setZoomLevel/);
assert.match(guard, /updateMultiTouchZoomSupport\(false\)/);
assert.match(guard, /updateDoubleTapSupport\(false\)/);
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(fileURLToPath(new URL('../desktop_client/electron/node_modules/electron/dist/electron', import.meta.url)), [
  '--no-sandbox', fileURLToPath(new URL('./cefrium_native_scale_fixture.cjs', import.meta.url)),
], {env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024});
assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
assert.match(result.stdout, /Native Chromium scale\/drawer geometry passed: 42 /, result.stderr);
console.log(result.stdout.trim());
