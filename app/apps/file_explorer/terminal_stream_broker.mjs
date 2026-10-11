// File Explorer's pipe shell: PTY bytes and shell control only. Screen
// projection/checkpoints belong to the Python worker's app-neutral Pyte layer.
import fs from 'node:fs';
import path from 'node:path';
import { DirectoryControl } from './terminal_directory_control.mjs';
import { requireTerminalNodeModule } from './terminal_node_modules.mjs';
import { PipeFrameDecoder, encodePipeFrame, asBytes } from './terminal_stream_protocol.mjs';

const nodePty = requireTerminalNodeModule('node-pty');
if (process.env.TERMINAL_STREAM_PROTOCOL && process.env.TERMINAL_STREAM_PROTOCOL !== 'msgpack-v1') {
  throw new Error('Unsupported File Explorer terminal codec');
}
const dimension = (value, fallback, max) => {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error('Invalid terminal dimensions');
  return number;
};
let cols = dimension(process.env.TERMINAL_STREAM_COLS, 80, 1000);
let rows = dimension(process.env.TERMINAL_STREAM_ROWS, 24, 500);
let sequence = 0, offset = 0, closed = false, queuedBytes = 0;
let outputQueue = Promise.resolve();
const control = new DirectoryControl(process.env.TERMINAL_STREAM_CONTROL_ROOT, sendFrame);
const logPath = path.join(control.root, 'output.raw');
const log = fs.openSync(logPath, 'wx', 0o600);
const [file, ...args] = control.shell();
const pty = nodePty.spawn(file, args, { name: 'xterm-256color', cols, rows,
  cwd: process.env.TERMINAL_STREAM_CWD || process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color', ...control.environment() } });
control.bind(pty);

function sendFrame(message) {
  const frame = encodePipeFrame(message);
  queuedBytes += frame.length;
  if (queuedBytes > 1024 * 1024) pty.pause();
  outputQueue = outputQueue.then(() => new Promise((resolve, reject) => {
    process.stdout.write(frame, error => {
      queuedBytes -= frame.length;
      if (queuedBytes < 512 * 1024 && !closed) pty.resume();
      if (error) reject(error); else resolve();
    });
  }));
  void outputQueue.catch(() => { if (!closed) pty.kill(); });
  return outputQueue;
}

function resize(message) {
  const nextCols = dimension(message.cols, cols, 1000);
  const nextRows = dimension(message.rows, rows, 500);
  if (nextCols !== cols || nextRows !== rows) pty.resize(nextCols, nextRows);
  cols = nextCols; rows = nextRows;
}

async function command(message) {
  if (message.type === 'input') {
    const bytes = asBytes(message.data);
    if (!bytes || bytes.length > 65536) throw new Error('Invalid terminal input');
    control.input(Buffer.from(bytes).toString('utf8'));
  } else if (message.type === 'resize') resize(message);
  else if (message.type === 'attach') {
    resize(message);
    await sendFrame({ type: 'checkpoint', request_id: message.request_id, sequence,
      outputOffset: offset, logPath, cols, rows, directoryTracking: control.snapshot() });
  } else if (message.type === 'ping') {
    await sendFrame({ type: 'pong', request_id: message.request_id });
  } else if (message.type === 'directory.request') await control.request(message);
  else if (message.type === 'directory.cancel') await control.cancel();
  else if (message.type === 'destroy') pty.kill();
  else throw new Error('Unsupported File Explorer terminal control');
}

pty.onData(data => {
  if (closed) return;
  const bytes = Buffer.from(data, 'utf8');
  // This canonical log lets a restarted Python worker reconstruct the screen.
  // It contains original PTY bytes, never MessagePack frames or decoded text.
  let written = 0;
  while (written < bytes.length) written += fs.writeSync(log, bytes, written, bytes.length - written);
  const startOffset = offset;
  offset += bytes.length;
  void sendFrame({ type: 'output', sequence: ++sequence, startOffset, endOffset: offset, data: bytes });
  control.observe(data);
});
pty.onExit(async ({ exitCode, signal }) => {
  closed = true;
  try { await sendFrame({ type: 'exit', sequence: ++sequence, exit_code: exitCode, signal }); }
  finally { fs.closeSync(log); control.dispose(); process.exit(exitCode || 0); }
});
const decoder = new PipeFrameDecoder();
process.stdin.on('data', bytes => {
  try {
    for (const message of decoder.push(bytes)) {
      // Each command applies its state synchronously in ingress order. Its
      // outbound reply may drain later; output backpressure cannot gate input.
      void command(message).catch(error => sendFrame({ type: 'error', request_id: message.request_id, message: String(error) }));
    }
  } catch (error) { console.error(error); pty.kill(); process.exitCode = 1; }
});
process.stdin.on('end', () => pty.kill());
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => pty.kill());
