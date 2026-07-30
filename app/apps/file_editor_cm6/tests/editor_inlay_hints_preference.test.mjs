import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importModule(entry) {
  const result = await build({
    entryPoints: [path.join(appRoot, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

test('Monaco inlay hints follow the persisted editor preference', async () => {
  const { buildMonacoOptionsFromPrefsState } = await importModule(
    'monaco_editor/editor_monaco_options_utils.ts',
  );

  const enabled = buildMonacoOptionsFromPrefsState({
    preferences: { editor: { showInlayHints: true } },
  }, {});
  const disabled = buildMonacoOptionsFromPrefsState({
    preferences: { editor: { showInlayHints: false } },
  }, {});
  const defaulted = buildMonacoOptionsFromPrefsState({
    preferences: { editor: {} },
  }, {});

  assert.deepEqual(enabled.inlayHints, { enabled: 'on' });
  assert.deepEqual(disabled.inlayHints, { enabled: 'off' });
  assert.deepEqual(defaulted.inlayHints, { enabled: 'on' });
});

test('Editor menu toggles the inlay hints preference', async () => {
  const { installSimplePreferenceMenuActions } = await importModule(
    'main_page/frontend/ui/menu-actions-preferences.ts',
  );
  const actions = new Map();
  const updates = [];
  const inlayHintsItem = {};

  installSimplePreferenceMenuActions({
    bindMenuToggle: (element, action) => actions.set(element, action),
    els: {
      miToggleLines: {},
      miToggleShading: {},
      miToggleIndentGuides: {},
      miToggleSyntax: {},
      miToggleCloseBrackets: {},
      miToggleAutocomplete: {},
      miToggleInlayHints: inlayHintsItem,
      miToggleWrap: {},
      miToggleColorPicker: {},
      miToggleMinimap: {},
      miToggleStickyScroll: {},
    },
    getEditorViewState: () => ({ showInlayHints: true }),
    updatePreference: async (key, value) => {
      updates.push([key, value]);
      return true;
    },
    toast: () => {},
  });

  await actions.get(inlayHintsItem)();
  assert.deepEqual(updates, [['showInlayHints', false]]);
});
