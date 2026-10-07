import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load = async (path, suffix = '') => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(path, import.meta.url))).toString('base64')}#${suffix}`);
const {createRemoteElectromuxPlatform} = await load('../desktop_client/android_shell/electromux-platform.js');
const calls = [];
let settings = {frameworkHost: 'remote.test', frameworkPort: 8089};
const app = {id: 'code_te2', name: 'Code TE2', icon_src: '/icon.svg'};
let navigated;
let stateListener;
let unsubscribed = false;
const platform = createRemoteElectromuxPlatform({
  getBrowserOrigin: () => 'http://127.0.0.1:44100',
  navigate: url => {navigated = url;},
  on: (name, callback) => {
    assert.equal(name, 'local-framework-state');
    stateListener = callback;
    return () => {unsubscribed = true;};
  },
  gatewayRequest: async (path, options) => {
    calls.push({path, ...options});
    if (path === '/android-api/settings') {
      if (options.method === 'PUT') settings = {...options.body};
      return {...settings};
    }
    if (path === '/android-api/apps') return {online: true, apps: [{id: 'settings'}, app]};
    if (path === '/android-api/apps/code_te2/open') return {url: '/app/code_te2'};
    if (path === '/android-api/framework-bookmarks') return {bookmarks: [{name: 'Remote', ...settings}]};
    if (path === '/android-api/fws/status') return {available: true};
    if (path === '/android-api/framework/status') return {online: true};
    if (path === '/android-api/apps/code_te2/quit' || path === '/android-api/apps/reload') return {};
    throw new Error(`Unexpected route ${path}`);
  },
});

// Import the real Desktop host module unchanged except its new injection seam.
const saved = Object.fromEntries(['window','parent','document','__te2ShellPlatform','__te2NativeReply'].map(key => [key, globalThis[key]]));
const handlers = new Map();
globalThis.window = {location: {href: 'http://127.0.0.1:44100/android-shell/index.html'},
  addEventListener: (name, callback) => handlers.set(name, callback), setTimeout};
globalThis.parent = globalThis;
globalThis.document = {querySelector: () => null};
globalThis.__te2ShellPlatform = platform;
try {
  const {desktopShellHost: host} = await load('../desktop_client/android_shell/host.js');
  assert.equal((await host.getSettings()).frameworkHost, 'remote.test');
  const catalog = await host.getApps();
  assert.equal(catalog.online, true);
  assert.deepEqual(catalog.apps.map(item => item.id), ['settings', 'code_te2']);
  assert.equal(catalog.apps[1].icon_src, 'http://127.0.0.1:44100/icon.svg');
  const opened = await host.openApp('code_te2');
  assert.equal(opened.url, 'http://127.0.0.1:44100/app/code_te2?gv_native=1');
  host.navigate(opened.url);
  assert.equal(navigated, opened.url);
  assert.throws(() => host.navigate('http://evil.test/'), /external navigation/);
  const result = await host.saveSettings({frameworkHost: 'other.test', frameworkPort: 8090});
  assert.equal(result.connectionChanged, true);
  assert.equal((await host.getSettings()).frameworkHost, 'other.test');
  assert.equal(calls.filter(item => item.path === '/android-api/settings' && item.method === 'GET').length, 1);
  await host.getFrameworkBookmarks();
  await host.saveFrameworkBookmark({name: 'Other', frameworkHost: 'other.test', frameworkPort: 8090});
  await host.deleteFrameworkBookmark('Other');
  assert.deepEqual(calls.filter(item => item.path.endsWith('/framework-bookmarks')).map(item => item.method), ['GET','POST','DELETE']);
  assert.equal((await host.getLocalFrameworkState()).supported, false);
  await assert.rejects(host.startLocalFramework(), error => error.code === 'UNSUPPORTED_CAPABILITY');
  await assert.rejects(host.saveSettings({frameworkHost: 'other.test', frameworkPort: 8090, autostart: true}), /automatic startup/);
  await assert.rejects(platform.request('framework_request', {path: '/api/apps/../shutdown', method: 'POST'}), /framework route/);
  let observed;
  const off = host.onLocalFrameworkState(value => {observed = value;});
  stateListener({supported: false});
  assert.equal(observed.supported, false);
  off();
  handlers.get('pagehide')();
  assert.equal(unsubscribed, true);
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
// The existing Electron parent bridge remains the default when no adapter exists.
globalThis.window = {location: {href: 'app://android-shell/index.html'},
  addEventListener: (name, callback) => handlers.set(name, callback), setTimeout};
globalThis.parent = {
  __te2DesktopNativeRequest: async method => {
    assert.equal(method, 'get_settings');
    return {frameworkHost: 'electron.test', frameworkPort: 8089};
  },
  __te2DesktopNavigateApp: url => {navigated = url;},
};
globalThis.document = {querySelector: () => null};
try {
  const {desktopShellHost: host} = await load('../desktop_client/android_shell/host.js', 'electron');
  assert.equal((await host.getSettings()).frameworkHost, 'electron.test');
  host.navigate('http://127.0.0.1:44100/app/code_te2');
  assert.equal(navigated, 'http://127.0.0.1:44100/app/code_te2');
  let state;
  host.onLocalFrameworkState(value => {state = value;});
  handlers.get('message')({source: globalThis.parent,
    data: {type: 'te2-desktop:local-framework-state', state: {phase: 'running'}}});
  assert.equal(state.phase, 'running');
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
console.log('Actual Desktop host reuse: remote settings/bookmarks/catalog/navigation and event disposal passed');

const nativeCalls = [];
const local = createRemoteElectromuxPlatform({
  getBrowserOrigin: () => 'http://127.0.0.1:44100', navigate() {},
  gatewayRequest: async () => {throw new Error('Local lifecycle went over HTTP');},
  nativeRequest: async (method, params) => {nativeCalls.push({method, params}); return {supported: true};},
});
assert.equal(local.capabilities.localFramework, true);
assert.equal(local.capabilities.automaticStartup, false);
for (const method of ['get_local_framework_state', 'get_local_framework_config', 'save_local_framework_config',
  'refresh_local_framework', 'start_local_framework', 'stop_local_framework', 'use_local_framework'])
  assert.equal((await local.request(method, {example: true})).supported, true);
assert.equal(nativeCalls.length, 7);
await assert.rejects(local.request('shutdown'), /unavailable/);
