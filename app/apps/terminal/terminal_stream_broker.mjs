import process from 'node:process';
import {
  asBytes,
  encodePipeFrame,
  isRecord,
  PipeFrameDecoder,
  TERMINAL_STREAM_CODEC,
} from './terminal_stream_protocol.mjs';
import { requireTerminalNodeModule } from './terminal_node_modules.mjs';
import { DirectoryControl } from './terminal_directory_control.mjs';

// Node 21+ exposes a browser-shaped navigator global. The xterm 5.3 packages
// use navigator absence to select their headless path, so remove it before the
// legacy, browser-version-matched packages are evaluated.
if (Object.prototype.hasOwnProperty.call(globalThis, 'navigator')) {
  delete globalThis.navigator;
}
const nodePty = requireTerminalNodeModule('node-pty');
const headlessModule = requireTerminalNodeModule('xterm-headless');
const serializeModule = requireTerminalNodeModule('xterm-addon-serialize');
const HeadlessTerminal = headlessModule.Terminal || headlessModule.default?.Terminal;
const SerializeAddon = serializeModule.SerializeAddon || serializeModule.default?.SerializeAddon;
if (!HeadlessTerminal || !SerializeAddon) {
  throw new Error('Terminal Node runtime did not expose the expected xterm constructors');
}

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

// Explicit experimental opt-in only; no existing session changes behavior.
const directoryControl = process.env.TERMINAL_STREAM_DIRECTORY_CONTROL === '1'
  ? new DirectoryControl(process.env.TERMINAL_STREAM_CONTROL_ROOT, message => sendFrame(message))
  : null;
const shellCmd = directoryControl?.shell() || resolveInnerShellCommand();
const [file, ...args] = shellCmd;
const cwd = process.env.TERMINAL_STREAM_CWD || process.cwd();
let cols = parsePositiveInt(process.env.TERMINAL_STREAM_COLS, DEFAULT_COLS);
let rows = parsePositiveInt(process.env.TERMINAL_STREAM_ROWS, DEFAULT_ROWS);
const scrollback = parsePositiveInt(process.env.TERMINAL_STREAM_SCROLLBACK, DEFAULT_SCROLLBACK);
// This PTY is served by xterm.js, not the terminal (e.g. tmux) hosting TE2.
const termName = DEFAULT_TERM;
const env = { ...process.env, TERM: termName, ...directoryControl?.environment() };

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
directoryControl?.bind(pty, stateTerminal);

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

function enqueueOperation(label, operation, requestId = undefined) {
  operationQueue = operationQueue
    .then(operation)
    .catch(async (error) => {
      logError(`${label} failed`, error);
      try {
        await sendFrame({
          type: 'error',
          request_id: requestId,
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
      directoryTracking: directoryControl?.snapshot(),
    });
    return;
  }

  if (type === 'input') {
    const data = asBytes(message.data);
    if (!data || data.byteLength === 0) {
      return;
    }
    const text = Buffer.from(data).toString('utf8');
    if (directoryControl) directoryControl.input(text);
    else pty.write(text);
    return;
  }

  if (type === 'directory.request' && directoryControl) {
    await directoryControl.request(message);
    return;
  }
  if (type === 'directory.cancel' && directoryControl) {
    await directoryControl.cancel();
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
    directoryControl?.dispose();
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
    enqueueOperation('control message', () => handleControlMessage(message),
      typeof message.request_id === 'string' ? message.request_id : undefined);
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
