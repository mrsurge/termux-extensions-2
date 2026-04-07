import process from 'node:process';
import readline from 'node:readline';
import * as nodePty from 'node-pty';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
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

function writeFrame(frame) {
  process.stdout.write(JSON.stringify(frame) + '\n');
}

function encodeDataFrame(data, nextSeq) {
  return {
    type: 'data',
    seq: nextSeq,
    ts: Date.now(),
    data_b64: Buffer.from(data, 'utf8').toString('base64'),
  };
}

const shellCmd = resolveInnerShellCommand();
const [file, ...args] = shellCmd;
const cwd = process.env.TERMINAL_STREAM_CWD || process.cwd();
const cols = parsePositiveInt(process.env.TERMINAL_STREAM_COLS, DEFAULT_COLS);
const rows = parsePositiveInt(process.env.TERMINAL_STREAM_ROWS, DEFAULT_ROWS);
const termName = process.env.TERM || DEFAULT_TERM;
const env = {
  ...process.env,
  TERM: termName,
};

let seq = 0;
let closed = false;

const pty = nodePty.spawn(file, args, {
  name: termName,
  cols,
  rows,
  cwd,
  env,
});

function emitClosed(reason, exitCode = null) {
  if (closed) {
    return;
  }
  closed = true;
  seq += 1;
  writeFrame({
    type: 'closed',
    seq,
    ts: Date.now(),
    exit_code: exitCode,
    reason,
  });
}

writeFrame({
  type: 'ready',
  ts: Date.now(),
  pid: pty.pid,
  shell: shellCmd,
  cwd,
});

pty.onData((data) => {
  seq += 1;
  writeFrame(encodeDataFrame(data, seq));
});

pty.onExit(({ exitCode, signal }) => {
  const reason = signal ? `signal:${signal}` : 'exited';
  emitClosed(reason, typeof exitCode === 'number' ? exitCode : null);
  process.exit(typeof exitCode === 'number' ? exitCode : 0);
});

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

rl.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    logError(`bad JSON command: ${line.slice(0, 200)}`, error);
    return;
  }

  if (!frame || typeof frame !== 'object') {
    return;
  }

  const frameType = String(frame.type || '');
  if (frameType === 'hello') {
    writeFrame({
      type: 'hello',
      ts: Date.now(),
      pid: pty.pid,
      next_seq: seq + 1,
    });
    return;
  }

  if (frameType === 'ping') {
    writeFrame({ type: 'pong', nonce: frame.nonce ?? null });
    return;
  }

  if (frameType === 'input') {
    const dataB64 = frame.data_b64;
    if (typeof dataB64 !== 'string' || !dataB64) {
      return;
    }
    try {
      const text = Buffer.from(dataB64, 'base64').toString('utf8');
      pty.write(text);
    } catch (error) {
      logError('failed to decode input frame', error);
    }
    return;
  }

  if (frameType === 'resize') {
    const nextCols = parsePositiveInt(frame.cols, cols);
    const nextRows = parsePositiveInt(frame.rows, rows);
    try {
      pty.resize(nextCols, nextRows);
    } catch (error) {
      logError(`resize failed cols=${nextCols} rows=${nextRows}`, error);
    }
    return;
  }

  if (frameType === 'destroy') {
    try {
      pty.kill();
    } catch (error) {
      logError('destroy failed', error);
    }
  }
});

rl.on('close', () => {
  try {
    pty.kill();
  } catch (error) {
    logError('stdin closed while killing PTY', error);
  }
});

for (const signalName of ['SIGINT', 'SIGTERM']) {
  process.on(signalName, () => {
    try {
      pty.kill();
    } catch (error) {
      logError(`failed to kill PTY on ${signalName}`, error);
    }
  });
}
