import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importController() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'main_page/frontend/ui/cache-indicator.ts')],
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

function clickEvent() {
  return {
    preventDefault() {},
    stopPropagation() {},
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDeps(overrides = {}) {
  const discards = [];
  const toasts = [];
  return {
    discards,
    toasts,
    deps: {
      getCurrentPath: () => '/workspace/draft.py',
      getCachedProjectRoot: () => '/workspace',
      getCurrentProjectRoot: async () => '/workspace',
      confirmDiscard: async () => false,
      discardDraft: async (payload) => {
        discards.push(payload);
      },
      toast: (message) => {
        toasts.push(message);
      },
      markUnsaved: () => {},
      getRestoredSessionActive: () => false,
      ...overrides,
    },
  };
}

test('cancelling draft-indicator confirmation leaves the draft untouched', async () => {
  const { createCacheIndicatorController } = await importController();
  const state = createDeps();

  await createCacheIndicatorController(state.deps).handleDiscardClick(clickEvent());

  assert.deepEqual(state.discards, []);
  assert.deepEqual(state.toasts, []);
});

test('confirming draft-indicator warning preserves the backend discard contract', async () => {
  const { createCacheIndicatorController } = await importController();
  const confirmedPaths = [];
  const state = createDeps({
    confirmDiscard: async (pathValue) => {
      confirmedPaths.push(pathValue);
      return true;
    },
  });

  await createCacheIndicatorController(state.deps).handleDiscardClick(clickEvent());

  assert.deepEqual(confirmedPaths, ['/workspace/draft.py']);
  assert.deepEqual(state.discards, [{
    project: '/workspace',
    path: '/workspace/draft.py',
    source: 'host_cache_indicator',
  }]);
  assert.deepEqual(state.toasts, ['Draft discarded']);
});

test('draft-indicator confirmation is single-flight across rapid taps', async () => {
  const { createCacheIndicatorController } = await importController();
  const confirmation = deferred();
  let confirmationCalls = 0;
  const state = createDeps({
    confirmDiscard: async () => {
      confirmationCalls += 1;
      return confirmation.promise;
    },
  });
  const controller = createCacheIndicatorController(state.deps);

  const first = controller.handleDiscardClick(clickEvent());
  const second = controller.handleDiscardClick(clickEvent());
  assert.equal(confirmationCalls, 1);

  confirmation.resolve(false);
  await Promise.all([first, second]);
  assert.deepEqual(state.discards, []);
});
