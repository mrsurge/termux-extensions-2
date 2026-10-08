// Legacy executable adapter. The consumer module has no import-time process effects.
import {createLocalFrameworkConsumer} from './local-framework-consumer';
import {FrameWriter} from '../../vendor/electromux/runtime/src/frame-writer';
import {FrameDecoder} from '../../vendor/electromux/runtime/src/protocol';

const writer = new FrameWriter(process.stdout);
process.stdout.on('error', () => { process.stdin.destroy(); });
const consumer = await createLocalFrameworkConsumer({
  emit: async (event, data) => { await writer.send({event, data}); },
  log: (stream, text) => { process.stderr.write(`[framework:${stream}] ${text}`); },
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void consumer.dispose().then(() => process.exit(0), () => process.exit(1)); });
}
// Preserve the accepted helper hello, not the embedded proof's runtime.ready.
const ready = Buffer.from(JSON.stringify({version: 1, event: 'ready'}));
const header = Buffer.alloc(4); header.writeUInt32BE(ready.length);
process.stdout.write(Buffer.concat([header, ready]));
const decoder = new FrameDecoder();
try {
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Nonbinary control input');
    const requests: {id: number; method: string; params?: unknown}[] = [];
    decoder.push(chunk, body => {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid consumer request');
      const request = value as Record<string, unknown>;
      if (typeof request.id !== 'number' || !Number.isSafeInteger(request.id) || request.id < 1 ||
          typeof request.method !== 'string' || Object.keys(request).some(key => !['id', 'method', 'params'].includes(key)))
        throw new Error('Invalid consumer request');
      if (requests.length >= 8) throw new Error('Consumer request batch exceeded');
      requests.push({id: request.id, method: request.method, params: request.params});
    });
    for (const request of requests) {
      try { await writer.send({id: request.id, result: await consumer.dispatch(request.method, request.params)}); }
      catch (error) { await writer.send({id: request.id, error: error instanceof Error ? error.message : String(error)}); }
      if (request.method === 'shutdown') process.exit(0);
    }
  }
  decoder.finish();
} finally { await consumer.dispose(); }
