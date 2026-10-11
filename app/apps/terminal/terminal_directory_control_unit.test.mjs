import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DirectoryControl } from './terminal_directory_control.mjs';

function fixture() {
  const scratch = process.env.TMPDIR || path.resolve('../../../.codex-scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'directory-control-unit-'));
  const messages = [], inputs = [];
  const control = new DirectoryControl(root, async message => { messages.push(message); });
  let handler;
  control.bind({ pid: process.pid, write: data => inputs.push(data) }, {
    parser: { registerOscHandler: (_code, callback) => { handler = callback; return { dispose() {} }; } },
  });
  let sequence = 0;
  return {
    control, messages, inputs,
    event(kind, token, value) {
      sequence += 1;
      const eventId = `${process.pid}-${sequence}`;
      fs.writeFileSync(path.join(control.root, `event-${eventId}`), `${kind}\0${token}\0${value}\0${root}\0`);
      handler(`te2-control;${control.nonce};${eventId}`);
    },
    close() { control.dispose(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('late idle event cannot clear a newer partial input', () => {
  const f = fixture();
  try {
    f.event('state', '', 'idle');
    f.control.input('partial');
    f.event('state', '', 'idle');
    assert.equal(f.control.dirty, true);
  } finally { f.close(); }
});

test('shell-side busy rejection releases held input and retains latest request for next prompt', () => {
  const f = fixture();
  try {
    f.control.pending = { id: 'request', token: '1-token', wake: true, path: '/example' };
    f.control.input('untouched\n');
    assert.deepEqual(f.inputs, []);
    f.event('result', '1-token', 'deferred');
    assert.deepEqual(f.inputs, ['untouched\n']);
    assert.equal(f.control.pending.wake, false);
    assert.ok(fs.readFileSync(path.join(f.control.root, 'request'), 'utf8').includes('\nprompt\n'));
    f.event('result', '1-token', 'applied');
    assert.equal(f.control.pending.refreshing, true);
    f.event('state', '', 'idle');
    assert.equal(f.control.pending, null);
    assert.equal(f.messages.at(-1).state, 'applied');
  } finally { f.close(); }
});

test('idle refresh submits only an empty line and holds user input until fresh prompt', () => {
  const f = fixture();
  try {
    f.control.pending = { id: 'request', token: '1-token', wake: true, path: '/example' };
    f.control.input('next command\n');
    f.event('result', '1-token', 'applied');
    assert.deepEqual(f.inputs, ['\r']);
    assert.equal(f.messages.some(message => message.state === 'applied'), false);
    f.event('state', '', 'idle');
    assert.deepEqual(f.inputs, ['\r', 'next command\n']);
    assert.equal(f.messages.at(-1).state, 'applied');
  } finally { f.close(); }
});

test('invalid paths and unsupported shell state reject without terminal input', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.control.request({ request_id: 'request', path: 'relative' }), /invalid/);
    await assert.rejects(f.control.request({ request_id: 'request', path: '/nul\0path' }), /invalid/);
    f.event('state', '', 'unsupported');
    await assert.rejects(f.control.request({ request_id: 'request', path: '/example' }), /unavailable/);
    assert.deepEqual(f.inputs, []);
  } finally { f.close(); }
});

test('wake-held input is bounded and control disposal removes private resources', () => {
  const f = fixture();
  try {
    f.control.pending = { id: 'request', token: '1-token', wake: true, path: '/example' };
    f.control.input('x'.repeat(65536));
    assert.throws(() => f.control.input('y'), /queue full/);
    const directory = f.control.root;
    f.control.dispose();
    assert.equal(fs.existsSync(directory), false);
    assert.deepEqual(f.inputs, []);
  } finally { f.close(); }
});
