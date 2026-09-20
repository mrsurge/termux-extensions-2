import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = path.resolve(import.meta.dirname, '..');
const entry = 'main_page/frontend/ui/projects-debug-modal.ts';
let sequence = 0;
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t) {
  const win = new Window();
  t.mock.method(globalThis, 'fetch', () => { throw Error('HTTP forbidden'); });
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = win;
  globalThis.document = win.document;
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    win.happyDOM.abort();
  });
  const alerts = [], confirmations = [], calls = [];
  let confirm = true, fail = false;
  win.teUI = { dialog: {
    confirm: async (message) => { confirmations.push(message); return confirm; },
    alert: async (message) => { alerts.push(message); },
  } };
  win.__codeTe2HandleProjectOpened = () => { throw Error('Local projection forbidden'); };
  const result = await build({ entryPoints: [path.join(root, entry)], bundle: true,
    platform: 'node', format: 'esm', write: false });
  const api = await import('data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64') + `#${sequence++}`);
  const rows = [
    { path: '/other', label: 'Other', is_active: false, opened_at: '2026-09-19' },
    { path: '/active', label: 'Active', is_active: true, opened_at: '2026-09-18', draft_count: 2 },
  ];
  const action = (method) => async (p) => {
    calls.push([method, p]);
    if (fail) throw Error('socket disconnected');
    return { ok: true };
  };
  const deps = {
    list: async () => ({ ok: true, data: rows }),
    reset: action('reset'), remove: action('remove'), open: action('open'),
  };
  api.configureProjectsModal(deps);
  await api.showProjectsDebugModal();
  const elements = () => [...document.querySelectorAll('.fe-projects-debug-row')];
  const visible = () => document.querySelector('#fe-projects-debug-modal').classList.contains('show');
  return { api, deps, calls, alerts, confirmations, elements, visible,
    cancel: () => { confirm = false; }, fail: () => { fail = true; } };
}

test('production Projects loads by host callback and sorts the active project first', async (t) => {
  const f = await fixture(t);
  assert.match(f.elements()[0].textContent, /Active.*\/active/);
  assert.match(f.elements()[0].textContent, /drafts=2/);
  assert.match(f.elements()[1].textContent, /Other.*\/other/);
  assert.ok(f.visible());
});

test('cancelling reset, remove or open sends no action', async (t) => {
  const f = await fixture(t);
  f.cancel();
  f.elements()[0].querySelector('button').click();
  f.elements()[1].querySelector('button').click();
  f.elements()[1].querySelector('.fe-projects-debug-info').click();
  await settle();
  assert.equal(f.confirmations.length, 3);
  assert.deepEqual(f.calls, []);
  assert.ok(f.visible());
});

test('inactive removal and active reset use distinct host methods, not local projection', async (t) => {
  const f = await fixture(t);
  f.elements()[1].querySelector('button').click();
  await settle();
  assert.deepEqual(f.calls, [['remove', '/other']]);
  assert.ok(f.visible());
  f.elements()[0].querySelector('button').click();
  await settle();
  assert.deepEqual(f.calls, [['remove', '/other'], ['reset', '/active']]);
  assert.equal(f.visible(), false);
  assert.deepEqual(f.alerts, []);
});

test('opening an inactive project awaits backend success before closing', async (t) => {
  const f = await fixture(t);
  let finish;
  f.deps.open = (p) => { f.calls.push(['open', p]); return new Promise((resolve) => { finish = resolve; }); };
  f.elements()[1].querySelector('.fe-projects-debug-info').click();
  await settle();
  assert.deepEqual(f.calls, [['open', '/other']]);
  assert.ok(f.visible());
  finish({ ok: true });
  await settle();
  assert.equal(f.visible(), false);
});

test('disconnected mutations remain visible with explicit errors and no fallback', async (t) => {
  const f = await fixture(t);
  f.fail();
  f.elements()[0].querySelector('button').click();
  f.elements()[1].querySelector('button').click();
  f.elements()[1].querySelector('.fe-projects-debug-info').click();
  await settle();
  assert.equal(f.alerts.length, 3);
  assert.ok(f.alerts.every((message) => message.includes('socket disconnected')));
  assert.ok(f.visible());
  assert.ok(f.elements().every((row) => !row.querySelector('button').disabled));
});

test('invalid list and rejected mutation results are not treated as success', async (t) => {
  const f = await fixture(t);
  f.deps.reset = async () => ({ ok: false, error: 'stale confirmation' });
  f.elements()[0].querySelector('button').click();
  await settle();
  assert.match(f.alerts[0], /stale confirmation/);
  assert.ok(f.visible());
  f.deps.list = async () => ({ ok: true, data: null });
  await f.api.showProjectsDebugModal();
  assert.match(document.querySelector('#fe-projects-debug-content').textContent, /Invalid Projects list/);
});

test('both entry points share the host-configured modal without HTTP or Explorer RPC', () => {
  const modal = fs.readFileSync(path.join(root, entry), 'utf8');
  assert.doesNotMatch(modal, /\bfetch\(|notifyExplorerRpc|__codeTe2HandleProjectOpened|runtimeDebug/);
  const host = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');
  assert.match(host, /configureProjectsModal\(\{/);
  for (const method of ['List', 'Reset', 'Remove', 'Open']) {
    assert.ok(host.includes(`requestUiIpc(UI_IPC_RPC_METHODS.hostProjects${method}`));
  }
  assert.match(fs.readFileSync(path.join(root, 'src/explorer/app/bootstrap.ts'), 'utf8'), /showProjectsDebugModal,/);
});
