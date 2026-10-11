import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
import { Window } from '../app/apps/code_te2/node_modules/happy-dom/lib/index.js';

const { outputFiles } = await build({
  entryPoints: [new URL('../app/apps/file_explorer/src/tabs_ui.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'browser', write: false,
});
const { createTabsUI } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const record = (id, shellId = null) => ({ id, path: `/project/${id}`, revision: 1,
  options: { showHidden: false, view: 'list', sortBy: 'name', sortAsc: true },
  shellId, directoryLocked: true, shellTrackingId: null });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(overrides = {}) {
  const window = new Window();
  window.document.body.innerHTML = '<main><section id="app"><div data-menu="tabs"><div data-menu-panel="tabs"></div></div></section><footer></footer></main>';
  const container = window.document.querySelector('#app');
  const calls = [];
  const deps = {
    container, footer: window.document.querySelector('footer'),
    list: async () => { calls.push('list'); return []; },
    catalog: async () => { calls.push('catalog'); return []; },
    create: async () => { calls.push('create'); },
    attach: async tab => { calls.push(['attach', tab.id]); },
    close: async tab => { calls.push(['close', tab.id]); },
    currentTab: () => null,
    showTabs: async () => { calls.push('showTabs'); },
    closeMenus: () => { calls.push('closeMenus'); },
    error: error => { calls.push(['error', error.message]); },
    confirm: async message => { calls.push(['confirm', message]); return true; },
    splashPublished: () => { calls.push('published'); },
    ...overrides,
  };
  const controller = createTabsUI(deps);
  return { window, controller, container, calls, splash: window.document.querySelector('.fx-tab-splash') };
}

test('splash remains identity-free until explicit New tab, and menu uses catalog rather than detach-list', async () => {
  const { controller, calls, splash, container } = fixture();
  await controller.showSplash();
  assert.deepEqual(calls, ['list', 'published']);
  assert.match(splash.textContent, /No open tabs/);
  assert.equal(container.style.display, 'none');
  splash.querySelector('button').click(); await tick();
  assert.deepEqual(calls.slice(-2), ['closeMenus', 'create']);
  controller.menuGroup.setAttribute('data-open', '');
  await controller.refreshMenu();
  assert.equal(calls.filter(value => value === 'list').length, 1);
  assert.equal(calls.at(-1), 'catalog');
  assert.equal(container.querySelector('[data-menu-panel="tabs"] button').textContent, 'New tab');
});

test('late splash result cannot replace active tab chrome or publish stale splash state', async () => {
  const pending = deferred();
  const { controller, calls, splash } = fixture({ list: () => pending.promise });
  const shown = controller.showSplash();
  controller.invalidateSplash(); controller.chrome(true);
  pending.resolve([record('late')]); await shown;
  assert.equal(splash.hidden, true);
  assert.equal(splash.querySelector('.fx-tab-row'), null);
  assert.deepEqual(calls, []);
});

test('catalog generations and closed-menu checks discard obsolete results', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const { controller, container } = fixture({ catalog: () => (++count === 1 ? first.promise : second.promise) });
  controller.menuGroup.setAttribute('data-open', '');
  const older = controller.refreshMenu(), newer = controller.refreshMenu();
  second.resolve([record('new')]); await newer;
  first.resolve([record('old')]); await older;
  assert.match(container.querySelector('[data-menu-panel="tabs"]').textContent, /project\/new/);
  assert.doesNotMatch(container.querySelector('[data-menu-panel="tabs"]').textContent, /project\/old/);
  controller.menuGroup.removeAttribute('data-open');
  await controller.refreshMenu();
  assert.match(container.querySelector('[data-menu-panel="tabs"]').textContent, /project\/new/);
});

test('attach and SVG close preserve explicit intent, terminal consent and root splash handoff', async () => {
  const { controller, calls, splash } = fixture({ list: async () => [record('one', 'shell-1')] });
  await controller.showSplash();
  const row = splash.querySelector('.fx-tab-row');
  row.querySelector('button').click(); await tick();
  assert.deepEqual(calls.slice(-2), ['closeMenus', ['attach', 'one']]);
  const close = row.querySelector('.fx-tab-close');
  assert.ok(close.querySelector('svg'));
  close.click(); await tick();
  assert.match(calls.find(value => Array.isArray(value) && value[0] === 'confirm')[1], /stop its terminal processes/);
  assert.deepEqual(calls.slice(-2), [['close', 'one'], 'showTabs']);
});

test('failure retry and disposal fence pending UI work and user actions', async () => {
  const pending = deferred(); let retries = 0;
  const { controller, splash, calls } = fixture({ list: () => pending.promise });
  controller.loading(); assert.equal(splash.textContent, 'Loading tabs…');
  controller.failed('Unavailable', () => retries++);
  const retry = splash.querySelector('button'); retry.click(); assert.equal(retries, 1);
  const shown = controller.showSplash(); controller.dispose();
  pending.resolve([record('gone')]); await shown;
  retry.click(); assert.equal(retries, 1);
  assert.equal(splash.isConnected, false); assert.deepEqual(calls, []);
});
