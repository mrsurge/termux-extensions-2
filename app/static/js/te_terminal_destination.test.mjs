import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTerminalDestination } from './te_terminal_destination.mjs';
import { normalizeDialogRequest } from './te_dialog.mjs';

test('remembered destination avoids dialog; reset asks again', async () => {
  let value = 'sidebar'; let count = 0;
  const prefs = { read: async () => value, write: async v => { value = v; } };
  const dialog = { open: async request => {
    count++;
    assert.equal(normalizeDialogRequest(request).fields[0].key, 'remember');
    return { status: 'accepted', action: 'drawer', values: { remember: true } };
  } };
  assert.equal(await chooseTerminalDestination(dialog, prefs), 'sidebar');
  assert.equal(count, 0);
  await prefs.write('ask');
  assert.equal(await chooseTerminalDestination(dialog, prefs), 'drawer');
  assert.equal(value, 'drawer');
  assert.equal(count, 1);
});

test('cancel or unchecked choice never persists', async () => {
  let writes = 0;
  const prefs = { read: async () => 'ask', write: async () => { writes++; } };
  assert.equal(await chooseTerminalDestination({ open: async () => ({ status: 'cancelled', action: 'cancel', values: { remember: true } }) }, prefs), null);
  assert.equal(await chooseTerminalDestination({ open: async () => ({ status: 'accepted', action: 'drawer', values: { remember: false } }) }, prefs), 'drawer');
  assert.equal(writes, 0);
});

test('storage failure is reported but does not discard an explicit one-time choice', async () => {
  const errors = [];
  const prefs = { read: async () => { throw new Error('old native bridge'); },
    write: async () => { throw new Error('disk full'); }, onError: error => errors.push(error.message) };
  assert.equal(await chooseTerminalDestination({ open: async () => ({
    status: 'accepted', action: 'sidebar', values: { remember: true },
  }) }, prefs), 'sidebar');
  assert.deepEqual(errors, ['old native bridge', 'disk full']);
});
