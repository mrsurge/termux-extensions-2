import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openProjectDirectory } from '../../../static/js/te_project_directory_intent.mjs';
import { createItemContextMenu } from '../../../static/js/te_file_explorer_context.mjs';

test('project dialog failure cancels its ticket; failed mutation is never retried', async () => {
  const calls = [];
  await assert.rejects(openProjectDirectory({ directory: '/chosen',
    request: async (params) => { calls.push(params); return { ok: true, ticket: 't', requiresConfirmation: true }; },
    dialog: { confirm: async () => { throw new Error('closed'); } } }), /closed/);
  assert.deepEqual(calls[1], { action: 'cancel', ticket: 't' });
  calls.length = 0;
  await assert.rejects(openProjectDirectory({ directory: '/chosen',
    request: async (params) => {
      calls.push(params);
      if (params.action === 'commit') throw new Error('uncertain');
      return { ok: true, ticket: 't', requiresConfirmation: false };
    }, dialog: { confirm: async () => { throw new Error('must not prompt'); } } }), /uncertain/);
  assert.equal(calls.length, 2);
});

test('standalone query is consumed once before host RPC and before snapshot restoration', async () => {
  const result = await build({ entryPoints: [new URL('../main_page/frontend/boot/project-launch.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false });
  const { consumeProjectLaunch } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  let search = '?project=%2Fchosen';
  const calls = [];
  const options = { get search() { return search; }, consume: () => { calls.push('consume'); search = ''; },
    connect: async () => { calls.push('connect'); }, confirm: async () => true,
    request: async (params) => { calls.push(params.action); return { ok: true, ticket: 't', requiresConfirmation: true }; } };
  await consumeProjectLaunch(options);
  await consumeProjectLaunch(options);
  assert.deepEqual(calls, ['consume', 'connect', 'prepare', 'commit']);
});

test('item context menu selects exact item, reuses enabled commands, and closes on scroll', () => {
  const win = new Window();
  globalThis.window = win; globalThis.document = win.document;
  const container = document.createElement('div'); document.body.appendChild(container);
  container.innerHTML = '<div data-menu-panel="file"><button data-command="file:open">Open</button><button data-command="file:download" disabled>Download</button></div><div data-menu-panel="edit"><button data-command="edit:rename">Rename</button></div><div class="item"></div>';
  const selected = [], commands = [];
  const menu = createItemContextMenu({ container, select: (...args) => selected.push(args), dispatch: (command) => commands.push(command) });
  const item = container.querySelector('.item');
  menu.bind(item, { path: '/chosen' }, { row: item });
  item.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  assert.equal(selected[0][0].path, '/chosen');
  const popup = container.querySelector('.fx-context-menu');
  assert.equal(popup.children.length, 2);
  popup.children[1].click();
  assert.deepEqual(commands, ['edit:rename']);
  assert.equal(container.querySelector('.fx-context-menu'), null);
  item.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  document.dispatchEvent(new win.Event('scroll'));
  assert.equal(container.querySelector('.fx-context-menu'), null);
  win.happyDOM.abort();
});

test('touch movement cancels long-press; completed long-press suppresses its click', async () => {
  const win = new Window();
  globalThis.window = win; globalThis.document = win.document;
  const container = document.createElement('div'); document.body.appendChild(container);
  container.innerHTML = '<div data-menu-panel="file"><button data-command="file:open">Open</button></div><div class="item"></div>';
  const item = container.querySelector('.item');
  let clicks = 0;
  const menu = createItemContextMenu({ container, select: () => {}, dispatch: () => {} });
  menu.bind(item, { path: '/chosen' }, { row: item });
  item.addEventListener('click', () => { clicks += 1; });
  item.dispatchEvent(new win.PointerEvent('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }));
  item.dispatchEvent(new win.PointerEvent('pointermove', { pointerType: 'touch', clientX: 30, clientY: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(container.querySelector('.fx-context-menu'), null);
  item.dispatchEvent(new win.PointerEvent('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.ok(container.querySelector('.fx-context-menu'));
  item.dispatchEvent(new win.PointerEvent('pointerup', { pointerType: 'touch' }));
  item.click();
  assert.equal(clicks, 0);
  menu.close(); win.happyDOM.abort();
});
