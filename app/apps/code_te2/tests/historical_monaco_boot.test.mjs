import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

let sequence = 0;
async function loadBoot() {
  const built = await build({
    entryPoints: [path.resolve(import.meta.dirname, '../monaco_editor/historical_monaco_boot.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser',
    plugins: [{ name: 'boot-test-boundaries', setup(builder) {
      builder.onResolve({ filter: /monaco\.bootstrap\.bundle\.js$/ }, () => ({ path: 'monaco', namespace: 'fixture' }));
      builder.onResolve({ filter: /editor_monaco_boot_runtime\.ts$/ }, () => ({ path: 'gecko', namespace: 'fixture' }));
      builder.onResolve({ filter: /historical_diff_view\.ts$/ }, () => ({ path: 'view', namespace: 'fixture' }));
      builder.onResolve({ filter: /historical_appearance\.ts$/ }, () => ({ path: 'appearance', namespace: 'fixture' }));
      builder.onResolve({ filter: /inline_host\.ts$/ }, () => ({ path: 'touch', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: fixture }) => ({ contents: {
        monaco: `export async function loadMonaco(options) { globalThis.__historyBoot.calls.push(options); return globalThis.__historyBoot.monaco; }`,
        gecko: `export function createGeckoModuleWorker(...args) { globalThis.__historyBoot.gecko.push(args[4]); return {}; }`,
        view: `export async function mountHistoricalDiffView(options) { globalThis.__historyBoot.views.push(options); return { dispose() {}, updateAppearance(value) { globalThis.__historyBoot.appearances.push(value); } }; }`,
        appearance: `export function historicalAppearance(value) { return { appearance: value, theme: 'vs-dark' }; } export function createHistoricalThemeApplier() { return async () => {}; }`,
        touch: `export async function ensureHistoricalTouchAssets() { globalThis.__historyBoot.touchLoads++; }`,
      }[fixture], loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}#${sequence++}`);
}

async function fixture(run) {
  const win = new Window();
  const saved = new Map(['window', 'document', 'Worker', '__historyBoot'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const state = { calls: [], gecko: [], workers: [], views: [], appearances: [], touchLoads: 0, monaco: {
    editor: { setTheme() {} },
    languages: { getLanguages: () => [
      { id: 'typescript', extensions: ['.ts'] },
      { id: 'declaration', extensions: ['.d.ts'] },
      { id: 'dockerfile', filenames: ['Dockerfile'] },
    ] },
  } };
  Object.assign(globalThis, { window: win, document: win.document, __historyBoot: state,
    Worker: class { constructor(url, options) { state.workers.push({ url, options }); } },
  });
  try { await run(win, state); } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    await win.happyDOM.close();
  }
}

test('syntax boot loads only lexical contributions and refuses language workers', async () => {
  await fixture(async (win, state) => {
    const { bootHistoricalDiff } = await loadBoot();
    const container = win.document.createElement('div');
    const abort = new AbortController();
    const mounting = bootHistoricalDiff(container, {}, abort.signal);
    const link = win.document.querySelector('link');
    link.dispatchEvent(new win.Event('load'));
    await mounting;
    assert.deepEqual(state.calls, [{ languageWorkersEnabled: false, basicLanguagesOnly: true }]);
    const workerFactory = win.MonacoEnvironment.getWorker;
    assert.throws(() => workerFactory('', 'typescript'), /refused/);
    workerFactory('', 'editorWorkerService');
    assert.equal(state.workers.length + state.gecko.length, 1);
    assert.equal(state.views[0].languageForPath('/src/a.d.ts'), 'declaration');
    assert.equal(state.views[0].languageForPath('/src/Dockerfile'), 'dockerfile');
    assert.equal(state.views[0].languageForPath('/src/unknown.xyz'), 'plaintext');
    await bootHistoricalDiff(container, {}, abort.signal);
    assert.equal(state.calls.length, 1);
  });
});

test('mobile boot attaches read-only tools to the exact control and accepts live preferences', async () => {
  await fixture(async (win, state) => {
    Object.defineProperty(win.navigator, 'userAgent', { value: 'Android Mobile' });
    const attached = [];
    win['monaco-touch-selection'] = { editorTouchSelectionHelp: (...args) => attached.push(args) };
    const { bootHistoricalDiff } = await loadBoot();
    const mounting = bootHistoricalDiff(win.document.createElement('div'), {}, new AbortController().signal, { fontScale: 1.5 });
    win.document.querySelector('link').dispatchEvent(new win.Event('load'));
    const view = await mounting;
    assert.equal(state.touchLoads, 1);
    const control = {};
    state.views[0].attachTouch(control);
    assert.deepEqual(attached, [[control, { mobile: true, historicalReadOnly: true }]]);
    assert.equal(win.monaco, state.monaco);
    view.updatePreferences({ fontScale: 2 });
    assert.deepEqual(state.appearances.at(-1), { fontScale: 2 });
    view.dispose();
    view.updatePreferences({ fontScale: 3 });
    assert.deepEqual(state.appearances.at(-1), { fontScale: 2 });
  });
});

test('cancelled boot does not mount after stylesheet becomes ready', async () => {
  await fixture(async (win, state) => {
    const { bootHistoricalDiff } = await loadBoot();
    const abort = new AbortController();
    const mounting = bootHistoricalDiff(win.document.createElement('div'), {}, abort.signal);
    abort.abort();
    win.document.querySelector('link').dispatchEvent(new win.Event('load'));
    await assert.rejects(mounting, { name: 'AbortError' });
    assert.equal(state.views.length, 0);
  });
});

test('stylesheet failure is retryable and never boots a partial viewer', async () => {
  await fixture(async (win, state) => {
    const { bootHistoricalDiff } = await loadBoot();
    const signal = new AbortController().signal;
    const mounting = bootHistoricalDiff(win.document.createElement('div'), {}, signal);
    win.document.querySelector('link').dispatchEvent(new win.Event('error'));
    await assert.rejects(mounting, /stylesheet failed/);
    assert.equal(state.views.length, 0);
    const retry = bootHistoricalDiff(win.document.createElement('div'), {}, signal);
    win.document.querySelector('link').dispatchEvent(new win.Event('load'));
    await retry;
    assert.equal(state.views.length, 1);
  });
});

test('bootstrap source keeps lexical-only branch separate from service contributions', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../scripts/build_monaco_bootstrap_bundle.mjs'), 'utf8');
  assert.match(source, /else if \(options.basicLanguagesOnly === true\)\s*\{[^}]*await ensureBasicLanguageContributions\(\)/);
  const basic = source.slice(source.indexOf('function ensureBasicLanguageContributions'), source.indexOf('function ensureLanguageContributions'));
  assert.match(basic, /@te2-contrib-basic/);
  assert.doesNotMatch(basic, /@te2-contrib-(typescript|json|html|css)/);
});
