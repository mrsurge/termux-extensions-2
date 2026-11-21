import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { Window } from 'happy-dom';

const appRoot = path.resolve(import.meta.dirname, '..');

async function importDrawerSizing() {
  const result = await build({
    entryPoints: [
      path.join(appRoot, 'main_page/frontend/ui/drawer-sizing.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('legacy pixel fallback retains its cap outside a measured portrait split', async () => {
  const { clampTerminalDrawerHeight } = await importDrawerSizing();

  assert.equal(clampTerminalDrawerHeight(700, 150, true, 800), 397);
  assert.equal(clampTerminalDrawerHeight(360, 150, true, 800), 360);
  assert.equal(clampTerminalDrawerHeight(700, 150, false, 800), 700);
  assert.equal(clampTerminalDrawerHeight(900, 150, false, 800), 800);
  assert.equal(clampTerminalDrawerHeight(350, 150, true, 300), 300);
});

test('portrait split preserves usable content ratio and transfers exactly the overlay height', async () => {
  const result = await build({entryPoints:[path.join(appRoot,'main_page/frontend/ui/portrait-drawer-split.ts')],
    bundle:true,format:'esm',platform:'node',write:false});
  const {projectDrawer} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const ratio = 0.4, header=32, strip=44;
  for (const usable of [1000,400,260,1000]) {
    assert.equal(projectDrawer({usable,base:header},ratio),header+usable*ratio);
    assert.equal(projectDrawer({usable,base:header+strip},ratio),header+strip+usable*ratio);
  }
  assert.equal(projectDrawer({usable:200,base:header},0.95),header+120);
  assert.equal(projectDrawer({usable:100,base:header},0.95),header+50);
});

test('desktop portrait spans the tab bar through the available workspace', async () => {
  const { resizedDrawerHeight } = await importDrawerSizing();
  const win = new Window();
  const doc = win.document;
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    doc.body.innerHTML = '<main class="fe-root layout-mobile desktop-user-agent"><section class="fe-editor-container"></section><aside id="terminal-drawer"><header class="drawer-tab-bar"></header></aside></main>';
    doc.querySelector('.fe-editor-container').getBoundingClientRect = () => ({ top: 100 });
    doc.querySelector('#terminal-drawer').getBoundingClientRect = () => ({ bottom: 1150 });
    doc.querySelector('header').getBoundingClientRect = () => ({ height: 32 });
    assert.equal(resizedDrawerHeight(50, 150, 800), 50);
    assert.equal(resizedDrawerHeight(-10, 150, 800), 32);
    assert.equal(resizedDrawerHeight(2400, 150, 800), 1050);
    doc.querySelector('main').classList.remove('desktop-user-agent');
    assert.equal(resizedDrawerHeight(1050, 150, 800), 397);
  } finally {
    if (original === undefined) delete globalThis.document; else globalThis.document = original;
    await win.happyDOM.close();
  }
});
