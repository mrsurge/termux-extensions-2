import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

async function importModule(entry) {
  const result = await build({
    entryPoints: [path.join(appRoot, entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const publicId = 'ext:vscode.theme-kimbie-dark:kimbie-dark-color-theme';

test('public extension IDs map to stable legal Monaco names without changing valid names', async () => {
  const { monacoThemeName } = await importModule('monaco_editor/editor_theme_name_utils.ts');
  const internal = monacoThemeName(publicId);
  assert.match(internal, /^[a-z0-9-]+$/i);
  assert.equal(monacoThemeName(publicId), internal);
  assert.notEqual(monacoThemeName('ext:a.b:dark'), monacoThemeName('ext:a-b:dark'));
  assert.equal(monacoThemeName('github-dark'), 'github-dark');
});

test('main editor loads and applies extension theme using its internal name', async () => {
  const { monacoThemeName } = await importModule('monaco_editor/editor_theme_name_utils.ts');
  const { applyMonacoThemeRuntime } = await importModule('monaco_editor/editor_theme_apply_runtime_utils.ts');
  const defined = [];
  const selected = [];
  const classes = new Set();
  const editor = {
    defineTheme(name) {
      assert.match(name, /^[a-z0-9-]+$/i);
      defined.push(name);
    },
    setTheme(name) { selected.push(name); },
  };
  const json = { colors: { 'editor.background': '#221a0f' } };
  await applyMonacoThemeRuntime({
    win: { monaco: { editor } },
    doc: { documentElement: { classList: {
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      add: (name) => classes.add(name),
    } } },
    getSelectedThemeFn: async () => ({ id: publicId, uiTheme: 'vs-dark', theme: json }),
    toMonacoThemeFn: () => ({ base: 'vs-dark', rules: [] }),
  });
  assert.deepEqual(defined, [monacoThemeName(publicId)]);
  assert.deepEqual(selected, [monacoThemeName(publicId)]);
  assert.ok(classes.has('vs-dark'));
});

test('historical editor uses the same legal name for extension themes', async () => {
  const { monacoThemeName } = await importModule('monaco_editor/editor_theme_name_utils.ts');
  const { createHistoricalThemeApplier } = await importModule('monaco_editor/historical_appearance.ts');
  const originalDocument = globalThis.document;
  const classes = new Set();
  const defined = [];
  const selected = [];
  globalThis.document = { documentElement: { classList: {
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    add: (name) => classes.add(name),
  } } };
  try {
    const apply = createHistoricalThemeApplier(
      { editor: {
        defineTheme(name) {
          assert.match(name, /^[a-z0-9-]+$/i);
          defined.push(name);
        },
        setTheme(name) { selected.push(name); },
      } },
      new AbortController().signal,
      async () => ({ themes: [{ id: publicId, label: 'Kimbie Dark', uiTheme: 'vs-dark',
        source: 'extension', sourceLabel: 'Kimbie', serveUrl: 'monaco_editor/cs_themes/kimbie/theme.json' }] }),
      async () => ({ ok: true, json: async () => ({ colors: { 'editor.background': '#221a0f' } }) }),
    );
    await apply(publicId);
    assert.deepEqual(defined, [monacoThemeName(publicId)]);
    assert.deepEqual(selected, [monacoThemeName(publicId)]);
    assert.ok(classes.has('vs-dark'));
  } finally {
    globalThis.document = originalDocument;
  }
});

test('cold creation and plain/diff transitions retain the selected extension theme', async () => {
  const { monacoThemeName } = await importModule('monaco_editor/editor_theme_name_utils.ts');
  const { buildMonacoOptionsFromPrefsState } = await importModule('monaco_editor/editor_monaco_options_utils.ts');
  const { ensureEditorWithPrefs, ensureDiffEditorWithPrefs, ensurePlainEditorWithPrefs } =
    await importModule('monaco_editor/editor_editor_lifecycle.ts');
  const prefs = { preferences: { editor: { theme: publicId } } };
  const cache = { [publicId]: { colors: { 'editor.background': '#221a0f' } } };
  const creationThemes = [];
  const appliedPublicIds = [];
  let editor = null;
  let diffEditor = null;
  const makeEditor = () => ({ updateOptions() {}, dispose() {} });
  const deps = {
    getCachedPrefs: () => prefs,
    setCachedPrefs() {},
    fetchSSOTState: async () => prefs,
    buildMonacoOptionsFromPrefs: (state) => buildMonacoOptionsFromPrefsState(state, cache),
    getMonaco: () => ({ editor: {
      create: (_container, options) => {
        creationThemes.push(options.theme);
        return makeEditor();
      },
      createDiffEditor: () => {
        const modified = makeEditor();
        const original = makeEditor();
        return { getModifiedEditor: () => modified, getOriginalEditor: () => original,
          setModel() {}, dispose() {} };
      },
    } }),
    getEditorContainer: () => ({}),
    getEditor: () => editor,
    setEditor: (value) => { editor = value; },
    getDiffEditor: () => diffEditor,
    setDiffEditor: (value) => { diffEditor = value; },
    getModel: () => null,
    getCurrentPath: () => null,
    applyMonacoTheme: (id) => { appliedPublicIds.push(id); },
    disposeMirrorPublisher() {}, setScrollPublisherInstalled() {},
    clearEditorDecorationState() {}, clearGitBaselineModels() {},
    forceSemanticHighlighting() {}, installMarkerNavBindings() {},
    ensureTouchSelection() {}, syncReadOnlyInputMode() {}, onEditorConfigChanged() {},
    updateDebug() {}, ensureLayoutObserver() {}, bindEditorHostActionHooks() {},
    installMirrorPublisher() {}, installScrollPublisher() {},
    requestBreadcrumbSymbols() {}, layoutEditors() {},
    applyLineNumberSizing() {},
  };
  await ensureEditorWithPrefs(deps);
  ensureDiffEditorWithPrefs(deps);
  ensurePlainEditorWithPrefs(deps);
  assert.deepEqual(creationThemes, [monacoThemeName(publicId), monacoThemeName(publicId)]);
  assert.ok(appliedPublicIds.includes(publicId));
  assert.ok(!appliedPublicIds.includes(monacoThemeName(publicId)));
});
