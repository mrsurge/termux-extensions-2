import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext, SourceTextModule, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const bootstrapSource = await readFile(new URL('../desktop_client/android_shell/electromux-bootstrap.js', import.meta.url), 'utf8');
const platformSource = await readFile(new URL('../desktop_client/android_shell/electromux-platform.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../vendor/electromux/android/host/src/main/assets/electromux-bridge.js', import.meta.url), 'utf8');
async function boot(hostname = '127.0.0.1', settingsPage = true) {
  let loaded, observer;
  const windowListeners = new Map(), documentListeners = new Map();
  const add = (listeners, name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
  };
  const remove = (listeners, name, callback) => listeners.get(name)?.delete(callback);
  const emit = (listeners, name) => [...(listeners.get(name) || [])].forEach(callback => callback());
  const controls = [{disabled: false}];
  const section = {querySelector: () => true, querySelectorAll: () => controls, dataset: {}, title: '', matches: () => false};
  controls[0].closest = () => section;
  const calls = [], nativeCalls = [];
  const context = createContext({URL, Object, Error, console, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout,
    cefriumQuery: options => {
      const request = JSON.parse(options.request); nativeCalls.push(request);
      options.onSuccess(JSON.stringify({id: request.id, result: {ok: true, value: {supported: true, phase: 'idle'}}, events: []}));
    },
    window: {location: {origin: `http://${hostname}:44100`, hostname, protocol: 'http:',
      pathname: settingsPage ? '/android-shell/settings.html' : '/android-shell/index.html', assign() {}},
      addEventListener: (name, callback) => add(windowListeners, name, callback),
      removeEventListener: (name, callback) => remove(windowListeners, name, callback)},
    document: {visibilityState: 'visible', querySelectorAll: () => [section],
      addEventListener: (name, callback) => add(documentListeners, name, callback),
      removeEventListener: (name, callback) => remove(documentListeners, name, callback)},
    MutationObserver: class {
      constructor(callback) {observer = this; this.callback = callback;}
      observe() {}
      disconnect() {this.disconnected = true;}
    },
    fetch: async (path, options) => {
      calls.push({path, options});
      return {ok: true, status: 200, json: async () => ({ok: true,
        data: {frameworkHost: 'remote.test', frameworkPort: 8089}})};
    },
  });
  runInContext(bridgeSource, context);
  const platform = new SourceTextModule(platformSource, {context});
  await platform.link(() => {throw new Error('Unexpected platform import');});
  const bootstrap = new SourceTextModule(bootstrapSource, {context,
    importModuleDynamically: async name => {
      loaded = name;
      const entry = new SourceTextModule('', {context});
      await entry.link(() => {});
      await entry.evaluate();
      return entry;
    }});
  await bootstrap.link(name => {
    assert.equal(name, './electromux-platform.js');
    return platform;
  });
  await bootstrap.evaluate();
  return {context, loaded, observer, pagehide: () => emit(windowListeners, 'pagehide'),
    emitWindow: name => emit(windowListeners, name), emitDocument: name => emit(documentListeners, name),
    controls, calls, nativeCalls};
}
const state = await boot();
assert.equal(state.loaded, './settings.js');
assert.equal(state.controls[0].disabled, true);
state.controls[0].disabled = false;
state.observer.callback([{type: 'attributes', target: state.controls[0]}]);
assert.equal(state.controls[0].disabled, true, 'async settings rendering cannot enable missing capability');
const settings = await state.context.__te2ShellPlatform.request('get_settings');
assert.equal(settings.frameworkHost, 'remote.test', 'unwrap gateway data once');
assert.equal(state.calls[0].path, '/android-api/settings');
assert.equal((await state.context.__te2ShellPlatform.request('get_local_framework_state')).supported, true);
assert.equal(state.nativeCalls[0].method, 'get_local_framework_state');
assert.match(state.nativeCalls[0].documentId, /^[a-zA-Z0-9_-]{16,80}$/);
assert.equal(state.context.__te2ShellPlatform.capabilities.localFramework, true);
await new Promise(resolve => setImmediate(resolve));
const before = state.nativeCalls.length;
state.emitWindow('pageshow'); state.emitWindow('focus'); state.emitWindow('electromux:page-ready');
state.emitDocument('visibilitychange');
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.nativeCalls.length, before + 1, 'activation burst reconciles once');
assert.equal(state.nativeCalls.at(-1).method, 'get_local_framework_state', 'activation never repeats Start');
state.context.document.visibilityState = 'hidden';
state.emitDocument('visibilitychange');
assert.equal(state.nativeCalls.length, before + 1, 'hidden pages do not reconcile');
state.pagehide();
assert.equal(state.observer.disconnected, true);
await assert.rejects(state.context.__te2ShellPlatform.request('start_local_framework'), /Bridge closed/);
state.emitWindow('focus'); state.emitWindow('pageshow'); state.emitDocument('visibilitychange');
assert.equal(state.nativeCalls.length, before + 1, 'disposed pages do not issue requests');
assert.equal((await boot('127.0.0.1', false)).loaded, './launcher.js');
await assert.rejects(boot('remote.test'), /native loopback relay/);
console.log('Consumer bootstrap: native-origin gate, actual adapter, capability controls and disposal passed');
