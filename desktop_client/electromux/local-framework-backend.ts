// TE2 consumer process, not Electromux core. stdout is framed host IPC;
// framework stdout/stderr remain logs and its inherited FD3 remains control.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { LocalFrameworkController } from '../electron/src/main/local-framework-controller';
import { readLocalFrameworkConfig, writeLocalFrameworkConfig,
  localFrameworkChildEnvironment } from '../electron/src/main/local-framework-config';

const MAX_FRAME = 65536;
let config = await readLocalFrameworkConfig();
let selectedOrigin = '';
let preparing: ChildProcess | null = null;
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
  selectLocal: async port => { selectedOrigin = `http://127.0.0.1:${port}`; },
  publish: publishState,
  prepareFramework: async launch => {
    if (closing) throw new Error('Consumer is closing');
    const child = spawn(launch.resolvedCommand, ['--build-only'], {
      env: localFrameworkChildEnvironment(launch), detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    preparing = child;
    publishState();
    // Forward continuously: no unbounded transcript or retained log accumulator.
    child.stdout?.pipe(process.stderr, {end: false});
    child.stderr?.pipe(process.stderr, {end: false});
    try {
      const [code] = await once(child, 'close');
      if (closing || code !== 0) throw new Error(`Framework preparation failed (${code})`);
    } finally { preparing = null; publishState(); }
  },
  log: (stream, text) => process.stderr.write(`[framework:${stream}] ${text}`),
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
    preparing: preparing !== null, operationError};
}
async function shutdown() {
  closing = true;
  if (preparing?.pid) {
    const child = preparing;
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already exited */ }
    const force = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 2000);
    try { await pending; } finally { clearTimeout(force); }
  } else { await pending; }
  if (controller.ownsRunningProcess()) await controller.stop();
}
async function dispatch(method: string, params: unknown) {
  switch (method) {
    case 'get_local_framework_config': return config;
    case 'save_local_framework_config':
      if (pending || controller.ownsRunningProcess()) throw new Error('Local lifecycle operation is active');
      config = await writeLocalFrameworkConfig(params); return config;
    case 'get_local_framework_state': return state();
    case 'refresh_local_framework': await controller.refresh(); return state();
    case 'start_local_framework': return schedule(() => controller.start());
    case 'stop_local_framework':
      if (pending) throw new Error('Local lifecycle operation is active');
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
