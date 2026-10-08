import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const source = await readFile(new URL('../desktop_client/android_shell/electromux-settings.js', import.meta.url), 'utf8');
const {mountAndroidSettings} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('Android settings save immediately, preserve pending intent, and dispose activation', async () => {
  const controls = new Map(), handlers = new Map(), calls = [];
  const node = () => ({dataset: {}, listeners: {}, addEventListener(name, fn) {this.listeners[name] = fn;}});
  const section = {...node(), querySelector(id) {if (!controls.has(id)) controls.set(id, node()); return controls.get(id);}};
  const win = {addEventListener(name, fn) {handlers.set(name, fn);}, removeEventListener(name) {handlers.delete(name);}};
  const doc = {...win, visibilityState: 'visible', createElement: () => section,
    querySelector: selector => {assert.equal(selector, '.settings-page'); return {appendChild() {}};}};
  let enabled = false, permission = false, failSave = false;
  const platform = {async request(method, params) {
    calls.push({method, params});
    if (method === 'save_android_settings') {
      if (failSave) throw new Error('Save failed');
      enabled = params.persistentNetworkNotification; return {};
    }
    return {persistentNetworkNotification: enabled, runtime: {notificationPermissionGranted: permission}};
  }};
  const dispose = mountAndroidSettings(platform, doc, win);
  const settle = async () => {await new Promise(resolve => setImmediate(resolve));};
  await settle();
  const toggle = controls.get('#android-persistent-network');
  assert.equal(toggle.checked, false);
  assert.doesNotMatch(section.innerHTML, /android-save-power/);
  toggle.checked = true; const saving = toggle.listeners.change();
  assert.equal(toggle.disabled, true);
  handlers.get('focus')(); handlers.get('pageshow')(); await settle();
  await saving; await settle();
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);
  assert.equal(enabled, true);
  assert.deepEqual(calls.find(c => c.method === 'save_android_settings').params, {persistentNetworkNotification: true});
  failSave = true;
  toggle.checked = false; await toggle.listeners.change(); await settle();
  assert.equal(toggle.checked, true, 'failed save restores the confirmed value');
  assert.equal(toggle.disabled, false);
  assert.match(controls.get('#android-power-status').textContent, /Save failed/);
  assert.equal(calls.filter(c => c.method === 'save_android_settings').length, 2, 'no mutation retry');
  controls.get('#android-notification-settings').listeners.click(); await settle();
  assert.ok(calls.some(c => c.method === 'open_notification_settings' && c.params === undefined));
  permission = true; handlers.get('visibilitychange')(); await settle();
  assert.match(controls.get('#android-permission-status').textContent, /enabled/);
  dispose(); assert.equal(handlers.has('focus'), false); assert.equal(handlers.has('visibilitychange'), false);
});
test('connection row makes the host span both mobile columns', async () => {
  const css = await readFile(new URL('../desktop_client/android_shell/shell.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 520px)'));
  assert.match(mobile, /\.framework-connection-grid \.field:first-child\s*\{\s*grid-column: 1 \/ -1/);
  assert.match(mobile, /\.framework-connect-button\s*\{\s*grid-column: 2/);
});
