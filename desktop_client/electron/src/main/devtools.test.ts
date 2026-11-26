import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { toggleDetachedDevTools } from './devtools';

test('DevTools is gated, detached, toggled and rejects disposed targets', () => {
  const calls: unknown[] = [];
  let opened = false;
  const target = {
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    openDevTools: (options: { mode: 'detach' }) => { calls.push(options); opened = true; },
    closeDevTools: () => { calls.push('close'); opened = false; },
  };
  assert.throws(() => toggleDetachedDevTools(false, target), /Enable/);
  assert.deepEqual(calls, []);
  toggleDetachedDevTools(true, target);
  assert.deepEqual(calls, [{ mode: 'detach' }]);
  toggleDetachedDevTools(true, target);
  assert.deepEqual(calls, [{ mode: 'detach' }, 'close']);
  assert.throws(() => toggleDetachedDevTools(true, null), /No live/);
  assert.throws(() => toggleDetachedDevTools(true, { ...target, isDestroyed: () => true }), /No live/);
});

test('toolbar targets the displayed app and desktop settings alone expose the control', async () => {
  const source = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf8');
  const [html, main, renderer, host, settings, css] = await Promise.all([
    source('../renderer/index.html'), source('./index.ts'), source('../renderer/index.ts'),
    source('../../../android_shell/host.js'), source('../../../android_shell/settings.js'),
    source('../../../android_shell/shell.css'),
  ]);
  assert.ok(html.indexOf('id="home"') < html.indexOf('id="devtools"'));
  assert.ok(html.indexOf('id="devtools"') < html.indexOf('id="reload"'));
  assert.match(html, /id="devtools"[^>]*hidden/);
  assert.match(main, /toggleDetachedDevTools\(settings.showDevToolsButton, appView\?\.webContents \?\? mainWindow\?\.webContents\)/);
  assert.match(renderer, /devToolsButton.hidden = settings.showDevToolsButton !== true/);
  assert.match(host, /const supportsDevToolsButton = !!parentBridge && !platformBridge && !nativeBridge/);
  assert.match(settings, /if \(desktopShellHost.supportsDevToolsButton\)/);
  assert.match(css, /\.settings-section\[hidden\]\s*\{\s*display: none/);
});
