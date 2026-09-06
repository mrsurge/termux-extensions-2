import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({
  entryPoints: [new URL('../src/explorer/git/diff-base-controller.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'browser', format: 'esm',
});
const { buildDiffBaseOptions, createExplorerDiffBaseController } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

test('latest commit is one HEAD choice followed by historical commits', () => {
  const choices = buildDiffBaseOptions([
    { hash: 'new', short_hash: 'new', summary: 'New commit' },
    { hash: 'old', short_hash: 'old', summary: 'Older commit' },
  ]);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].ref, 'HEAD');
  assert.equal(choices[0].hash, 'new');
  assert.equal(choices[1].ref, 'old');
  assert.equal(buildDiffBaseOptions([])[0].ref, 'HEAD');
});

test('Git projections advance HEAD metadata and preserve a pinned selection', () => {
  globalThis.document = { querySelectorAll: () => [] };
  let refreshed = 0;
  const controller = createExplorerDiffBaseController({
    getEditorState: () => ({ activeProject: '/p', activeProjectExists: true }),
    setGitControlsEnabled() {}, isChangesMode: () => true,
    refreshChangesResults: () => { refreshed++; },
  });
  controller.applySnapshot({ ref: 'HEAD', mode: 'head', commit: { hash: 'a', short: 'a' } });
  controller.applySnapshot({ ref: 'HEAD', mode: 'head', commit: { hash: 'b', short: 'b' } });
  assert.equal(controller.getDiffBase().commit.hash, 'b');
  controller.applySnapshot({ ref: 'a', mode: 'detached', commit: { hash: 'a', short: 'a' } });
  const before = refreshed;
  controller.applySnapshot({ ref: 'a', mode: 'detached', commit: { hash: 'a', short: 'a' } });
  assert.equal(controller.getDiffBase().ref, 'a');
  assert.equal(refreshed, before);
  controller.setDiffBaseRef('HEAD');
  assert.equal(controller.getDiffBase().commit, null);
});
