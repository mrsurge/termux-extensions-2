// Offline codec probe only: no server, socket, or runtime configuration changes.
import { readFileSync } from 'node:fs';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: node scripts/probe_socket_compression.mjs <payload-file> [...]');
  process.exit(2);
}
for (const path of paths) {
  const payload = readFileSync(path);
  if (payload.length > 8 * 1024 * 1024) throw new Error('Probe input exceeds 8 MiB');
  for (const [codec, encode] of [['gzip', gzipSync], ['raw-deflate', deflateRawSync]]) {
    encode(payload); // Warm codec once, outside the timed sample.
    const before = process.memoryUsage().rss;
    const start = performance.now();
    let encoded;
    const iterations = 10;
    for (let n = 0; n < iterations; n++) encoded = encode(payload);
    console.log(JSON.stringify({ path, codec, inputBytes: payload.length,
      outputBytes: encoded.length, ratio: encoded.length / payload.length,
      meanEncodeMs: (performance.now() - start) / iterations,
      rssDeltaBytes: process.memoryUsage().rss - before, iterations,
      limitation: 'Codec-only; not wire framing, RTT, streaming, or Android performance. Raw deflate is not a negotiated WebSocket test.' }));
  }
}
