import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function loadTraceModule() {
  const bundle = await build({
    entryPoints: [path.join(appRoot, 'monaco_editor/editor_cold_boot_trace.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#${moduleSequence++}`);
}

test('cold boot milestones publish only after the backend enables runtime debug', async () => {
  const trace = await loadTraceModule();
  const logged = [];
  const previous = console.info;
  console.info = (...args) => logged.push(args);
  try {
    trace.traceColdBoot('grammar.catalog', { revision: 'abc' });
    assert.equal(logged.length, 0);
    trace.configureColdBootTrace(true);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].phase, 'grammar.catalog');
    trace.traceColdBoot('theme.monaco_applied', { id: 'github-dark' });
    assert.equal(logged.length, 2);
    trace.configureColdBootTrace(false);
    trace.traceColdBoot('semantic.reply', { words: 5 });
    assert.equal(logged.length, 2);
  } finally {
    console.info = previous;
  }
});

test('full semantic-token validation reports only the first out-of-range offset', async () => {
  const trace = await loadTraceModule();
  const valid = new Uint32Array([0, 0, 2, 1, 0, 1, 0, 4, 2, 0]);
  assert.equal(trace.firstInvalidFullSemanticToken(valid, 2, () => 4), null);
  const invalid = new Uint32Array([0, 0, 2, 1, 0, 1, 2, 3, 2, 0]);
  assert.deepEqual(trace.firstInvalidFullSemanticToken(invalid, 2, () => 4), {
    line: 2, start: 2, end: 5, lineLength: 4,
  });
});

test('cold boot trace caps retained and emitted milestones', async () => {
  const trace = await loadTraceModule();
  const logged = [];
  const previous = console.info;
  console.info = (...args) => logged.push(args);
  try {
    for (let index = 0; index < 100; index += 1) {
      trace.traceColdBoot('before', { index });
    }
    trace.configureColdBootTrace(true);
    assert.equal(logged.length, 24);
    for (let index = 0; index < 100; index += 1) {
      trace.traceColdBoot('after', { index });
    }
    assert.equal(logged.length, 64);
  } finally {
    console.info = previous;
  }
});
