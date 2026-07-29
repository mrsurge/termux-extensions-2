import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importRunFileController() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'main_page/frontend/file-ops/run-file.ts')],
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

function installDialog(result) {
  globalThis.window = {
    teUI: {
      dialog: {
        open: async () => result,
      },
    },
  };
}

function controllerDeps(responses) {
  const calls = [];
  const toasts = [];
  const disabled = [];
  return {
    calls,
    disabled,
    toasts,
    deps: {
      getCurrentPath: () => '/project/main.py',
      setRunButtonDisabled: (value) => disabled.push(value),
      apiPost: async () => {
        throw new Error('legacy HTTP fallback should not be used');
      },
      requestBackendRunActiveFile: async (payload) => {
        calls.push(payload);
        return responses.shift();
      },
      toast: (message) => toasts.push(message),
      updateRunButtonState: () => disabled.push(false),
    },
  };
}

test('Run confirmation resubmits with warning suppression intent', async () => {
  installDialog({
    status: 'accepted',
    action: 'run',
    values: { suppressWarning: true },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    {
      ok: true,
      data: {
        action: 'confirmDraftSave',
        profileId: 'python',
        confirmationKey: 'confirm-python-included',
        message: 'Save drafts before running?',
        detail: 'Included drafts will be saved.',
      },
    },
    {
      ok: true,
      data: {
        action: 'runProfile',
        message: "Run profile 'python' started",
      },
    },
  ]);

  await createRunFileController(state.deps).runCurrentFile();

  assert.deepEqual(state.calls, [
    { path: '/project/main.py' },
    {
      path: '/project/main.py',
      confirmDraftSave: true,
      draftSaveConfirmationKey: 'confirm-python-included',
      suppressSaveWarning: true,
    },
  ]);
  assert.deepEqual(state.toasts, ["Run profile 'python' started"]);
  assert.deepEqual(state.disabled, [true, false]);
});

test('cancelling the warning does not issue an execution request', async () => {
  installDialog({
    status: 'cancelled',
    action: 'cancel',
    values: { suppressWarning: false },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    {
      ok: true,
      data: {
        action: 'confirmDraftSave',
        profileId: null,
      },
    },
  ]);

  await createRunFileController(state.deps).runCurrentFile();

  assert.deepEqual(state.calls, [{ path: '/project/main.py' }]);
  assert.deepEqual(state.toasts, []);
  assert.deepEqual(state.disabled, [true, false]);
});

test('suppressed warnings keep Run on one backend request', async () => {
  installDialog({
    status: 'closed',
    action: null,
    values: {},
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    {
      ok: true,
      data: {
        action: 'terminal',
        message: 'Running active file in terminal',
      },
    },
  ]);

  await createRunFileController(state.deps).runCurrentFile();

  assert.deepEqual(state.calls, [{ path: '/project/main.py' }]);
  assert.deepEqual(state.toasts, ['Running active file in terminal']);
});
