import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('ES module filenames share the real JavaScript icon and color', async () => {
  const root = new URL('../../../static/vendor/seti-icons/', import.meta.url);
  const source = await readFile(new URL('seti-icons.js', root), 'utf8');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ json: async () =>
    JSON.parse(await readFile(new URL(String(url).split('/').pop(), root), 'utf8')) });
  try {
    const { getIcon } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const js = await getIcon('example.js');
    assert.equal(js.iconName, 'javascript');
    assert.ok(js.svg);
    for (const name of ['example.mjs', 'example.test.mjs', 'example.MJS']) {
      assert.deepEqual(await getIcon(name), js);
    }
    assert.equal((await getIcon('README.md')).iconName, 'info');
    assert.equal((await getIcon('example.unknown')).iconName, 'default');
  } finally { globalThis.fetch = originalFetch; }
});
