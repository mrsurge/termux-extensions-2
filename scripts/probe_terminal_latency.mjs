#!/usr/bin/env node
// Isolated diagnostics. Never connects to, types into, or restarts live shells.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const terminalRoot = path.join(root, 'app/apps/terminal');
const explorerRoot = path.join(root, 'app/apps/file_explorer');
const require = createRequire(path.join(terminalRoot, 'package.json'));
const { transformSync } = require('esbuild');
const pty = require('node-pty');
const { PipeFrameDecoder, encodePipeFrame } = await import(path.join(terminalRoot, 'terminal_stream_protocol.mjs'));
const { TerminalInputBatcher } = await import(path.join(root, 'app/static/js/file_explorer_terminal.js'));
const source = fs.readFileSync(path.join(terminalRoot, 'src/main.ts'), 'utf8');
const scratchBase = process.env.TMPDIR || path.join(root, '.codex-scratch');
fs.mkdirSync(scratchBase, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchBase, 'terminal-latency-'));
const report = { limitations: [
  'Frontend phase runs actual input batching in Node timers with simulated symmetric latency/ACK, not real browser or network.',
  'PTY phase runs actual brokers and direct node-pty; it excludes FWS/Python/WS/browser rendering.',
  'Direct node-pty is a local PTY baseline, not an end-to-end Code TE2 drawer measurement.',
  'Isolated ephemeral instrumentation measures standalone broker queue and headless parse waits; production source is unchanged.',
], frontend: [], pty: [] };
const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0).toFixed(2));
  return { n: sorted.length, p50: at(.5), p95: at(.95), max: at(1) };
};

// Compile the actual authored batching functions, without mounting its app UI.
const constants = [...source.matchAll(/^const INPUT_.*;$/gm)].map(match => match[0]).join('\n');
const functions = source.slice(source.indexOf('  function sendMessage('), source.indexOf('  function clearSocket()'));
if (!functions.includes('function queueInput') || !functions.includes('function sendMessage')) throw new Error('Input source boundaries changed');
function standaloneInput(send) {
  const state = { inputBuffer: '', inputBatchMode: null, inputBufferStartedAt: null, inputFlushTimer: null,
    inputLastChunk: null, inputLastChunkAt: null, encoder: new TextEncoder(), ws: { readyState: 1, send: payload => send(Buffer.from(payload.data).toString()) } };
  const context = vm.createContext({ state, performance, TextEncoder, window: { setTimeout }, clearTimeout,
    WebSocket: { OPEN: 1 }, encodeMessagePack: payload => payload });
  vm.runInContext(transformSync(constants + '\n' + functions + '\nglobalThis.enqueue = queueInput;', { loader: 'ts' }).code, context);
  return { enqueue: context.enqueue, dispose: context.dispose };
}
const patterns = [
  { name: 'single', count: 12, gap: 90, key: () => 'a' },
  { name: 'rapid', count: 30, gap: 8, key: i => String.fromCharCode(97 + i % 20) },
  { name: 'arrows', count: 24, gap: 30, key: () => '\x1b[A' },
];

async function frontend(kind, pattern, rtt) {
  const emitted = [], echo = [], pending = [];
  let consumed = 0, frames = 0;
  const send = data => {
    frames++;
    const now = performance.now();
    let count = 0;
    while (count < Buffer.byteLength(data)) {
      const entry = pending[consumed++];
      if (!entry) throw new Error('Unexpected batch input');
      count += entry.bytes;
      emitted.push(now - entry.at);
      setTimeout(() => echo.push(performance.now() - entry.at), rtt);
    }
    return sleep(rtt);
  };
  const batcher = kind === 'standalone' ? standaloneInput(send)
    : kind === 'file-explorer' ? new TerminalInputBatcher(send, error => { throw error; })
    : { enqueue: send };
  try {
    for (let i = 0; i < pattern.count; i++) {
      const data = pattern.key(i);
      pending.push({ at: performance.now(), bytes: Buffer.byteLength(data) });
      batcher.enqueue(data);
      await sleep(pattern.gap);
    }
    const deadline = performance.now() + 4000;
    while (echo.length < pattern.count) {
      if (performance.now() > deadline) throw new Error('Frontend probe timed out');
      await sleep(5);
    }
    return { kind, pattern: pattern.name, simulatedRtt: rtt, frames, queueMs: quantiles(emitted), echoMs: quantiles(echo) };
  } finally { batcher.dispose?.(); batcher.reset?.(); }
}

// An actual raw-mode child emits one numbered receipt per input byte.
const echoSource = `process.stdin.setRawMode(true); process.stdin.resume(); let offset=0;
process.stdin.on('data', data => { for(const byte of data) process.stdout.write('~ECHO:'+ (++offset) +'~'); });
process.stdout.write('~READY~');
if(process.env.PROBE_LOAD==='1') setInterval(() => process.stdout.write(('\\x1b[32m'+ 'output '.repeat(80)+'\\x1b[0m\\r\\n').repeat(8)), 4);`;
const echoPath = path.join(scratch, 'echo.cjs');
fs.writeFileSync(echoPath, echoSource);
// Instrument a disposable copy; imports still resolve to original dependencies.
let broker = fs.readFileSync(path.join(terminalRoot, 'terminal_stream_broker.mjs'), 'utf8');
broker = broker.replaceAll("from './", `from '${terminalRoot}/`);
broker = broker.replace('  operationQueue = operationQueue\n    .then(operation)',
  `  const queuedAt = performance.now();\n  operationQueue = operationQueue\n    .then(() => { console.error('~QUEUE:' + label + ':' + (performance.now()-queuedAt)); return operation(); })`);
broker = broker.replace('    await writeHeadless(stateTerminal, data);',
  `    const parseAt = performance.now();\n    await writeHeadless(stateTerminal, data);\n    console.error('~PARSE:' + (performance.now()-parseAt));`);
if (!broker.includes('~QUEUE:') || !broker.includes('~PARSE:')) throw new Error('Broker instrumentation boundaries changed');
const brokerPath = path.join(scratch, 'standalone-probe.mjs');
fs.writeFileSync(brokerPath, broker);

async function transport(kind, load) {
  const home = fs.mkdtempSync(path.join(scratch, 'shell-'));
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(path.join(home, '.bash_profile'), `exec ${quote(process.execPath)} ${quote(echoPath)}\n`);
  const env = { ...process.env, HOME: home, PROBE_LOAD: load ? '1' : '0', TERM: 'xterm-256color',
    TERMINAL_STREAM_CWD: home, TERMINAL_STREAM_CONTROL_ROOT: home, TERMINAL_STREAM_COLS: '90', TERMINAL_STREAM_ROWS: '30',
    TERMINAL_STREAM_SHELL_CMD_JSON: JSON.stringify([process.execPath, echoPath]) };
  // Do not accidentally resolve a production override with another Node ABI.
  delete env.TERMINAL_STREAM_NODE_RUNTIME_ROOT;
  let receive = () => {}, errors = '', queue = [], parse = [], close;
  let input;
  if (kind === 'direct-pty') {
    const child = pty.spawn(process.execPath, [echoPath], { name: 'xterm-256color', cols: 90, rows: 30, cwd: home, env });
    child.onData(data => receive(data));
    input = data => child.write(data);
    close = async () => { const exit = new Promise(resolve => child.onExit(resolve)); child.kill(); await exit; };
  } else {
    const entry = kind === 'standalone' ? brokerPath : path.join(explorerRoot, 'terminal_stream_broker.mjs');
    const child = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = new PipeFrameDecoder();
    child.stdout.on('data', bytes => { for (const frame of decoder.push(bytes)) if (frame.type === 'output') receive(Buffer.from(frame.data).toString()); });
    let stderrTail = '';
    child.stderr.on('data', bytes => {
      stderrTail += bytes;
      const lines = stderrTail.split('\n'); stderrTail = lines.pop();
      for (const line of lines) {
        if (line.startsWith('~QUEUE:control message:')) queue.push(Number(line.split(':').at(-1)));
        else if (line.startsWith('~PARSE:')) parse.push(Number(line.slice(7)));
        else if (!line.startsWith('~QUEUE:')) errors = (errors + line + '\n').slice(-4000);
      }
    });
    input = data => child.stdin.write(encodePipeFrame({ type: 'input', data: Buffer.from(data) }));
    close = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exit; clearTimeout(timer);
    };
  }
  let ready = false, tail = '', byteOffset = 0;
  const pending = new Map(), values = [];
  receive = data => {
    tail += data;
    if (tail.includes('~READY~')) ready = true;
    for (const match of tail.matchAll(/~ECHO:(\d+)~/g)) {
      const at = pending.get(Number(match[1]));
      if (at !== undefined) { values.push(performance.now() - at); pending.delete(Number(match[1])); }
    }
    const end = tail.lastIndexOf('~');
    tail = end < 0 ? tail.slice(-32) : tail.slice(end).slice(-64);
  };
  try {
    const deadline = performance.now() + 5000;
    while (!ready) { if (performance.now() > deadline) throw new Error('PTY not ready: ' + errors); await sleep(5); }
    for (let i = 0; i < 50; i++) {
      pending.set(++byteOffset, performance.now()); input('a'); await sleep(15);
    }
    const drain = performance.now() + 5000;
    while (pending.size) { if (performance.now() > drain) throw new Error('PTY echo timeout: ' + errors); await sleep(5); }
    return { kind, load, echoMs: quantiles(values), inputQueueMs: quantiles(queue), headlessParseMs: quantiles(parse) };
  } finally { await close(); }
}

try {
  for (const rtt of [0, 120]) for (const pattern of patterns) for (const kind of ['immediate', 'standalone', 'file-explorer']) {
    const row = await frontend(kind, pattern, rtt); report.frontend.push(row);
    console.error(`input ${kind} ${pattern.name} RTT=${rtt}: p95=${row.echoMs.p95}ms`);
  }
  for (const load of [false, true]) for (const kind of ['direct-pty', 'standalone', 'file-explorer']) {
    const row = await transport(kind, load); report.pty.push(row);
    console.error(`PTY ${kind} load=${load}: p95=${row.echoMs.p95}ms`);
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  const destination = process.argv[2];
  if (destination) fs.writeFileSync(destination, json); else process.stdout.write(json);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
