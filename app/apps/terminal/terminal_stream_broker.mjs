import process from 'node:process';
import * as nodePty from 'node-pty';
import {
  asBytes,
  encodePipeFrame,
  isRecord,
  PipeFrameDecoder,
  TERMINAL_STREAM_CODEC,
} from './terminal_stream_protocol.mjs';

// Node 21+ exposes a browser-shaped navigator global. The xterm 5.3 packages
// use navigator absence to select their headless path, so remove it before the
// legacy, browser-version-matched packages are evaluated.
if (Object.prototype.hasOwnProperty.call(globalThis, 'navigator')) {
  delete globalThis.navigator;
}
const [headlessModule, serializeModule] = await Promise.all([
  import('xterm-headless'),
  import('xterm-addon-serialize'),
]);
const { Terminal: HeadlessTerminal } = headlessModule.default;
const { SerializeAddon } = serializeModule;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SCROLLBACK = 5000;
const DEFAULT_TERM = 'xterm-256color';

function logError(message, error) {
  if (error) {
    console.error(`[terminal_stream_broker] ${message}`, error);
  } else {
    console.error(`[terminal_stream_broker] ${message}`);
  }
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolveInnerShellCommand() {
  const envJson = process.env.TERMINAL_STREAM_SHELL_CMD_JSON;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((part) => String(part));
      }
    } catch (error) {
      logError('failed to parse TERMINAL_STREAM_SHELL_CMD_JSON', error);
    }
  }

  const sep = process.argv.indexOf('--');
  if (sep >= 0 && process.argv.length > sep + 1) {
    return process.argv.slice(sep + 1).map((part) => String(part));
  }
  return ['sh', '-i'];
}

function writeHeadless(terminal, data) {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

const configuredProtocol = String(process.env.TERMINAL_STREAM_PROTOCOL || TERMINAL_STREAM_CODEC);
if (configuredProtocol !== TERMINAL_STREAM_CODEC) {
  throw new Error(`unsupported terminal stream protocol: ${configuredProtocol}`);
}

const shellCmd = resolveInnerShellCommand();
const [file, ...args] = shellCmd;
const cwd = process.env.TERMINAL_STREAM_CWD || process.cwd();
let cols = parsePositiveInt(process.env.TERMINAL_STREAM_COLS, DEFAULT_COLS);
let rows = parsePositiveInt(process.env.TERMINAL_STREAM_ROWS, DEFAULT_ROWS);
const scrollback = parsePositiveInt(process.env.TERMINAL_STREAM_SCROLLBACK, DEFAULT_SCROLLBACK);
const termName = process.env.TERM || DEFAULT_TERM;
const env = { ...process.env, TERM: termName };

const stateTerminal = new HeadlessTerminal({
  cols,
  rows,
  scrollback,
  convertEol: true,
  allowProposedApi: true,
});
const serializeAddon = new SerializeAddon();
stateTerminal.loadAddon(serializeAddon);

const pty = nodePty.spawn(file, args, {
  name: termName,
  cols,
  rows,
  cwd,
  env,
});

const inputDecoder = new PipeFrameDecoder();
let sequence = 0;
let closed = false;
let operationQueue = Promise.resolve();
let outputQueue = Promise.resolve();

function sendFrame(message) {
  const frame = encodePipeFrame(message);
  outputQueue = outputQueue.then(() => new Promise((resolve, reject) => {
    process.stdout.write(frame, (error) => {
      if (error) reject(error);
      else resolve();
    });
  }));
  return outputQueue;
}

function enqueueOperation(label, operation) {
  operationQueue = operationQueue
    .then(operation)
    .catch(async (error) => {
      logError(`${label} failed`, error);
      try {
        await sendFrame({
          type: 'error',
          code: 'worker_operation_failed',
          message: error instanceof Error ? error.message : String(error),
          fatal: false,
        });
      } catch (sendError) {
        logError('failed to send worker error', sendError);
      }
    });
  return operationQueue;
}

function resizeTerminal(nextCols, nextRows) {
  cols = parsePositiveInt(nextCols, cols);
  rows = parsePositiveInt(nextRows, rows);
  pty.resize(cols, rows);
  stateTerminal.resize(cols, rows);
}

async function handleControlMessage(message) {
  if (!isRecord(message)) {
    return;
  }
  const type = String(message.type || '');

  if (type === 'attach') {
    const requestId = String(message.request_id || '');
    if (!requestId) {
      throw new Error('attach requires request_id');
    }
    if (message.cols !== undefined || message.rows !== undefined) {
      resizeTerminal(message.cols, message.rows);
    }
    const checkpointState = serializeAddon.serialize({ scrollback });
    await sendFrame({
      type: 'checkpoint',
      request_id: requestId,
      sequence,
      cols,
      rows,
      scrollback,
      state: Buffer.from(checkpointState, 'utf8'),
    });
    return;
  }

  if (type === 'input') {
    const data = asBytes(message.data);
    if (!data || data.byteLength === 0) {
      return;
    }
    pty.write(Buffer.from(data).toString('utf8'));
    return;
  }

  if (type === 'resize') {
    resizeTerminal(message.cols, message.rows);
    return;
  }

  if (type === 'ping') {
    await sendFrame({ type: 'pong', request_id: String(message.request_id || '') });
    return;
  }

  if (type === 'destroy') {
    pty.kill();
    return;
  }

  throw new Error(`unsupported terminal message type: ${type || '<empty>'}`);
}

pty.onData((data) => {
  enqueueOperation('pty output', async () => {
    if (closed) return;
    sequence += 1;
    await writeHeadless(stateTerminal, data);
    await sendFrame({
      type: 'output',
      sequence,
      data: Buffer.from(data, 'utf8'),
    });
  });
});

pty.onExit(({ exitCode, signal }) => {
  enqueueOperation('pty exit', async () => {
    if (closed) return;
    closed = true;
    sequence += 1;
    await sendFrame({
      type: 'exit',
      sequence,
      exit_code: typeof exitCode === 'number' ? exitCode : null,
      reason: signal ? `signal:${signal}` : 'exited',
    });
    stateTerminal.dispose();
    await outputQueue;
    process.exit(typeof exitCode === 'number' ? exitCode : 0);
  });
});

process.stdin.on('data', (chunk) => {
  let messages;
  try {
    messages = inputDecoder.push(chunk);
  } catch (error) {
    logError('invalid framed MessagePack input', error);
    pty.kill();
    return;
  }
  for (const message of messages) {
    enqueueOperation('control message', () => handleControlMessage(message));
  }
});

process.stdin.on('end', () => {
  if (!closed) {
    pty.kill();
  }
});

process.stdout.on('error', (error) => {
  logError('stdout pipe failed', error);
  if (!closed) {
    pty.kill();
  }
});

for (const signalName of ['SIGINT', 'SIGTERM']) {
  process.on(signalName, () => {
    if (!closed) {
      pty.kill();
    }
  });
}

enqueueOperation('ready frame', () => sendFrame({
  type: 'ready',
  protocol: TERMINAL_STREAM_CODEC,
  pid: pty.pid,
  cols,
  rows,
  scrollback,
  shell: shellCmd,
  cwd,
}));
