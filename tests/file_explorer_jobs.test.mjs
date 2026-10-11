import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../app/apps/file_explorer/node_modules/esbuild/lib/main.js';
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../app/apps/file_explorer/src/jobs.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { createJobsController, observedJobDto } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
function fixture(options = {}) {
  const notices = [], dismissed = [], toasts = [], errors = [], feeds = [], deleted = [], cancelled = [], refresh = [];
  const factory = kind => callbacks => { let running = false; const feed = { kind, callbacks, start() { running = true; }, stop() { running = false; }, isRunning() { return running; } }; feeds.push(feed); return feed; };
  const controller = createJobsController({ client: { createJobPoller: factory('poll'), createJobStream: factory('stream'), cancelJob: async id => cancelled.push(id), deleteJob: async id => deleted.push(id) }, eventSourceAvailable: true, currentPath: () => '/dest', refresh: () => { refresh.push('/dest'); }, fetch: async () => new Response(JSON.stringify({ ok: true, data: { id: 'job', status: 'pending', type: 'bulk_copy' } })), notify: notice => notices.push(notice), dismiss: id => dismissed.push(id), toast: message => toasts.push(message), onError: error => errors.push(error), cleanupDelayMs: 10, ...options });
  return { controller, notices, dismissed, toasts, errors, feeds, deleted, cancelled, refresh };
}
const job = (status = 'running') => ({ id: 'job', type: 'bulk_copy', status });
test('observed DTO validates progress/results/status, preserving unrelated job metadata', () => {
  const raw = { ...job(), extra: 42, progress: { completed: 1, total: 2 }, result: { succeeded: [{ destination: '/dest' }], failed: [] } };
  assert.equal(observedJobDto(raw).extra, 42);
  for (const malformed of [{ ...job(), status: 'bad' }, { ...job(), progress: { total: '2' } }, { ...job(), result: { succeeded: ['oops'] } }]) assert.throws(() => observedJobDto(malformed), /Invalid/);
});
test('stream subscribes, cancel uses capability, completed updates refresh and delete once', async () => {
  const f = fixture(); f.controller.trackBulk(job(), { type: 'bulk-copy', destination: '/dest' });
  assert.equal(f.feeds[0].kind, 'stream'); assert.equal(f.notices[0].title, 'Copy items');
  await f.notices[0].actions[0].onClick(); assert.deepEqual(f.cancelled, ['job']);
  f.feeds[0].callbacks.onUpdate([{ ...job('succeeded'), result: { succeeded: [{ destination: '/dest' }], failed: [] } }], { partial: true });
  assert.deepEqual(f.refresh, ['/dest']); assert.equal(f.notices.at(-1).variant, 'success');
  await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(f.deleted, ['job']); assert.deepEqual(f.dismissed, ['job']); assert.equal(f.feeds[0].isRunning(), false); f.controller.dispose();
});
test('stream failure falls back to poller and fences stale stream updates', () => {
  const f = fixture(); f.controller.track(job()); const stream = f.feeds[0]; stream.callbacks.onError(new Error('SSE failed'));
  assert.equal(f.feeds[1].kind, 'poll'); const count = f.notices.length;
  stream.callbacks.onUpdate([job('failed')], { partial: true }); assert.equal(f.notices.length, count);
  f.feeds[1].callbacks.onUpdate([]); assert.deepEqual(f.dismissed, ['job']); assert.equal(f.feeds[1].isRunning(), false); f.controller.dispose();
});
test('partial updates retain missing jobs while full empty snapshots dismiss them', () => {
  const f = fixture(); f.controller.track(job()); const callbacks = f.feeds[0].callbacks;
  callbacks.onUpdate([], { partial: true }); assert.deepEqual(f.dismissed, []);
  callbacks.onUpdate([], { partial: false }); assert.deepEqual(f.dismissed, ['job']); f.controller.dispose();
});
test('malformed update cannot silently prune tracked jobs', () => {
  const f = fixture(); f.controller.track(job()); f.feeds[0].callbacks.onUpdate([{ id: 1 }], { partial: false }); assert.equal(f.errors.length, 1); assert.deepEqual(f.dismissed, []); f.controller.dispose();
});
test('controllers are independent and suspension/disposal fences late feed callbacks', async () => {
  const a = fixture(), b = fixture(); a.controller.track(job()); b.controller.track(job());
  const old = a.feeds[0].callbacks; a.controller.suspend(); old.onUpdate([job('failed')], { partial: true }); assert.equal(a.notices.length, 1); assert.equal(b.feeds[0].isRunning(), true);
  a.controller.resume(); assert.equal(a.feeds.length, 2); a.controller.dispose(); a.feeds[1].callbacks.onUpdate([job('failed')], { partial: true }); assert.equal(a.notices.length, 1); assert.deepEqual(a.deleted, []); b.controller.dispose();
});
test('suspending terminal cleanup cancels deletion and resume does not repeat completion toast', async () => {
  const f = fixture(); f.controller.track(job('succeeded')); const count = f.toasts.length;
  f.controller.suspend(); await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(f.deleted, []);
  f.controller.resume(); assert.equal(f.toasts.length, count); await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(f.deleted, ['job']); f.controller.dispose();
});
test('optional capability absence stays unavailable; create validates envelopes without retries', async () => {
  let requests = 0; const f = fixture({ client: {}, fetch: async () => { requests++; return new Response(JSON.stringify({ ok: false, error: 'no jobs route' }), { status: 404 }); } });
  assert.equal(f.controller.available(), false); f.controller.track(job()); assert.deepEqual(f.notices, []);
  await assert.rejects(f.controller.create('bulk_copy', {}), /no jobs route/); assert.equal(requests, 1); f.controller.dispose();
  const g = fixture(); assert.equal((await g.controller.create('bulk_copy', {})).id, 'job'); g.controller.dispose();
});
