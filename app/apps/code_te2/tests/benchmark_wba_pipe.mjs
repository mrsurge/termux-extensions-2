// Run with node or bun; timings are observational, not CI pass/fail thresholds.
import { performance } from 'node:perf_hooks';
import { PipeMessagePackDecoder, encodePipeMessage } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/pipe-codec.mjs';

const frame = encodePipeMessage({ text: 'x'.repeat(4 * 1024 * 1024) });
const times = [];
for (let run = 0; run < 5; run++) {
  const decoder = new PipeMessagePackDecoder();
  let count = 0;
  const start = performance.now();
  for (let offset = 0; offset < frame.length; offset += 16384) {
    decoder.feed(frame.subarray(offset, offset + 16384), () => count++);
  }
  decoder.finish();
  if (count !== 1) throw new Error('Expected one complete frame');
  times.push(Number((performance.now() - start).toFixed(1)));
}
console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', timesMs: times }));
