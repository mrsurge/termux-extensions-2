import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';


const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../main_page/frontend/host-terminal-drawer.ts'),
  'utf8',
);

test('terminal drawer uses no HTTP control or history requests', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /terminalRequest(?:<[^>]+>)?\('shells\.get'/);
  assert.match(source, /terminalRequest\('shell\.create'/);
  assert.match(source, /terminalRequest\('shell\.activate'/);
  assert.match(source, /terminalRequest\('shell\.title'/);
  assert.match(source, /terminalRequest\('shell\.(?:remove|destroy)'/);
});

test('terminal drawer uses reliable control and generation-fenced history', () => {
  assert.match(source, /socket\.emit\('terminal:request'/);
  assert.match(source, /ws\?\.emit\('terminal:register'/);
  assert.match(source, /ws\?\.volatile\.emit\('terminal:input'/);
  assert.match(source, /ws\.volatile\.emit\('terminal:resize'/);
  assert.match(source, /rejectPendingTerminalRequests\(`Terminal socket disconnected:/);
  assert.match(source, /socket\.sendBuffer\.length = 0/);
  assert.match(source, /socket\.on\('terminal:history'/);
  assert.match(source, /historyGeneration !== bindGeneration/);
  assert.match(source, /coerceTerminalOffset\(msg\.output_offset\)/);
  assert.match(source, /coerceTerminalBytes\(msg\.pending_bytes\)/);
  assert.match(source, /reconcileTerminalOutput\(appliedOutputOffset, record\)/);
  assert.doesNotMatch(source, /trimPrimedOverlap/);
  assert.doesNotMatch(source, /msg\.stdout_text/);
  assert.match(source, /await ensureTerminalSocket\(\);\s*emitTerminalRegister/);
});

test('terminal identity resets xterm before asynchronous helper rebinding', () => {
  const start = source.indexOf("socket.on('terminal:shell_id'");
  const end = source.indexOf("socket.on('terminal:history'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = source.slice(start, end);
  assert.match(handler, /socket\.on\('terminal:shell_id', \(msg\) =>/);
  assert.ok(handler.indexOf('term?.reset()') < handler.indexOf('void bindDrawerVendoredCtrlHandler(term)'));
});
