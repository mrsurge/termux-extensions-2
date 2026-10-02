import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

test('standalone project action navigates with one directory intent', async () => {
  const { intents, calls, location } = fixture();
  await intents.openProject('/project/space name');
  assert.equal(new URL(location.href, 'http://localhost').searchParams.get('project'), '/project/space name');
  assert.equal(calls.length, 0);
});

test('embedded project prepare and consent stay on own backend lane', async () => {
  for (const accepted of [true, false]) {
    const calls = [];
    const location = { search: contextSearch, href: '/app/file_explorer' };
    const intents = createFileExplorerIntents({ location, randomId: () => 'id',
      dialog: { confirm: async () => accepted }, api: { post: async (route, body) => {
        calls.push([route, body]);
        // app_shell teFetch already unwraps the HTTP body's data field.
        return body.payload.action === 'prepare'
          ? { ok: true, ticket: 'bound', path: '/chosen', requiresConfirmation: true }
          : { ok: true };
      } } });
    await intents.openProject('/chosen');
    assert.equal(calls[0][1].intent, 'project.openDirectory');
    assert.deepEqual(calls[0][1].payload, { action: 'prepare', directory: '/chosen' });
    assert.deepEqual(calls[1][1].payload, { action: accepted ? 'commit' : 'cancel', ticket: 'bound' });
    assert.equal(location.href, '/app/file_explorer');
  }
});

test('project intent works through the actual app-shell HTTP data unwrap', async () => {
  const shell = readFileSync(new URL('../../templates/app_shell.html', import.meta.url), 'utf8');
  const start = shell.indexOf('async function teFetch(');
  const end = shell.indexOf('function appRequiresBackend(', start);
  assert.ok(start >= 0 && end > start);
  const requests = [];
  const teFetch = new Function('fetch', `${shell.slice(start, end)}; return teFetch;`)(async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ ok: true, data: body.payload.action === 'prepare'
      ? { ok: true, ticket: 'real-ticket', path: '/chosen', requiresConfirmation: true }
      : { ok: true } }) };
  });
  const intents = createFileExplorerIntents({
    location: { search: contextSearch, href: '/app/file_explorer' },
    dialog: { confirm: async () => true }, randomId: () => 'id',
    api: { post: (endpoint, body) => teFetch(`/api/app/file_explorer/${endpoint}`, { body: JSON.stringify(body) }) },
  });
  await intents.openProject('/chosen');
  assert.deepEqual(requests.map((request) => request.payload.action), ['prepare', 'commit']);
  assert.equal(requests[1].payload.ticket, 'real-ticket');
});
