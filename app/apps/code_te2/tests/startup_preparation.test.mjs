import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { build } from 'esbuild';

const shell = await readFile(new URL('../../../templates/app_shell.html', import.meta.url), 'utf8');

test('readiness overlay preserves prepared content and releases interaction on failure', () => {
  const window = new Window();
  const appContainer = window.document.createElement('div');
  appContainer.innerHTML = '<div id="prepared">Keep this model host</div>';
  const prepared = appContainer.firstChild;
  const context = vm.createContext({ document: window.document, appContainer });
  const start = shell.indexOf("const startupOverlay = document.createElement");
  const end = shell.indexOf('const btnHome', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(shell.slice(start, end), context);
  vm.runInContext('beginAppPreparation()', context);
  assert.equal(appContainer.inert, true);
  assert.equal(appContainer.classList.contains('app-preparing'), true);
  assert.equal(appContainer.firstChild, prepared);
  vm.runInContext('activatePreparedApp()', context);
  assert.equal(appContainer.inert, false);
  assert.equal(appContainer.classList.contains('app-preparing'), true);
  vm.runInContext('setStartupInteraction(false)', context);
  assert.equal(appContainer.inert, true);
  vm.runInContext('setStartupInteraction(true)', context);
  assert.equal(appContainer.inert, false);
  vm.runInContext('finishAppPreparation()', context);
  vm.runInContext('setStartupInteraction(false)', context);
  assert.equal(appContainer.classList.contains('app-preparing'), false);
  assert.equal(window.document.getElementById('app-startup-overlay').hidden, true);
  assert.equal(appContainer.firstChild, prepared);
  const placeholder = shell.slice(shell.indexOf('function renderBackendReadinessPlaceholder'), shell.indexOf('// Rust lifecycle snapshots'));
  assert.doesNotMatch(placeholder, /appContainer\.innerHTML/);
  assert.match(placeholder, /startupOverlay\.innerHTML/);
});

for (const earlyReveal of [false, true]) test(`managed startup early reveal=${earlyReveal} preserves awaited initialization`, async () => {
  const calls = [];
  let completeModel;
  let layoutFrame;
  const modelReady = new Promise(resolve => { completeModel = resolve; });
  const context = vm.createContext({
    AbortController, appId: 'code_te2', appContainer: {}, host: {},
    sidebarShortcutVersion: () => '', startupMark: () => {},
    waitForAppLifecycle: async () => ({ entrypoints: {}, frontend_preparation: earlyReveal }),
    waitForNativeAppPrerequisites: async () => {},
    prepareAppPage: async () => ({ scriptUrl: 'host.js' }),
    loadModule: async () => {
      assert.deepEqual(calls, earlyReveal ? ['reveal'] : []);
      return { managesStartupReveal: true, default: () => modelReady };
    },
    activatePreparedApp: () => { calls.push('early-reveal'); },
    finishAppPreparation: () => { calls.push('reveal'); },
    window: { requestAnimationFrame: callback => { layoutFrame = callback; } },
    debugFullStack: false, escapeHtml: String, console,
  });
  const start = shell.indexOf('async function loadApp()');
  const end = shell.indexOf("document.addEventListener('DOMContentLoaded'", start);
  vm.runInContext(shell.slice(start, end).replace('await import(scriptUrl)', 'await loadModule(scriptUrl)'), context);
  const running = context.loadApp();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, earlyReveal ? ['reveal'] : []);
  completeModel();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, earlyReveal ? ['reveal'] : []);
  assert.equal(typeof layoutFrame, 'function');
  layoutFrame();
  await running;
  assert.deepEqual(calls, earlyReveal ? ['reveal', 'reveal'] : ['reveal']);
});

test('host boot start returns completion and propagates errors instead of detaching boot', async () => {
  const source = await readFile(new URL('../main_page/frontend/host-boot-runtime.ts', import.meta.url), 'utf8');
  const extracted = source.slice(source.indexOf('export function createHostBootRuntime'));
  const built = await build({ stdin: { contents: extracted, loader: 'ts' }, format: 'cjs', write: false });
  for (const fail of [false, true]) {
    let complete, reject;
    const pending = new Promise((resolve, rejectPromise) => { complete = resolve; reject = rejectPromise; });
    let hydration = 0;
    const context = vm.createContext({
      module: { exports: {} }, exports: {}, runBootSequence: () => pending,
      runPostBootSidebarHydration: () => { hydration++; },
    });
    vm.runInContext(built.outputFiles[0].text, context);
    const result = context.module.exports.createHostBootRuntime({}).start();
    assert.equal(typeof result?.then, 'function');
    let finished = false;
    result.then(() => { finished = true; }, () => {});
    await Promise.resolve();
    assert.equal(finished, false);
    if (fail) {
      reject(new Error('mount failed'));
      await assert.rejects(result, /mount failed/);
      assert.equal(hydration, 0);
    } else {
      complete();
      await result;
      assert.equal(hydration, 1);
    }
  }
});

test('early responsive preparation is idempotent and still responds to resize', async () => {
  const output = await build({ entryPoints: [new URL('../main_page/frontend/ui/layout-manager.ts', import.meta.url).pathname], bundle: true, format: 'cjs', write: false });
  const window = new Window();
  window.document.body.innerHTML = '<div class="fe-root"></div>';
  let desktop = true;
  window.matchMedia = () => ({ matches: desktop });
  let listeners = 0;
  const add = window.addEventListener.bind(window);
  window.addEventListener = (...args) => { listeners++; add(...args); };
  const context = vm.createContext({ window, document: window.document, HTMLElement: window.HTMLElement, exports: {}, module: { exports: {} }, setTimeout });
  vm.runInContext(output.outputFiles[0].text, context);
  const { initResponsiveLayout } = context.module.exports;
  initResponsiveLayout();
  initResponsiveLayout();
  assert.equal(listeners, 2);
  const root = window.document.querySelector('.fe-root');
  assert.equal(root.classList.contains('layout-desktop'), true);
  desktop = false;
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(root.classList.contains('layout-mobile'), true);
  assert.equal(root.classList.contains('layout-desktop'), false);
});

for (const scenario of ['prepare-first', 'ready-first', 'legacy', 'prepare-error']) {
  test(`staged shell startup preserves readiness ordering: ${scenario}`, async () => {
    const calls = [];
    let publishCatalog;
    let ready;
    let finishPrepare;
    let failPrepare;
    const prepared = new Promise((resolve, reject) => { finishPrepare = resolve; failPrepare = reject; });
    const lifecycle = new Promise(resolve => { ready = resolve; });
    const definition = { frontend_preparation: scenario !== 'legacy', entrypoints: {} };
    const context = vm.createContext({
      AbortController,
      appId: 'code_te2', appContainer: { innerHTML: '' }, host: {},
      sidebarShortcutVersion: () => '', startupMark: () => {},
      waitForAppLifecycle: callback => { publishCatalog = callback; return lifecycle; },
      waitForNativeAppPrerequisites: async () => { calls.push('routes'); },
      prepareAppPage: () => { calls.push('prepare'); return prepared; },
      loadModule: async () => { calls.push('import'); return { default: async () => { calls.push('activate'); } }; },
      activatePreparedApp: () => {}, finishAppPreparation: () => { calls.push('finish'); },
      window: {}, debugFullStack: false, escapeHtml: String,
      console: { error: () => { calls.push('error'); } },
    });
    const start = shell.indexOf('async function loadApp()');
    const end = shell.indexOf("document.addEventListener('DOMContentLoaded'", start);
    vm.runInContext(shell.slice(start, end).replace('await import(scriptUrl)', 'await loadModule(scriptUrl)'), context);
    const running = context.loadApp();
    const a = publishCatalog(definition);
    const b = publishCatalog(definition);
    // Simulate the lifecycle owner's rejection handler, avoiding unhandled
    // rejections while the gate itself remains pending in this focused test.
    if (a) a.catch(() => {});
    if (b) b.catch(() => {});
    assert.equal(calls.filter(x => x === 'prepare').length, scenario === 'legacy' ? 0 : 1);
    if (scenario === 'prepare-first') {
      finishPrepare({ scriptUrl: 'host.js' });
      await Promise.resolve();
      assert.equal(calls.includes('activate'), false);
    }
    ready(definition);
    await Promise.resolve();
    await Promise.resolve();
    if (scenario !== 'prepare-first') assert.equal(calls.includes('activate'), false);
    if (scenario === 'prepare-error') failPrepare(new Error('preparation failed'));
    else finishPrepare({ scriptUrl: 'host.js' });
    await running;
    assert.equal(calls.filter(x => x === 'prepare').length, 1);
    assert.equal(calls.includes('activate'), scenario !== 'prepare-error');
    assert.equal(calls.includes('error'), scenario === 'prepare-error');
    if (scenario !== 'prepare-error') assert.ok(calls.indexOf('routes') < calls.indexOf('activate'));
  });
}

test('preparation is local-only and separate host execution does not reapply dimensions', async () => {
  const output = await build({ entryPoints: [new URL('../main_page/frontend/boot/prepare-page.ts', import.meta.url).pathname], bundle: true, format: 'cjs', write: false, metafile: true });
  assert.equal(Object.keys(output.metafile.inputs).length, 4);
  for (const input of Object.keys(output.metafile.inputs)) {
    assert.match(input, /(?:prepare-page|layout-manager|host-resize-manager|drawer-sizing)\.ts$/);
  }
  const window = new Window();
  window.document.body.innerHTML = '<main><div class="fe-root"></div></main>';
  window.matchMedia = () => ({ matches: true });
  let reads = 0;
  const contextValues = {
    window, document: window.document, HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle.bind(window), setTimeout,
    localStorage: { getItem: () => { reads++; return '{}'; } },
  };
  const prepare = () => {
    const context = vm.createContext({ ...contextValues, module: { exports: {} }, exports: {} });
    vm.runInContext(output.outputFiles[0].text, context);
    context.module.exports.default(window.document.querySelector('main'));
  };
  prepare();
  assert.ok(reads > 0);
  const initialReads = reads;
  prepare(); // Independent bundle/module instance, as in host.js.
  assert.equal(reads, initialReads);
  assert.equal(window.document.querySelector('.fe-root').dataset.te2LayoutPrepared, '1');
  const inventory = JSON.parse(await readFile(new URL('../../../android_editor_assets_bundle.json', import.meta.url), 'utf8'));
  assert.ok(inventory.entries.some(entry => entry.kind === 'tree' && entry.src === 'app/static/js'));
});

test('real lifecycle stream starts preparation on catalog but releases only on ready; preparation errors close it', async () => {
  for (const fail of [false, true]) {
    let stream;
    const calls = [];
    class EventSource {
      handlers = new Map();
      constructor() { stream = this; }
      addEventListener(name, handler) { this.handlers.set(name, handler); }
      close() { calls.push('closed'); }
      emit(name, payload) { this.handlers.get(name)({ data: JSON.stringify(payload) }); }
    }
    const context = vm.createContext({
      EventSource, appId: 'code_te2', host: { setTitle() {} },
      teStateStore: null, debugFullStack: false, runtimeStartupDebug: false,
      startupMark() {}, renderBackendReadinessPlaceholder() {},
      normalizeReadinessStatus: readiness => readiness.status,
      appRequiresBackend: () => true, appSupportsReadiness: () => true,
    });
    const start = shell.indexOf('async function waitForAppLifecycle(');
    const end = shell.indexOf('async function waitForNativeAppPrerequisites', start);
    vm.runInContext(shell.slice(start, end), context);
    let released = false;
    const gate = context.waitForAppLifecycle(async () => {
      calls.push('prepare');
      if (fail) throw new Error('missing installed preparation asset');
    });
    gate.then(() => { released = true; }, () => {});
    stream.emit('apps_snapshot', {
      catalog: [{ id: 'code_te2', readiness: { status: 'starting' } }],
      app_bootstrap: { app_id: 'code_te2', app: { entrypoints: { frontend_template: 'template.html' } } },
    });
    await Promise.resolve();
    assert.equal(calls.includes('prepare'), true);
    assert.equal(released, false);
    if (fail) {
      await assert.rejects(gate, /missing installed preparation asset/);
    } else {
      stream.emit('app_readiness_changed', { app_id: 'other', readiness: { status: 'ready' } });
      assert.equal(released, false);
      stream.emit('app_readiness_changed', { app_id: 'code_te2', readiness: { status: 'ready' } });
      await gate;
    }
    assert.equal(calls.includes('closed'), true);
  }
});
