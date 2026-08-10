import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importBootSequence() {
  const result = await build({
    entryPoints: [
      path.join(appRoot, 'main_page/frontend/boot/boot-sequence.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`
  );
}

test('managed Code Server is rechecked before a stale missing snapshot can prompt', async () => {
  let dialogCalls = 0;
  globalThis.window = {
    teUI: {
      dialog: {
        open: async () => {
          dialogCalls += 1;
          throw new Error('the install dialog must not open');
        },
      },
    },
  };
  const { prepareCodeServer } = await importBootSequence();
  const seeded = [];
  let backendSetCalls = 0;
  const snapshot = {
    ui_prefs: { webWorkersEnabled: false },
    code_server: { compatible: false, state: 'missing' },
  };

  const ready = await prepareCodeServer(
    snapshot,
    snapshot.ui_prefs,
    {
      requestBackendBootSnapshot: async () => ({
        ok: true,
        snapshot: {
          ui_prefs: { webWorkersEnabled: false },
          code_server: {
            compatible: true,
            state: 'ready',
            executable: '/data/te2/code_server/4.130.0/bin/code-server',
          },
        },
      }),
      requestBackendLanguageBackendSet: async () => {
        backendSetCalls += 1;
        return { ok: true };
      },
      seedUiPrefsSnapshot: (value) => seeded.push({ ...value }),
      spinnerSetStep: () => {},
    },
  );

  assert.equal(ready, true);
  assert.equal(dialogCalls, 0);
  assert.equal(backendSetCalls, 0);
  assert.equal(snapshot.code_server.compatible, true);
  assert.deepEqual(seeded, [{ webWorkersEnabled: false }]);
});
