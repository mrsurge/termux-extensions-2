import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
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

test('diagnostics latency probe stays off by default and retains a bounded ring', async () => {
  const { DiagnosticsLatencyProbe } = await importTypeScript(
    'src/diagnostics/latency-probe.ts',
  );
  const probe = new DiagnosticsLatencyProbe(2);

  probe.record('disabled', {});
  assert.deepEqual(probe.snapshot().records, []);

  probe.start();
  probe.record('first', { value: 1 });
  probe.record('second', { value: 2 });
  probe.record('third', { value: 3 });

  const snapshot = probe.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.dropped, 1);
  assert.deepEqual(snapshot.records.map((record) => record.kind), ['second', 'third']);

  probe.stop();
  probe.record('disabled-again', {});
  assert.equal(probe.snapshot().records.length, 2);
  assert.equal(probe.clear().records.length, 0);
});

test('diagnostics latency probe correlates open stages without retaining content', async () => {
  const { DiagnosticsLatencyProbe } = await importTypeScript(
    'src/diagnostics/latency-probe.ts',
  );
  const probe = new DiagnosticsLatencyProbe(8);
  probe.start();

  probe.beginOpen('open-1', '/workspace/example.rs');
  probe.recordOpenStage('open-1', 'backend_resolved', { durationMs: 4 });
  probe.finishOpen('open-1', 'open_complete', { durationMs: 7 });

  const records = probe.snapshot().records;
  assert.deepEqual(
    records.map((record) => record.stage),
    ['host_intent', 'backend_resolved', 'open_complete'],
  );
  assert.ok(records.every((record) => !('content' in record)));
  assert.equal(records[2].requestId, 'open-1');
});
