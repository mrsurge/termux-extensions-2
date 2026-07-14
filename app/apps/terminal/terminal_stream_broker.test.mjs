import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { encodePipeFrame, PipeFrameDecoder } from './terminal_stream_protocol.mjs';


test('broker restores parsed PTY state at a reconnect sequence boundary', { timeout: 12_000 }, async () => {
  const child = spawn(process.execPath, ['./terminal_stream_broker.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERMINAL_STREAM_PROTOCOL: 'msgpack-v1',
      TERMINAL_STREAM_COLS: '90',
      TERMINAL_STREAM_ROWS: '30',
      TERMINAL_STREAM_SCROLLBACK: '5000',
      TERMINAL_STREAM_CWD: process.cwd(),
      TERMINAL_STREAM_SHELL_CMD_JSON: JSON.stringify(['sh', '-i']),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new PipeFrameDecoder();
  let markerSequence = 0;
  let requestedReconnect = false;
  let passed = false;
  let output = '';
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.type === 'ready') {
        child.stdin.write(encodePipeFrame({
          type: 'attach',
          request_id: 'first',
          cols: 90,
          rows: 30,
        }));
      } else if (message.type === 'checkpoint' && message.request_id === 'first') {
        child.stdin.write(encodePipeFrame({
          type: 'input',
          data: Buffer.from("printf '__TE2_SMOKE__\\n'\n"),
        }));
      } else if (message.type === 'output') {
        output += Buffer.from(message.data).toString('utf8');
        if (!requestedReconnect && output.includes('__TE2_SMOKE__')) {
          markerSequence = message.sequence;
          requestedReconnect = true;
          child.stdin.write(encodePipeFrame({
            type: 'attach',
            request_id: 'second',
            cols: 90,
            rows: 30,
          }));
        }
      } else if (message.type === 'checkpoint' && message.request_id === 'second') {
        const state = Buffer.from(message.state).toString('utf8');
        assert.match(state, /__TE2_SMOKE__/);
        assert.ok(message.sequence >= markerSequence);
        passed = true;
        child.stdin.write(encodePipeFrame({ type: 'destroy' }));
      }
    }
  });

  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (!passed) {
          reject(new Error(`broker exited early code=${code} signal=${signal}: ${stderr}`));
          return;
        }
        resolve();
      });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
});
