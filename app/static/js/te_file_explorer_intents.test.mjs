import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileExplorerIntents, embeddedContext } from './te_file_explorer_intents.mjs';

function fixture(search = '') {
  const calls = [];
  const location = { search, href: '/app/file_explorer' };
  const dialog = { open: async () => ({ status: 'accepted', action: 'drawer' }) };
  const intents = createFileExplorerIntents({ location, dialog,
    api: { post: async (...args) => { calls.push(args); } }, randomId: () => 'a'.repeat(32) });
  return { calls, location, dialog, intents };
}
const contextSearch = '?te2_host_id=slot&clientInstanceId=client_111111111111&presentationId=current';

test('embedded file action uses own backend and exact context, never navigation', async () => {
  const { calls, location, intents } = fixture(contextSearch);
  await intents.openFile('/project/space name.py');
  assert.equal(location.href, '/app/file_explorer');
  assert.deepEqual(calls, [['intent', { intent: 'document.open',
    context: { clientId: 'client_111111111111', hostId: 'slot', presentationId: 'current' },
    payload: { path: '/project/space name.py' } }]]);
});
test('standalone file action preserves CM6 navigation', async () => {
  const { calls, location, intents } = fixture();
  await intents.openFile('/space name.py');
  assert.equal(location.href, '/app/file_editor?file=%2Fspace%20name.py');
  assert.equal(calls.length, 0);
});
test('incomplete embedded context fails rather than navigating away', async () => {
  assert.throws(() => embeddedContext('?te2_host_id=slot'), /incomplete/);
  const { location, intents } = fixture('?te2_host_id=slot');
  await assert.rejects(intents.openFile('/file'), /incomplete/);
  assert.equal(location.href, '/app/file_explorer');
});
test('embedded terminal uses shared destination dialog; cancellation has no effects', async () => {
  const { calls, intents, dialog } = fixture(contextSearch);
  await intents.openTerminal('/project/nested');
  assert.equal(calls[0][1].intent, 'terminal.createSession');
  assert.deepEqual(calls[0][1].payload, { directory: '/project/nested', destination: 'drawer' });
  dialog.open = async () => ({ status: 'cancelled', action: 'cancel' });
  await intents.openTerminal('/project/nested');
  assert.equal(calls.length, 1);
});
test('standalone terminal launch carries CWD and fresh-session seed', async () => {
  const { calls, location, intents } = fixture();
  await intents.openTerminal('/project/space name');
  const url = new URL(location.href, 'http://localhost');
  assert.equal(url.pathname, '/app/terminal');
  assert.equal(url.searchParams.get('cwd'), '/project/space name');
  assert.equal(url.searchParams.get('new_session'), 'a'.repeat(32));
  assert.equal(calls.length, 0);
});
