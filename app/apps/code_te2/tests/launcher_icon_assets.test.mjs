import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('Code TE2 launcher icon is packaged in both native asset inventories', () => {
  const android = JSON.parse(read('app/android_editor_assets_bundle.json'));
  assert.ok(JSON.stringify(android).includes('app/apps/code_te2/static/icons'));
  const desktop = JSON.parse(read('desktop_client/desktop_asset_inventory.json'));
  assert.ok(desktop.localPrefixes.includes('/apps/code_te2/static/icons/'));
});

test('both launchers shrink only the Code TE2 image, preserving the icon container', () => {
  for (const directory of ['app/android_shell', 'desktop_client/android_shell']) {
    const css = read(`${directory}/shell.css`);
    assert.match(css, /\.app-icon\s*\{[^}]*width:\s*52px;[^}]*height:\s*52px;/);
    assert.match(css, /\.app-icon-code-te2 img\s*\{\s*width:\s*40px;\s*height:\s*40px;/);
    assert.match(read(`${directory}/extensions/apps.js`),
      /if \(app\.id === "code_te2"\) icon\.classList\.add\("app-icon-code-te2"\)/);
  }
});
