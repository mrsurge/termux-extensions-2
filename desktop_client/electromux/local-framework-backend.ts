// TE2 consumer process, not Electromux core. stdout is framed host IPC;
// framework stdout/stderr remain logs and its inherited FD3 remains control.
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalFrameworkController } from '../electron/src/main/local-framework-controller';
import { readLocalFrameworkConfig, writeLocalFrameworkConfig } from '../electron/src/main/local-framework-config';

const MAX_FRAME = 65536;
// Isolate launcher configuration without changing TE2 child config/data roots.
const configEnvironment = process.env.TE2_ELECTROMUX_CONFIG_HOME
  ? {...process.env, TE2_CONFIG_HOME: process.env.TE2_ELECTROMUX_CONFIG_HOME} : process.env;
let config = await readLocalFrameworkConfig(configEnvironment);
let selectedOrigin = '';
const stateSessionId = randomUUID();
let stateRevision = 0;
let selectionRevision = 0;
let startupOutput = '';
let stdoutPartial = '';
let closing = false;
let pending: Promise<unknown> | null = null;
let operationError: string | null = null;
let eventPending = false;
let eventSending = false;

// State is a projection, not a journal: retain at most the newest snapshot
// while stdout is backpressured. Replies keep their existing correlation IDs.
function publishState() {
  eventPending = true;
  if (eventSending) return;
  eventSending = true;
  queueMicrotask(() => { void (async () => {
    try {
      while (eventPending) {
        eventPending = false;
        await send({event: 'local-framework-state', data: state()});
      }
    } catch (error) {
      process.stderr.write(`State delivery failed: ${String(error)}\n`);
      process.exitCode = 1;
      process.stdin.destroy();
    } finally { eventSending = false; }
  })(); });
}

const controller = new LocalFrameworkController({
  getLaunchConfig: () => config,
  getSelectedOrigin: () => selectedOrigin,
  selectLocal: async port => { selectedOrigin = `http://127.0.0.1:${port}`; selectionRevision++; },
  publish: publishState,
  spawnFramework: ((...args: Parameters<typeof spawn>) => {
    if (closing) throw new Error('Consumer is closing');
    return spawn(...args);
  }) as typeof spawn,
  waitIndefinitelyForStartup: true,
  log: (stream, text) => {
    process.stderr.write(`[framework:${stream}] ${text}`);
    if (stream !== 'stdout' || controller.snapshot().phase !== 'starting') return;
    const lines = (stdoutPartial + text).split(/\r\n|\r|\n/);
    stdoutPartial = (lines.pop() || '').slice(-2048);
    if (lines.length) startupOutput = lines[lines.length - 1].slice(-2048);
    if (stdoutPartial) startupOutput = stdoutPartial;
    publishState();
  },
});

async function send(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  if (!body.length || body.length > MAX_FRAME) throw new Error('Control frame exceeds limit');
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
  if (!process.stdout.write(Buffer.concat([header, body]))) await once(process.stdout, 'drain');
}

function schedule(operation: () => Promise<unknown>) {
  if (closing) throw new Error('Consumer is closing');
  if (!pending) {
    operationError = null;
    pending = operation().catch(error => { operationError = String(error.message || error); })
      .finally(() => { pending = null; publishState(); });
    publishState();
  }
  return state();
}
function state() {
  return {...controller.snapshot(), operationPending: pending !== null,
    cancellableStartup: controller.snapshot().phase === 'starting' && controller.ownsRunningProcess(),
    startupOutput, operationError, selectedOrigin, selectionRevision,
    stateSessionId, stateRevision: ++stateRevision};
}
async function shutdown() {
  closing = true;
  if (controller.ownsRunningProcess()) await controller.stop();
  await pending;
}
async function dispatch(method: string, params: unknown) {
  switch (method) {
    case 'set_selected_framework': {
      const origin = (params as {origin?: unknown})?.origin;
      if (typeof origin !== 'string') throw new Error('Invalid selected framework');
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          url.search || url.hash || url.pathname !== '/') throw new Error('Invalid selected framework');
      selectedOrigin = url.origin;
      return state(); // Observation never selects a local endpoint or advances intent revision.
    }
    case 'get_local_framework_config': return config;
    case 'save_local_framework_config':
      if (pending || controller.ownsRunningProcess()) throw new Error('Local lifecycle operation is active');
      config = await writeLocalFrameworkConfig(params, configEnvironment); return config;
    case 'get_local_framework_state': return state();
    case 'refresh_local_framework': await controller.refresh(); return state();
    case 'start_local_framework':
      if (!pending) { startupOutput = ''; stdoutPartial = ''; }
      return schedule(() => controller.start());
    case 'stop_local_framework':
      if (pending) {
        if (controller.snapshot().phase !== 'starting' || !controller.ownsRunningProcess())
          throw new Error('Local lifecycle operation is active');
        await controller.stop();
        await pending;
        return state();
      }
      return schedule(() => controller.stop());
    case 'use_local_framework': await controller.useLocal(); return state();
    case 'shutdown': await shutdown(); return {stopped: true};
    default: throw new Error('Unknown consumer method');
  }
}

// A serial request lane; start returns an acknowledgement immediately so source
// builds never hold Electromux's bounded request/response socket open.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void shutdown().then(() => process.exit(0), () => process.exit(1)); });
}
await send({version: 1, event: 'ready'});
let buffer = Buffer.alloc(0);
try {
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32BE(0);
      if (!size || size > MAX_FRAME) throw new Error('Invalid control frame length');
      if (buffer.length < size + 4) break;
      const request = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(4, size + 4)));
      buffer = buffer.subarray(size + 4);
      if (!Number.isSafeInteger(request.id) || typeof request.method !== 'string')
        throw new Error('Invalid consumer request');
      try { await send({id: request.id, result: await dispatch(request.method, request.params)}); }
      catch (error) { await send({id: request.id, error: String((error as Error).message)}); }
      if (closing) process.exit(0);
    }
  }
  if (buffer.length) throw new Error('Truncated control frame');
} finally { await shutdown().catch(() => {}); }
