import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { build } from 'esbuild';

async function importModule(relative) {
  const result = await build({ entryPoints: [new URL(`../${relative}`, import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'browser' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('vendored and installed copies of a Primer theme use identical styling data', async () => {
  const { vscodeThemeToMonacoTheme } = await importModule('monaco_editor/editor_theme_convert_utils.ts');
  const json = JSON.parse(await fs.readFile(new URL('../monaco_editor/themes/vendored/github/dark.json', import.meta.url), 'utf8'));
  const builtin = vscodeThemeToMonacoTheme('github-dark', json);
  const installed = vscodeThemeToMonacoTheme('ext:github.github-vscode-theme:github-dark', { ...json, uiTheme: 'vs-dark' });
  assert.deepEqual(builtin, installed);
  assert.equal(builtin.base, 'vs-dark');
});

test('catalog uiTheme determines high-contrast Monaco base for static themes', async () => {
  const { applyMonacoThemeRuntime } = await importModule('monaco_editor/editor_theme_apply_runtime_utils.ts');
  const { vscodeThemeToMonacoTheme } = await importModule('monaco_editor/editor_theme_convert_utils.ts');
  const defined = [];
  await applyMonacoThemeRuntime({
    win: { monaco: { editor: { defineTheme: (...args) => defined.push(args), setTheme() {} } } },
    doc: { documentElement: { classList: { remove() {}, add() {} } } },
    getSelectedThemeFn: async () => ({ id: 'github-dark-high-contrast', uiTheme: 'hc-black', theme: { tokenColors: [] } }),
    toMonacoThemeFn: vscodeThemeToMonacoTheme,
  });
  assert.equal(defined[0][1].base, 'hc-black');
});

test('semantic selectors retain modifiers, language, and font-style overrides', async () => {
  const { vscodeThemeToMonacoTheme } = await importModule('monaco_editor/editor_theme_convert_utils.ts');
  const theme = vscodeThemeToMonacoTheme('fixture', {
    uiTheme: 'vs-dark', tokenColors: [],
    semanticTokenColors: {
      'variable.readonly:python': { foreground: '#aBc', bold: true, italic: false },
      '*.deprecated': { fontStyle: 'strikethrough' },
    },
  });
  assert.deepEqual({ ...theme.semanticTokenColors }, {
    'variable.readonly:python': { foreground: '#AABBCC', bold: true, italic: false },
    '*.deprecated': { fontStyle: 'strikethrough' },
  });
  assert.deepEqual(theme.encodedTokensColors, ['#AABBCC']);
});

test('semantic foreground palette excludes invalid colors and deduplicates shared colors', async () => {
  const { semanticTokenForegrounds } = await importModule('monaco_editor/editor_semantic_theme_utils.ts');
  assert.deepEqual(semanticTokenForegrounds({
    class: '#abc', 'class:python': { foreground: '#AABBCC', italic: true },
    function: '#12345', property: { bold: false },
  }), ['#AABBCC']);
});

test('published Monaco matcher scores modifier, language, and inherited type selectors', async () => {
  const { parseStandaloneSemanticTokenRules } = await importModule(
    '../../static/vendor/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneSemanticTokenRules.js'
  );
  const [generic, specific, inherited] = parseStandaloneSemanticTokenRules({
    variable: '#123456', 'variable.readonly:python': { foreground: '#AABBCC', bold: true },
    method: { fontStyle: 'strikethrough' },
  });
  assert.equal(generic.match('variable', ['readonly'], 'python'), 100);
  assert.equal(specific.match('variable', ['readonly'], 'python'), 210);
  assert.equal(specific.match('variable', ['readonly'], 'javascript'), -1);
  assert.equal(inherited.match('member', [], 'python'), 99);
  assert.equal(inherited.style.strikethrough, true);
  assert.equal(inherited.style.bold, false);
});

test('theme URLs come only from catalog metadata for both sources', async () => {
  const { getVscodeThemeJsonUrl } = await importModule('monaco_editor/editor_theme_url_utils.ts');
  const catalog = {
    'github-dark': { serveUrl: 'monaco_editor/themes/vendored/github/dark.json' },
    'ext:primer:dark': { serveUrl: 'monaco_editor/cs_themes/primer/dark.json' },
  };
  assert.equal(getVscodeThemeJsonUrl('github-dark', catalog, '/api/app/code_te2'),
    '/api/app/code_te2/ui/monaco_editor/themes/vendored/github/dark.json');
  assert.equal(getVscodeThemeJsonUrl('ext:primer:dark', catalog, '/api/app/code_te2'),
    '/api/app/code_te2/ui/monaco_editor/cs_themes/primer/dark.json');
  assert.equal(getVscodeThemeJsonUrl('github-dark', {}, '/api/app/code_te2'), null);
});
