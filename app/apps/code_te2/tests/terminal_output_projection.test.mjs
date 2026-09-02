import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';


async function importProjectionRuntime() {
  const appRoot = path.resolve(import.meta.dirname, '..');
  const result = await build({
    entryPoints: [
      path.join(appRoot, 'main_page/frontend/terminal-output-projection.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}


test('coerces binary terminal output with exact byte offsets', async () => {
  const { coerceTerminalOutput } = await importProjectionRuntime();
  const bytes = Uint8Array.from([0xe2, 0x82, 0xac]);
  const record = coerceTerminalOutput({
    data: bytes.buffer,
    start_offset: 7,
    end_offset: 10,
  });

  assert.deepEqual([...record.data], [...bytes]);
  assert.equal(record.startOffset, 7);
  assert.equal(record.endOffset, 10);
  assert.equal(coerceTerminalOutput({ data: bytes, start_offset: 7, end_offset: 9 }), null);
});


test('drops checkpoint-covered output and trims only exact crossing bytes', async () => {
  const { reconcileTerminalOutput } = await importProjectionRuntime();
  const covered = reconcileTerminalOutput(10, {
    data: Uint8Array.from([1, 2, 3]),
    startOffset: 7,
    endOffset: 10,
  });
  assert.deepEqual(covered, { kind: 'covered', nextOffset: 10 });

  const crossing = reconcileTerminalOutput(10, {
    data: Uint8Array.from([8, 9, 10, 11, 12]),
    startOffset: 8,
    endOffset: 13,
  });
  assert.equal(crossing.kind, 'write');
  assert.deepEqual([...crossing.data], [10, 11, 12]);
  assert.equal(crossing.nextOffset, 13);
});


test('reports an output gap instead of replaying ambiguous bytes', async () => {
  const { reconcileTerminalOutput } = await importProjectionRuntime();
  assert.deepEqual(
    reconcileTerminalOutput(10, {
      data: Uint8Array.from([12, 13]),
      startOffset: 12,
      endOffset: 14,
    }),
    { kind: 'gap', expectedOffset: 10, receivedOffset: 12 },
  );
});
