import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';
import { encode, decode } from '../app/apps/file_explorer/node_modules/@msgpack/msgpack/dist.esm/index.mjs';

const shims = `
export const initConsoleBridge = () => Promise.resolve(null);
export const getConsoleBridgeStatus = () => ({});
export const getIcon = async () => ({codicon:'file'});
export const renderIcon = (node, icon) => { node.dataset.icon = icon.codicon; };
export const selectPaths = (selected, order, anchor, path) => ({selected:new Set([path]),anchor:path});
export const createListingFilter = deliver => ({apply(entries){deliver(entries,'')},cancel(){}});
export const createFileExplorerIntents = () => ({openFile:async()=>{},openProject:async()=>{},openTerminal:async()=>{}});
export const createTerminalDrawer = () => { const holder=window.__probe; holder.terminals++;return {sync(){},show:async()=>{},dispose(){holder.terminalDisposals++}}; };
`;
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../app/apps/file_explorer/src/main.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [{ name: 'integration-resources', setup(build) {
  build.onResolve({ filter: /^\/static\/|terminal_drawer$/ }, () => ({ path: 'resources', namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: shims, loader: 'js' }));
} }] });
const { default: mount } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const template = await readFile(new URL('../app/apps/file_explorer/src/template.html', import.meta.url), 'utf8');
const settle = async () => { for (let n = 0; n < 14; n++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const record = { id: 'existing', path: '/project', revision: 1, shellId: null, shellTrackingId: null, directoryLocked: true, options: { view: 'list', sortBy: 'name', sortAsc: true, showHidden: false } };
const windows = [];
afterEach(async () => {
  for (const window of windows.splice(0)) {
    const event = new window.PageTransitionEvent('pagehide');
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    await window.happyDOM.abort();
    window.close();
  }
});
function fixture({ query = '', listGate, autoConnect = true } = {}) {
  const window = new Window({ url: `http://localhost/app/file_explorer${query}` });
  windows.push(window);
  for (const name of ['document', 'location', 'history', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLSelectElement', 'Element', 'Node']) globalThis[name] = window[name];
  globalThis.window = window;
  const probe = { terminals: 0, terminalDisposals: 0 }; window.__probe = probe;
  const root = window.document.createElement('main'); root.innerHTML = template; window.document.body.append(root);
  const methods = [], lists = [], sockets = [], toasts = [];
  window.teUI = { toast: text => toasts.push(text), dialog: { prompt: async () => null, confirm: async () => true }, notify() {}, dismiss() {} };
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: [] }));
  class Socket {
    connected = false; sendBuffer = []; listeners = new Map(); disconnects = 0; connections = 0;
    on(name, callback) { const handlers = this.listeners.get(name) || []; handlers.push(callback); this.listeners.set(name, handlers); }
    off(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== callback && item.listener !== callback)); }
    once(name, callback) { const wrapper = (...args) => { this.off(name, wrapper); callback(...args); }; wrapper.listener = callback; this.on(name, wrapper); }
    fire(name, ...args) { for (const callback of [...(this.listeners.get(name) || [])]) callback(...args); }
    connect() { this.connections++; if (autoConnect) queueMicrotask(() => { this.connected = true; this.fire('connect'); }); }
    disconnect() { this.disconnects++; this.connected = false; this.fire('disconnect'); }
    emit(name, bytes, ack) {
      assert.equal(name, 'tab_request'); const request = decode(bytes); methods.push(request.method);
      let result;
      if (request.method === 'tabs.list' || request.method === 'tabs.catalog') result = { tabs: [record] };
      else if (request.method === 'tabs.attach' || request.method === 'tabs.update') result = { tab: record };
      else throw new Error(`Unexpected mutating method ${request.method}`);
      queueMicrotask(() => ack(encode({ id: request.id, ok: true, result })));
    }
  }
  window.io = () => { const socket = new Socket(); sockets.push(socket); return socket; };
  const api = { get: async endpoint => { lists.push(endpoint); if (listGate) await listGate.promise; return { path: '/project', entries: [{ path: '/project/a.py', name: 'a.py', type: 'file' }] }; }, post: async () => ({ sidebar: {} }) };
  const host = { id: 'file_explorer', setTitle() {}, loadState() { return null; }, saveState() {} };
  return { window, root, methods, lists, sockets, probe, api, host, toasts };
}
function transition(f, name, persisted = false) {
  // Happy DOM's PageTransitionEvent currently omits the browser persisted field.
  const event = new f.window.PageTransitionEvent(name);
  Object.defineProperty(event, 'persisted', { value: persisted });
  f.window.dispatchEvent(event);
}
test('composition startup splash lists tabs without creating one', async () => {
  const f = fixture(); mount(f.root, f.api, f.host); await settle();
  assert.deepEqual(f.methods, ['tabs.list']); assert.deepEqual(f.lists, []); assert.match(f.root.textContent, /File Explorer tabs/); assert.equal(f.root.querySelector('.fx-tab-splash').hidden, false); transition(f, 'pagehide');
});
test('explicit existing tab restores listing without tab creation', async () => {
  const f = fixture({ query: '?tab_id=existing' }); mount(f.root, f.api, f.host); await settle();
  assert.equal(f.methods[0], 'tabs.attach'); assert.equal(f.methods.includes('tabs.create'), false); assert.equal(f.lists.length, 1); assert.equal(f.root.querySelector('.fx-name').textContent, 'a.py'); transition(f, 'pagehide');
});
test('same root remount disposes old socket/controllers and does not duplicate splash', async () => {
  const f = fixture(); mount(f.root, f.api, f.host); await settle(); const old = f.sockets[0];
  mount(f.root, f.api, f.host); await settle(); assert.equal(old.disconnects, 1); assert.equal(f.probe.terminalDisposals, 1); assert.equal(f.root.querySelectorAll('.fx-tab-splash').length, 1);
  const requests = f.methods.length; old.fire('tab_catalog', encode({})); await settle(); assert.equal(f.methods.length, requests); transition(f, 'pagehide');
});
test('pagehide cancels startup connection and suppresses its late ready callback', async () => {
  const f = fixture({ autoConnect: false }); mount(f.root, f.api, f.host); await settle(); transition(f, 'pagehide');
  f.sockets[0].connected = true; f.sockets[0].fire('connect'); await settle(); assert.deepEqual(f.methods, []); assert.equal(f.root.querySelector('.fx-tab-splash'), null); assert.deepEqual(f.toasts, []);
});
test('pagehide fences delayed directory response rather than rendering detached mount', async () => {
  const gate = deferred(); const f = fixture({ query: '?tab_id=existing', listGate: gate }); mount(f.root, f.api, f.host); await settle(); assert.equal(f.lists.length, 1);
  transition(f, 'pagehide'); gate.resolve(); await settle(); assert.equal(f.root.querySelector('.fx-name'), null); assert.equal(f.probe.terminalDisposals, 1);
});
test('bfcache suspends then resumes existing socket without replacing controllers', async () => {
  const f = fixture({ query: '?tab_id=existing' }); mount(f.root, f.api, f.host); await settle();
  transition(f, 'pagehide', true); assert.equal(f.sockets[0].disconnects, 1); assert.equal(f.probe.terminalDisposals, 0);
  transition(f, 'pageshow', true); await settle(); assert.equal(f.sockets.length, 1); assert.equal(f.sockets[0].connections, 2); assert.equal(f.probe.terminals, 1); assert.equal(f.root.querySelector('.fx-name').textContent, 'a.py'); transition(f, 'pagehide');
});
