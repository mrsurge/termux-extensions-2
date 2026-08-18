import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('editor state refresh is single-flight and preserves the last valid projection', async () => {
  const { createEditorStateController } = await importTypeScript(
    'main_page/frontend/boot/editor-state.ts',
  );
  const previousWindow = globalThis.window;
  const previousConsoleError = console.error;
  globalThis.window = {};
  console.error = () => {};
  try {
    const request = deferred();
    const validState = {
      activeProject: '/workspace',
      activeProjectExists: true,
    };
    let editorState = validState;
    let cachedProject = '/workspace';
    let calls = 0;
    const controller = createEditorStateController({
      getEditorState: () => editorState,
      setEditorState: (value) => { editorState = value; },
      getCachedProjectRoot: () => cachedProject,
      setCachedProjectRoot: (value) => { cachedProject = value; },
      getCurrentPath: () => null,
      setCurrentPath: () => {},
      requestBackendBootSnapshot: (payload) => {
        calls += 1;
        assert.deepEqual(payload, { scope: 'hostState' });
        return request.promise;
      },
      requestBackendEditorGitBaselines: async () => ({}),
      getEditorViewState: () => null,
      updatePreference: async () => true,
      openFile: async () => {},
    });

    const first = controller.syncEditorState(true);
    const second = controller.syncEditorState(true);
    assert.equal(calls, 1);
    request.reject(new Error('snapshot timeout'));
    assert.equal(await first, validState);
    assert.equal(await second, validState);
    assert.equal(editorState, validState);
    assert.equal(cachedProject, '/workspace');
  } finally {
    globalThis.window = previousWindow;
    console.error = previousConsoleError;
  }
});
