import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundle = await build({ entryPoints: [import.meta.dirname + '/../monaco_editor/historical_appearance.ts'],
  bundle: true, write: false, format: 'esm', platform: 'browser' });
const { historicalAppearance, createHistoricalThemeApplier } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('historical contribution refresh reloads unchanged theme bytes and falls back after removal', async () => {
  const win = new Window();
  const previous = globalThis.document;
  globalThis.document = win.document;
  try {
    let installed = true, catalogCalls = 0;
    const urls = [], colors = [];
    const apply = createHistoricalThemeApplier({ editor: {
      defineTheme: (name, value) => colors.push(value.colors['editor.background']),
      setTheme: () => {},
    } }, new AbortController().signal, async () => {
      catalogCalls++;
      return { themes: [ ...(installed ? ['ext:theme'] : []), 'github-dark-default' ].map(id => ({
        id, label: id, uiTheme: 'vs-dark', source: 'vendored', sourceLabel: 'test',
        serveUrl: `monaco_editor/themes/${id}.json`,
      })) };
    }, async url => {
      urls.push(url);
      return { ok: true, json: async () => ({ colors: { 'editor.background': installed ? '#123456' : '#654321' } }) };
    });
    await apply('ext:theme');
    await apply('ext:theme');
    assert.equal(urls.length, 1);
    await apply('ext:theme', true);
    assert.equal(urls.length, 2);
    installed = false;
    await apply('ext:theme', true);
    assert.ok(urls[2].endsWith('github-dark-default.json'));
    assert.equal(catalogCalls, 3);
    assert.deepEqual(colors, ['#123456', '#123456', '#654321']);
  } finally { globalThis.document = previous; }
});

test('historical appearance shares font scaling and cannot enable mutation/intelligence', () => {
  const { appearance, theme } = historicalAppearance({ editor: {
    fontScale: 1.5, fontFamily: 'custom', theme: 'github-light', readOnly: false,
    autocompletion: true, showInlayHints: true, wordWrap: true, showLineNumbers: false,
    cursorStyle: 'block-outline',
  } });
  assert.deepEqual(appearance, { fontSize: 21, fontFamily: 'custom', fontLigatures: true,
    lineNumbers: 'off', wordWrap: 'on', cursorStyle: 'block-outline' });
  assert.equal(theme, 'github-light');
  assert.equal(historicalAppearance({}).appearance.fontSize, 12);
  assert.equal(historicalAppearance({}).theme, 'github-dark-default');
  assert.equal(historicalAppearance({ preferences: { editor: { fontScale: 18 } } }).appearance.fontSize, 18);
});

test('out-of-order theme loads and disposed viewers cannot publish stale colors', async () => {
  const win = new Window();
  const previous = globalThis.document;
  globalThis.document = win.document;
  const calls = [];
  const pending = new Map();
  const fakeFetch = async url => {
    return new Promise(resolve => pending.set(url, resolve));
  };
  const controller = new AbortController();
  const apply = createHistoricalThemeApplier({ editor: {
    defineTheme: name => calls.push(['define', name]), setTheme: name => calls.push(['set', name]),
  } }, controller.signal, async () => ({ themes: [
    ['github-dark', 'dark.json'], ['github-light', 'light.json'], ['github-dark-dimmed', 'dark-dimmed.json'],
  ].map(([id, file]) => ({ id, label: id, uiTheme: id === 'github-light' ? 'vs' : 'vs-dark',
    source: 'vendored', sourceLabel: 'GitHub', serveUrl: `monaco_editor/themes/vendored/github/${file}` })) }), fakeFetch);
  const resolve = (suffix) => {
    const key = [...pending.keys()].find(key => key.endsWith(suffix));
    assert.ok(key);
    pending.get(key)({ ok: true, json: async () => ({ tokenColors: [], colors: {} }) });
  };
  try {
    const dark = apply('github-dark');
    await new Promise(resolve => setImmediate(resolve));
    const light = apply('github-light');
    await new Promise(resolve => setImmediate(resolve));
    resolve('/light.json'); await light;
    resolve('/dark.json'); await dark;
    assert.deepEqual(calls, [['define', 'github-light'], ['set', 'github-light']]);
    assert.ok(win.document.documentElement.classList.contains('vs'));
    const dim = apply('github-dark-dimmed');
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(); resolve('/dark-dimmed.json'); await dim;
    assert.equal(calls.length, 2);
  } finally {
    if (previous) globalThis.document = previous; else delete globalThis.document;
    await win.happyDOM.close();
  }
});
