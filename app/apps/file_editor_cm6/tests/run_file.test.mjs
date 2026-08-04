import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { Window } from 'happy-dom';

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

async function importMenuCore() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'main_page/frontend/ui/menu-core.ts')],
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

test('explicit profile selection survives draft confirmation', async () => {
  installDialog({
    status: 'accepted',
    action: 'run',
    values: { suppressWarning: false },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    {
      ok: true,
      data: {
        action: 'confirmDraftSave',
        profileId: 'backend-b',
        confirmationKey: 'confirm-backend-b',
      },
    },
    { ok: true, data: { action: 'runProfile', message: 'backend-b started' } },
  ]);

  await createRunFileController(state.deps).runCurrentFile({ profileId: 'backend-b' });

  assert.deepEqual(state.calls, [
    { path: '/project/main.py', profileId: 'backend-b' },
    {
      path: '/project/main.py',
      profileId: 'backend-b',
      confirmDraftSave: true,
      draftSaveConfirmationKey: 'confirm-backend-b',
      suppressSaveWarning: false,
    },
  ]);
});

test('overlapping owners open the selector and run the chosen profile', async () => {
  installDialog({
    status: 'accepted',
    action: 'continue',
    values: {
      selection: { kind: 'profile', profileId: 'backend-b', running: false },
    },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    {
      ok: true,
      data: {
        action: 'selectRunProfile',
        candidates: [
          { profileId: 'backend-a', runner: 'python', running: false },
          { profileId: 'backend-b', runner: 'python', running: false },
        ],
      },
    },
    { ok: true, data: { action: 'runProfile', message: 'backend-b started' } },
  ]);

  await createRunFileController(state.deps).runCurrentFile();

  assert.deepEqual(state.calls, [
    { path: '/project/main.py' },
    { path: '/project/main.py', profileId: 'backend-b' },
  ]);
});

test('forced selector can run a non-owning profile', async () => {
  installDialog({
    status: 'accepted',
    action: 'continue',
    values: {
      selection: { kind: 'profile', profileId: 'test-backend', running: false },
    },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    { ok: true, data: { action: 'runProfile', message: 'test-backend started' } },
  ], {
    stateResponses: [{
      ok: true,
      data: {
        candidates: [{
          profileId: 'test-backend',
          runner: 'custom',
          ownsActiveFile: false,
          running: false,
        }],
      },
    }],
  });

  await createRunFileController(state.deps).showProfileSelector();

  assert.deepEqual(state.stateCalls, [{
    path: '/project/main.py',
    includeAllProfiles: true,
  }]);
  assert.deepEqual(state.calls, [{
    path: '/project/main.py',
    profileId: 'test-backend',
  }]);
});

test('forced selector can explicitly bypass profiles and run the current file', async () => {
  installDialog({
    status: 'accepted',
    action: 'continue',
    values: { selection: { kind: 'currentFile' } },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([
    { ok: true, data: { action: 'terminal', message: 'current file started' } },
  ], {
    stateResponses: [{ ok: true, data: { candidates: [] } }],
  });

  await createRunFileController(state.deps).showProfileSelector();

  assert.deepEqual(state.calls, [{
    path: '/project/main.py',
    runCurrentFile: true,
  }]);
});

test('cancelling profile selection sends no selected run request', async () => {
  installDialog({ status: 'cancelled', action: 'cancel', values: {} });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([{
    ok: true,
    data: {
      action: 'selectRunProfile',
      candidates: [
        { profileId: 'backend-a', runner: 'python', running: false },
        { profileId: 'backend-b', runner: 'python', running: false },
      ],
    },
  }]);

  await createRunFileController(state.deps).runCurrentFile();

  assert.deepEqual(state.calls, [{ path: '/project/main.py' }]);
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
  assert.deepEqual(state.stopCalls, [{
    path: '/project/main.py',
    profileId: 'python',
  }]);
  assert.equal(state.stateCalls.length, 1);
  assert.equal(state.buttonStates.at(-1).running, false);
  assert.deepEqual(state.toasts, ["Run profile 'python' stopped"]);
});

test('multiple running owners require an exact Stop selection', async () => {
  installDialog({
    status: 'accepted',
    action: 'continue',
    values: {
      selection: { kind: 'profile', profileId: 'backend-b', running: true },
    },
  });
  const { createRunFileController } = await importRunFileController();
  const state = controllerDeps([], {
    stopResponses: [{
      ok: true,
      data: {
        stopped: true,
        running: false,
        profileId: 'backend-b',
        message: 'backend-b stopped',
      },
    }],
  });
  const controller = createRunFileController(state.deps);
  controller.applyProjection({
    path: '/project/main.py',
    matched: true,
    running: true,
    profileId: '',
    candidates: [
      { profileId: 'backend-a', runner: 'python', running: true },
      { profileId: 'backend-b', runner: 'python', running: true },
    ],
  });

  await controller.runOrStop();

  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.stopCalls, [{
    path: '/project/main.py',
    profileId: 'backend-b',
  }]);
});

test('Play context-menu and touch long-press open forced profile selection', async () => {
  const window = new Window({ url: 'http://127.0.0.1/app' });
  const button = window.document.createElement('button');
  window.document.body.appendChild(button);
  const { installRunButtonInteractions } = await importMenuCore();
  let primaryCalls = 0;
  let selectorCalls = 0;
  installRunButtonInteractions(
    button,
    () => { primaryCalls += 1; },
    () => { selectorCalls += 1; },
    { longPressMs: 10, suppressClickMs: 50 },
  );

  button.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(selectorCalls, 1);

  button.dispatchEvent(new window.PointerEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    button: 0,
    clientX: 10,
    clientY: 10,
    bubbles: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  button.dispatchEvent(new window.PointerEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    bubbles: true,
  }));
  button.click();

  assert.equal(selectorCalls, 2);
  assert.equal(primaryCalls, 0);
  window.close();
});
