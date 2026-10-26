import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('Sidebar renders ThemeIcons as codicons, not broken image URLs', async () => {
  const result = await build({ entryPoints: ['main_page/frontend/sidebar-shortcuts/icons.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm' });
  const { renderIconNode } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const window = new Window();
  const previous = globalThis.document;
  globalThis.document = window.document;
  try {
    const icon = renderIconNode({ kind: 'codicon', name: 'markdown' }, 20);
    assert.ok(icon.querySelector('.codicon.codicon-markdown'));
    assert.equal(icon.querySelector('img'), null);
    assert.equal(icon.firstElementChild.style.fontSize, '20px');
    assert.ok(renderIconNode({ kind: 'codicon', name: 'sync~spin' }).querySelector('.codicon-modifier-spin'));
    const bad = renderIconNode({ kind: 'codicon', name: 'bad" onclick="oops' }, 16, 'UI');
    assert.equal(bad.textContent, 'UI');
    assert.equal(bad.childElementCount, 0);
    assert.ok(renderIconNode({ kind: 'image', src: '/valid.svg' }).querySelector('img'));
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    await window.close();
  }
});
