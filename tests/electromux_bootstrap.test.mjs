import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext, SourceTextModule} from 'node:vm';

const bootstrapSource = await readFile(new URL('../desktop_client/android_shell/electromux-bootstrap.js', import.meta.url), 'utf8');
const platformSource = await readFile(new URL('../desktop_client/android_shell/electromux-platform.js', import.meta.url), 'utf8');
async function boot(hostname = '127.0.0.1', settingsPage = true) {
  let loaded, observer, pagehide;
  const controls = [{disabled: false}];
  const section = {querySelector: () => true, querySelectorAll: () => controls, dataset: {}, title: ''};
  controls[0].closest = () => section;
  const calls = [];
  const context = createContext({URL, Object, Error, console,
    window: {location: {origin: `http://${hostname}:44100`, hostname, protocol: 'http:',
      pathname: settingsPage ? '/android-shell/settings.html' : '/android-shell/index.html', assign() {}},
      addEventListener: (_, callback) => {pagehide = callback;}},
    document: {querySelectorAll: () => [section]},
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
  return {context, loaded, observer, pagehide, controls, calls};
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
state.pagehide();
assert.equal(state.observer.disconnected, true);
assert.equal((await boot('127.0.0.1', false)).loaded, './launcher.js');
await assert.rejects(boot('remote.test'), /native loopback relay/);
console.log('Consumer bootstrap: native-origin gate, actual adapter, capability controls and disposal passed');
