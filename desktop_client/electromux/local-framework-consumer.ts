// TE2 policy only: no import-time I/O, signal hooks, transport or framework launch.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalFrameworkController } from '../electron/src/main/local-framework-controller';
import { readLocalFrameworkConfig, writeLocalFrameworkConfig } from '../electron/src/main/local-framework-config';

export type LocalFrameworkConsumerOptions = {
  environment?: NodeJS.ProcessEnv;
  emit: (name: string, data: Record<string, unknown>) => Promise<void>;
  log?: (stream: 'stdout' | 'stderr', text: string) => void;
};
export async function createLocalFrameworkConsumer(options: LocalFrameworkConsumerOptions) {
const environment = {...(options.environment || process.env)};
// Isolate launcher configuration without changing TE2 child config/data roots.
const configEnvironment = environment.TE2_ELECTROMUX_CONFIG_HOME
  ? {...environment, TE2_CONFIG_HOME: environment.TE2_ELECTROMUX_CONFIG_HOME} : environment;
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
let disposal: Promise<void> | null = null;
let dispatching = false;
const log = options.log || (() => {});

// State is a projection, not a journal: retain at most the newest snapshot
// while stdout is backpressured. Replies keep their existing correlation IDs.
function publishState() {
  if (closing) return;
  eventPending = true;
  if (eventSending) return;
  eventSending = true;
  queueMicrotask(() => { void (async () => {
    try {
      while (eventPending && !closing) {
        eventPending = false;
        await options.emit('local-framework-state', state());
      }
    } catch (error) {
      log('stderr', `State delivery failed: ${String(error)}\n`);
      await shutdown();
    } finally { eventSending = false; }
  })(); });
}

const controller = new LocalFrameworkController({
  environment,
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
    log(stream, text);
    if (stream !== 'stdout' || controller.snapshot().phase !== 'starting') return;
    const lines = (stdoutPartial + text).split(/\r\n|\r|\n/);
    stdoutPartial = (lines.pop() || '').slice(-2048);
    if (lines.length) startupOutput = lines[lines.length - 1].slice(-2048);
    if (stdoutPartial) startupOutput = stdoutPartial;
    publishState();
  },
});

function schedule(operation: () => Promise<unknown>) {
  if (closing) throw new Error('Consumer is closing');
  if (!pending) {
    operationError = null;
    pending = operation().catch((error: unknown) => { operationError = error instanceof Error ? error.message : String(error); })
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
function shutdown(): Promise<void> {
  if (disposal) return disposal;
  closing = true;
  eventPending = false;
  disposal = (async () => {
    if (controller.ownsRunningProcess()) await controller.stop();
    await pending;
  })();
  return disposal;
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
    case 'get_local_framework_config': return {...config};
    case 'save_local_framework_config':
      if (pending || controller.ownsRunningProcess()) throw new Error('Local lifecycle operation is active');
      config = await writeLocalFrameworkConfig(params, configEnvironment); return {...config};
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

return {
  methods: ['set_selected_framework', 'get_local_framework_config', 'save_local_framework_config',
    'get_local_framework_state', 'refresh_local_framework', 'start_local_framework',
    'stop_local_framework', 'use_local_framework', 'shutdown'] as readonly string[],
  events: ['local-framework-state'] as readonly string[],
  async dispatch(method: string, params?: unknown): Promise<Record<string, unknown>> {
    if (closing || dispatching) throw new Error('Consumer is closing or busy');
    dispatching = true;
    try { return structuredClone(await dispatch(method, params)); }
    finally { dispatching = false; }
  },
  dispose: shutdown,
};
}
