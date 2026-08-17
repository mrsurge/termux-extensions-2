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

test('file open delegates authority to Python without a host snapshot preflight', async () => {
  const { createOpenFlowController } = await importTypeScript(
    'main_page/frontend/file-ops/open-flow.ts',
  );
  const backendRequests = [];
  const completions = [];
  const websocketPaths = [];
  const controller = createOpenFlowController({
    setStatus: () => {},
    toAbsolute: (value, base) => base ? `${base}/${value}` : value,
    homeDir: '/home/test',
    getRestoredSessionActive: () => false,
    getCurrentPath: () => null,
    setRestoredSessionActive: () => {},
    setIndicatorInactive: () => {},
    setCurrentPath: () => {},
    setCurrentPathExists: () => {},
    setLastPickerPath: () => {},
    parentDir: () => '',
    setCurrentModeLanguage: () => {},
    detectLanguageFromFilename: () => null,
    setLastSha256: () => {},
    requestBackendOpen: async (payload) => {
      backendRequests.push(payload);
      return { path: '/workspace/canonical/file.py' };
    },
    awaitEditorOpen: async (requestId, filePath) => {
      completions.push({ requestId, filePath });
    },
    setLastSavedContent: () => {},
    markUnsaved: () => {},
    updatePathDisplay: () => {},
    syncSessionPath: () => {},
    getCachedProjectRoot: () => null,
    dispatchExplorerActiveFile: () => {},
    openWebSocket: (filePath) => { websocketPaths.push(filePath); },
    jumpToCurrentFileLine: () => {},
    toast: () => {},
  });

  await controller.openFile('relative/file.py');

  assert.equal(backendRequests.length, 1);
  assert.equal(backendRequests[0].path, 'relative/file.py');
  assert.equal(completions.length, 1);
  assert.equal(completions[0].filePath, '/workspace/canonical/file.py');
  assert.deepEqual(websocketPaths, ['/workspace/canonical/file.py']);
});
