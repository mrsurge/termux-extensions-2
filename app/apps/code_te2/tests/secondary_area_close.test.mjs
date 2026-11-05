import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['main_page/frontend/secondary-area-close.ts'],
  bundle: true, write: false, format: 'esm', platform: 'browser' });
const { closeSecondaryArea } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const snapshot = () => ({ activeProject: '/project',
  openState: { projectPath: '/project', revision: 4, projectGeneration: 2 } });

test('both presentation hosts close membership before disposing the view', async () => {
  for (const host of ['mobile', 'electron']) {
    const calls = [];
    await closeSecondaryArea({
      readState: async () => { calls.push('snapshot'); return snapshot(); },
      closeMembership: async fence => { calls.push('backend'); assert.deepEqual(fence,
        { projectPath: '/project', revision: 4, projectGeneration: 2 }); },
      closePresentation: async () => { calls.push(host); },
    });
    assert.deepEqual(calls, ['snapshot', 'backend', host]);
  }
});

test('stale or failed backend close keeps the presentation alive', async () => {
  let hidden = false;
  await assert.rejects(closeSecondaryArea({ readState: async () => snapshot(),
    closeMembership: async () => { throw Error('editor_open_state_stale'); },
    closePresentation: async () => { hidden = true; },
  }), /stale/);
  assert.equal(hidden, false);
});

test('missing fences and mismatched project fail before any mutation', async () => {
  for (const state of [{}, { ...snapshot(), activeProject: '/different' },
    { activeProject: '/project', openState: { projectPath: '/project', revision: NaN, projectGeneration: 2 } }]) {
    let mutated = false;
    await assert.rejects(closeSecondaryArea({ readState: async () => state,
      closeMembership: async () => { mutated = true; }, closePresentation: async () => { mutated = true; },
    }), /Updated editor state/);
    assert.equal(mutated, false);
  }
});
