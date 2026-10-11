import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const result = await build({ stdin: { contents: `export * from './monaco_editor/editor_theme_apply_runtime_utils.ts'; export * from './monaco_editor/editor_textmate_theme_owner_runtime.ts';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('cold theme restore publishes one selected theme and container palette, never the cache map', async () => {
  const window = new Window(); window.monaco = { editor: { setTheme() {}, defineTheme() {} } };
  const theme = { colors: { 'editor.background': '#ffffff', 'editor.foreground': '#24292e', 'diffEditor.insertedLineBackground': '#00ff0020' }, tokenColors: [] };
  let loaded;
  const owner = api.createEditorTextmateThemeOwnerRuntime({ getWindow: () => window, getDocument: () => window.document,
    ensureTe2DiffTheme() {}, applyMonacoThemeRuntime: api.applyMonacoThemeRuntime,
    getSelectedTheme: async () => ({ id: 'extension-light', uiTheme: 'vs', theme }),
    vscodeThemeToMonacoTheme: () => ({}), onThemeJsonLoaded: value => { loaded = value; },
    getLanguageWorkersEnabled: () => true, applyThemeToTextmateRegistry() {}, normalizeLanguage: String,
    languageFromPath: () => 'plaintext', ensureWorkbenchLanguageCatalogInstalled: async () => true,
    ensureTextmateTokenization: async () => true, installWorkbenchLanguageBridgeProviders() {} });
  await owner.applyTheme('extension-light');
  assert.equal(loaded.colors['editor.background'], '#ffffff');
  assert.equal(loaded['extension-light'], undefined);
  assert.equal(owner.getThemeJsonCache()['extension-light'], loaded);
  assert.equal(window.document.documentElement.style.getPropertyValue('--te2-code-background'), '#ffffff');
  assert.equal(window.document.documentElement.style.getPropertyValue('--te2-code-inserted'), '#00ff0020');
  window.close();
});
