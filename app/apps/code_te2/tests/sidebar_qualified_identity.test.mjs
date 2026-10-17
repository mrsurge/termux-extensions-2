import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['main_page/frontend/sidebar-shortcuts/qualified-identity.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node' });
const { applySidebarWindowIdentity, readSidebarWindowIdentity } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('same shared sidebar state has a different main-page suffix in every launch URL', () => {
  const shared = '/app/als-rs?conversation_id=conv-a&te2_host_id=shared-host&te2_console_worker_id=old-long-id';
  for (const mainPageId of ['f0f0', 'c3d4']) {
    const url = new URL(shared, 'http://framework');
    const identity = { mainPageId, sidebarStateId: 'a1b2', sidebarWindowId: `als:a1b2.${mainPageId}` };
    applySidebarWindowIdentity(url, identity);
    assert.equal(url.searchParams.get('sidebarWindowId'), `als:a1b2.${mainPageId}`);
    assert.equal(url.searchParams.get('te2_console_worker_id'), `als:a1b2.${mainPageId}`);
    assert.equal(url.searchParams.get('conversation_id'), 'conv-a');
    assert.equal(url.searchParams.get('te2_host_id'), 'shared-host');
  }
  assert.equal(new URL(shared, 'http://framework').searchParams.has('mainPageId'), false);
});

test('cross-parent or cross-state receipts cannot become launch identities', () => {
  const valid = { mainPageId: 'f0f0', sidebarStateId: 'a1b2', sidebarWindowId: 'als:a1b2.f0f0' };
  assert.deepEqual(readSidebarWindowIdentity(valid), valid);
  for (const bad of [{}, { ...valid, mainPageId: 'c3d4' }, { ...valid, sidebarStateId: 'zzzz' }]) {
    assert.throws(() => readSidebarWindowIdentity(bad), /qualified sidebar/);
  }
});
