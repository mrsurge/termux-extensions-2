import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const output = await build({
  entryPoints: [resolve(import.meta.dirname, '../main_page/frontend/core/utils.ts')],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
});
const paths = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('Code TE2 home fallback remains a server-resolved alias', () => {
  assert.equal(paths.HOME_DIR, '~');
  assert.equal(paths.toAbsolute(null), '~');
  assert.equal(paths.toAbsolute('file.txt'), '~/file.txt');
  assert.equal(paths.toAbsolute('~/file.txt'), '~/file.txt');
  assert.equal(paths.toAbsolute('file.txt', '/project'), '/project/file.txt');
  assert.equal(paths.toAbsolute('~/file.txt', null, '/srv/alice'), '/srv/alice/file.txt');
});

test('normalization retains home ancestry for the backend rather than inventing a filesystem root', () => {
  assert.equal(paths.simplifyAbsolute('~/a/./b/../c'), '~/a/c');
  assert.equal(paths.simplifyAbsolute('~/a/../../c'), '~/../c');
  assert.equal(paths.simplifyAbsolute('~/../../c'), '~/../../c');
  assert.equal(paths.parentDir('~'), '~/..');
  assert.equal(paths.parentDir('~/..'), '~/../..');
  assert.equal(paths.parentDir('~/a/..'), '~/..');
  assert.equal(paths.parentDir('~/a'), '~');
  assert.equal(paths.parentDir('/home/alice'), '/home');
  assert.equal(paths.parentDir('/'), '/');
  assert.equal(paths.simplifyAbsolute('/a/../../b'), '/b');
});

test('default bookmark is portable Home, not a literal environment variable', async () => {
  const bookmarks = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../static/bookmarks.json'), 'utf8'));
  assert.deepEqual(bookmarks, [{ name: 'Home', path: '~' }]);
});
