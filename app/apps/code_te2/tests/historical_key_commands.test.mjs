import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['monaco_editor/historical_key_commands.ts'], bundle: true, write: false, format: 'esm' });
const { historicalKeyCommand } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const command = (key, modifiers = {}) => historicalKeyCommand({ key, code: '', keyCode: 0 }, { ctrl: false, alt: false, ...modifiers });
test('read-only navigation and selection map to Monaco core commands', () => {
  for (const [key, expected] of Object.entries({ ArrowLeft: 'cursorLeft', ArrowRight: 'cursorRight', ArrowUp: 'cursorUp', ArrowDown: 'cursorDown', Home: 'cursorHome', End: 'cursorEnd', PageUp: 'cursorPageUp', PageDown: 'cursorPageDown' })) {
    assert.equal(command(key), expected);
    assert.equal(command(key, { shift: true }), expected + 'Select');
  }
  assert.equal(command('Home', { ctrl: true, shift: true }), 'cursorTopSelect');
  assert.equal(command('End', { ctrl: true }), 'cursorBottom');
});
test('find, copy and select all are permitted; edit and arbitrary keys are denied', () => {
  assert.equal(command('f', { ctrl: true }), 'actions.find');
  assert.equal(command('c', { ctrl: true }), 'copy');
  assert.equal(command('a', { ctrl: true }), 'selectAll');
  for (const key of ['v', 'x', 'z', 's', 'Enter', 'Backspace', 'Delete', 'Tab']) {
    assert.equal(command(key), null);
    assert.equal(command(key, { ctrl: true }), null);
  }
  assert.equal(command('ArrowLeft', { alt: true }), null);
});
