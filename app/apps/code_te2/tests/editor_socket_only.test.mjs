import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
async function load(entry) {
  const result = await build({ entryPoints: [path.join(root, entry)], bundle: true,
    format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('preferences use RPC for reads/writes and never fall back to HTTP', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', () => { throw Error('HTTP forbidden'); });
  const oldElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  t.after(() => { globalThis.HTMLElement = oldElement; });
  const { createPreferencesController } = await load('main_page/frontend/ui/preferences.ts');
  let state, fail = false;
  const calls = [];
  const controller = createPreferencesController({
    requestBackendEditorStateGet: async () => ({ view_state: { fontScale: 0.85 } }),
    requestBackendEditorPreferenceUpdate: async (payload) => {
      if (fail) throw Error('disconnected');
      calls.push(payload);
      return { ok: true, data: { wordWrap: true } };
    },
    apiPost: () => { throw Error('HTTP fallback forbidden'); },
    getClientId: () => null, setEditorViewState: (s) => { state = s; },
    getMenuItems: () => ({}), setMenuChecked() {}, applyFontScale() {},
  });
  await controller.refreshMenuState();
  assert.deepEqual(state, { fontScale: 0.85 });
  assert.equal(await controller.updatePreference('wordWrap', true), true);
  assert.deepEqual(calls, [{ key: 'wordWrap', value: true }]);
  fail = true;
  assert.equal(await controller.updatePreference('wordWrap', false), false);
  assert.deepEqual(state, { wordWrap: true });
});

test('Monaco configuration updates use the editor RPC callback', async () => {
  const { onEditorConfigChanged } = await load('monaco_editor/editor_config_change_utils.ts');
  const calls = [];
  onEditorConfigChanged({ getOption: () => true }, {
    lastKnownReadOnly: false, monacoRef: { editor: { EditorOption: { readOnly: 1 } } },
    updatePreference: async (payload) => { calls.push(payload); },
  });
  assert.deepEqual(calls, [{ key: 'readOnly', value: true }]);
});

test('session telemetry reads and persists over host RPC', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('HTTP forbidden'); });
  const { createSessionTelemetryController } = await load('main_page/frontend/boot/session-telemetry.ts');
  const writes = [];
  const controller = createSessionTelemetryController({
    requestState: async () => ({ session_state: { currentPath: '/p/a', unsaved: false } }),
    updateSession: async (data) => { writes.push({ ...data }); },
    getActiveProjectFallback: () => '/p', getCurrentPath: () => '/p/a',
    getLastSha256: () => 'sha', getUnsaved: () => false,
  });
  await controller.fetchPersistedSessionState();
  controller.initSessionStateContext({ activeProject: '/p' });
  controller.syncSessionPath();
  await controller.flushSessionState(true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].currentPath, '/p/a');
});

test('save does not report success or clear dirty state when RPC fails', async () => {
  const { createSaveFlowController } = await load('main_page/frontend/file-ops/save-flow.ts');
  let cleared = false;
  const controller = createSaveFlowController({
    clientId: 'test', getLastSha256: () => 'old', setStatus() {}, toast() {},
    markUnsaved: () => { cleared = true; },
    saveFileViaEditorSocket: async () => { throw Error('disconnected'); },
    apiPost: () => { throw Error('HTTP fallback forbidden'); },
  });
  assert.equal(await controller.saveFile({ currentPath: '/p/a', currentPathExists: true }), false);
  assert.equal(cleared, false);
  assert.equal('doSave' in controller, false);
});

test('persistence callers contain no HTTP paths or fallback branches', () => {
  for (const entry of [
    'main_page/frontend/ui/preferences.ts', 'main_page/frontend/boot/session-telemetry.ts',
    'main_page/frontend/file-ops/save-flow.ts', 'main_page/frontend/ui/menu-actions-advanced.ts',
    'main_page/frontend/host-chrome-runtime.ts', 'monaco_editor/editor_config_change_utils.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, entry), 'utf8');
    assert.doesNotMatch(source, /\bfetch\(|deps\.api(?:Post|Get)\(/, entry);
  }
});
