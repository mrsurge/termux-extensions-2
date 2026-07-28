import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

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

test('mobile drawer sizing caps normal open height at the live 397px bound', async () => {
  const { clampTerminalDrawerHeight } = await importDrawerSizing();

  assert.equal(clampTerminalDrawerHeight(700, 150, true, 800), 397);
  assert.equal(clampTerminalDrawerHeight(360, 150, true, 800), 360);
  assert.equal(clampTerminalDrawerHeight(700, 150, false, 800), 700);
  assert.equal(clampTerminalDrawerHeight(900, 150, false, 800), 800);
  assert.equal(clampTerminalDrawerHeight(350, 150, true, 300), 300);
});
