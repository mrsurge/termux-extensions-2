import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../desktop_client/android_shell/chrome.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../desktop_client/android_shell/chrome.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../desktop_client/android_shell/chrome.css', import.meta.url), 'utf8');
const actions = [...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(actions, ['home', 'reload', 'scale-down', 'scale-reset', 'scale-up', 'recents', 'quit', 'tools']);
assert.match(css, /height:\s*44px/);
assert.match(css, /#chrome-title\s*\{[^}]*text-overflow:\s*ellipsis/);
assert.match(html, /data-action="recents"[^>]*aria-label="Recent apps"[^>]*><svg/);
const buttons = actions.map(action => ({
  dataset: {action}, disabled: false, textContent: '', attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; },
  addEventListener(name, handler) { this[name] = handler; },
}));
const listeners = new Map(), requests = [];
const errorBox = {textContent: ''};
const titleBox = {textContent: '', title: ''};
let now = 10000, timerId = 0;
const timers = new Map();
let disposed = false, fail = false;
const statusListeners = new Set();
let state = {appId: 'code_te2', title: 'project — Code TE2', uiScalePercent: 110};
const bridge = {
  request: async (method, params) => {
    requests.push({method, params});
    if (fail) throw new Error('no retry');
    return state;
  },
  on: (_, callback) => { statusListeners.add(callback); return () => statusListeners.delete(callback); },
  receiveEvent: () => true,
  dispose: () => {disposed = true;},
};
const window = {ElectromuxBridge: {create(options) {
  assert.deepEqual(Array.from(options.methods), ['view_action', 'get_chrome_state']);
  assert.match(options.documentId, /^[a-z0-9]{32}$/);
  return bridge;
}},
  addEventListener(name, handler) {listeners.set(name, handler);},
  removeEventListener(name) {listeners.delete(name);},
};
vm.runInNewContext(source, {window, crypto: {randomUUID: () => '12345678-1234-1234-1234-123456789abc'},
  performance: {now: () => now},
  setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
  clearTimeout: id => timers.delete(id),
  document: {querySelectorAll: () => buttons, getElementById: id => id === 'chrome-title' ? titleBox : errorBox}});
assert.equal(requests.length, 0, 'script may load before native query plumbing');
window.cefriumQuery = () => {};
listeners.get('electromux:page-ready')();
listeners.get('electromux:page-ready')();
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 1, 'read-only startup reconciliation is single-flight');
assert.equal(titleBox.textContent, state.title);
assert.equal(titleBox.title, state.title);
assert.equal(buttons.find(b => b.dataset.action === 'scale-reset').textContent, '110%');
const statuses = [];
window.te2Desktop.onStatus(value => statuses.push(value));
for (const notify of statusListeners) notify(state);
assert.equal(statuses.length, 1, 'status subscription remains available without a lock button');
for (const button of buttons) {
  if (button.dataset.action === 'quit') {
    const before = requests.length;
    await button.click();
    assert.equal(requests.length, before, 'first Quit tap only arms the action');
    assert.equal(button.dataset.armed, 'true');
    assert.equal(button.attributes['aria-pressed'], 'true');
  }
  await button.click();
  assert.equal(requests.at(-1).method, 'view_action');
  assert.equal(requests.at(-1).params.action, button.dataset.action);
  assert.equal(button.disabled, false);
}
const quit = buttons.find(b => b.dataset.action === 'quit');
const beforeArming = requests.length;
await quit.click();
now += 3001;
await quit.click();
assert.equal(requests.length, beforeArming, 'a throttled timer cannot extend the arm deadline');
await buttons[0].click();
assert.equal(quit.dataset.armed, 'false', 'another action disarms Quit');
await quit.click();
listeners.get('blur')();
assert.equal(quit.dataset.armed, 'false', 'losing focus disarms Quit');
await quit.click();
for (const callback of [...timers.values()]) callback();
assert.equal(quit.dataset.armed, 'false', 'timeout disarms Quit');
await quit.click();
for (const notify of statusListeners) notify({...state, appId: 'terminal'});
assert.equal(quit.dataset.armed, 'false', 'a changed app cannot inherit an armed Quit');
assert.match(html, /chrome-group chrome-navigation/);
assert.match(html, /chrome-group chrome-scaling/);
assert.match(css, /\.chrome-navigation\s*\{\s*gap:\s*8px/);
assert.match(css, /\.chrome-quit\s*\{[^}]*margin-inline:\s*4px/);
assert.equal(titleBox.textContent, state.title, 'action completion must preserve the app title');
state = {title: '<b>literal title</b>', uiScalePercent: 60};
for (const notify of statusListeners) notify(state);
const decrease = buttons.find(b => b.dataset.action === 'scale-down');
const increase = buttons.find(b => b.dataset.action === 'scale-up');
assert.equal(titleBox.textContent, '<b>literal title</b>');
assert.equal(decrease.disabled, true);
const beforeLimit = requests.length;
await decrease.click();
assert.equal(requests.length, beforeLimit, 'disabled boundary does not dispatch a mutation');
state = {title: 'app', uiScalePercent: 180};
for (const notify of statusListeners) notify(state);
assert.equal(increase.disabled, true);
assert.equal(decrease.disabled, false);
fail = true;
const beforeFailure = requests.length;
await buttons[0].click();
assert.equal(errorBox.textContent, 'no retry');
assert.equal(requests.length, beforeFailure + 1, 'uncertain actions are not retried');
assert.equal(buttons[0].disabled, false);
assert.equal(typeof window.te2Desktop.onStatus(() => {}), 'function');
await quit.click();
listeners.get('pagehide')();
assert.equal(timers.size, 0);
assert.equal(listeners.has('blur'), false);
assert.equal(disposed, true);
assert.equal(window.te2Desktop, undefined);
assert.equal(listeners.has('electromux:page-ready'), false);
const afterPagehide = requests.length;
await quit.click();
assert.equal(requests.length, afterPagehide, 'retired toolbar cannot dispatch Quit');
console.log('Electromux mobile chrome startup, actions, state and disposal passed');
