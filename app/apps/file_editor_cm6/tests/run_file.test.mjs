import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('Run state is projection-driven without a scheduled query loop', async () => {
  const source = fs.readFileSync(
    path.join(appRoot, 'main_page/frontend/file-ops/run-file.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /RUN_STATE_POLL|schedulePoll|pollTimer|setInterval|setTimeout/);

  installDialog({ status: 'closed', action: null, values: {} });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([]);
  const controller = createRunFileController(state.deps);
  controller.applyProjection({
    path: '/project/main.py',
    matched: true,
    running: true,
    profileId: 'python',
  });

  assert.equal(state.stateCalls.length, 0);
  assert.equal(state.buttonStates.at(-1).running, true);
  assert.equal(state.buttonStates.at(-1).profileId, 'python');
});

function installDialog(result) {
  globalThis.window = {
    teUI: {
      dialog: {
        open: async () => result,
      },
    },
  };
}

function controllerDeps(
  responses,
  {
    stateResponses = [{ ok: true, data: { matched: true, running: false } }],
    stopResponses = [],
  } = {},
) {
  const calls = [];
  const stateCalls = [];
  const stopCalls = [];
  const toasts = [];
  const buttonStates = [];
  return {
    calls,
    stateCalls,
    stopCalls,
    buttonStates,
    toasts,
    deps: {
      getCurrentPath: () => '/project/main.py',
      apiPost: async () => {
        throw new Error('legacy HTTP fallback should not be used');
      },
      requestBackendRunActiveFile: async (payload) => {
        calls.push(payload);
        return responses.shift();
      },
      requestBackendRunProfileState: async (payload) => {
        stateCalls.push(payload);
        return stateResponses.shift()
          ?? { ok: true, data: { matched: true, running: false } };
      },
      requestBackendRunProfileStop: async (payload) => {
        stopCalls.push(payload);
        return stopResponses.shift()
          ?? { ok: true, data: { stopped: true, running: false } };
      },
      setRunButtonState: (state) => buttonStates.push(state),
      toast: (message) => toasts.push(message),
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
  assert.equal(state.buttonStates[0].busy, true);
  assert.equal(state.buttonStates.at(-1).disabled, false);
  assert.equal(state.buttonStates.at(-1).running, false);
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
  assert.equal(state.buttonStates[0].busy, true);
  assert.equal(state.buttonStates.at(-1).disabled, false);
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

test('running profile changes Play to Stop and terminates the exact profile', async () => {
  installDialog({ status: 'closed', action: null, values: {} });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([], {
    stateResponses: [
      {
        ok: true,
        data: {
          matched: true,
          running: true,
          profileId: 'python',
          shellId: 'shell-123',
        },
      },
      {
        ok: true,
        data: { matched: true, running: false, profileId: 'python' },
      },
    ],
    stopResponses: [{
      ok: true,
      data: {
        stopped: true,
        running: false,
        message: "Run profile 'python' stopped",
      },
    }],
  });
  const controller = createRunFileController(state.deps);

  await controller.refreshState();
  assert.equal(state.buttonStates.at(-1).running, true);
  assert.equal(state.buttonStates.at(-1).profileId, 'python');

  await controller.runOrStop();

  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.stopCalls, [{ path: '/project/main.py' }]);
  assert.equal(state.stateCalls.length, 1);
  assert.equal(state.buttonStates.at(-1).running, false);
  assert.deepEqual(state.toasts, ["Run profile 'python' stopped"]);
});
