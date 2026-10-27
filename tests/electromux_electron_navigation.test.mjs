import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElectronNavigation} from '../desktop_client/electromux/dist/electron-navigation.mjs';

test('TE2 consumes upstream window API, reuses one window and awaits real effects', async () => {
  const effects = [];
  const navigate = createElectronNavigation(async effect => { effects.push(effect); }, 'test-version');
  await navigate({action: 'reload'});
  await navigate({action: 'home', url: 'http://127.0.0.1:44100/electromux-shell/index.html'});
  assert.deepEqual(effects, [
    {kind: 'window.create', windowId: 1, options: {}},
    {kind: 'webContents', windowId: 1, action: 'reload'},
    {kind: 'window.load', windowId: 1, source: 'url', value: 'http://127.0.0.1:44100/electromux-shell/index.html'},
  ]);
});
test('invalid navigation never creates a surface and internal-app quit stays separate', async () => {
  const effects = [];
  const navigate = createElectronNavigation(async effect => { effects.push(effect); }, 'test-version');
  for (const params of [{action: 'quit'}, {action: 'reload', url: 'unexpected'},
    {action: 'home', url: 'file:///secret'}, {action: 'home', url: 'http://remote.test/electromux-shell/index.html'},
    {action: 'home', url: 'http://127.0.0.1:44100/electromux-shell/index.html?injected=true'}])
    await assert.rejects(navigate(params));
  assert.deepEqual(effects, []);
});
test('native failure is surfaced, not acknowledged as a successful navigation', async () => {
  const navigate = createElectronNavigation(async () => { throw new Error('Native window detached'); }, 'test-version');
  await assert.rejects(navigate({action: 'reload'}), /detached/);
});
test('failed ownership is retired without replay; a new explicit intent can reattach', async () => {
  const effects = [];
  let fail = true;
  const navigate = createElectronNavigation(async effect => {
    effects.push(effect);
    if (fail) throw new Error('Window detached');
  }, 'test-version');
  await assert.rejects(navigate({action: 'reload'}), /detached/);
  assert.equal(effects.length, 1);
  fail = false;
  await navigate({action: 'reload'});
  assert.deepEqual(effects.map(effect => effect.kind), ['window.create', 'window.create', 'webContents']);
});
