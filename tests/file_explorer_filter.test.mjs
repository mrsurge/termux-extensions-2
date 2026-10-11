import test from 'node:test';
import assert from 'node:assert/strict';
import { createListingFilter } from '../app/static/js/file_explorer_filter.mjs';

test('filter uses the shared worker, rejects excessive patterns and fences stale results', async () => {
  const workers = [], results = [];
  class FakeWorker {
    constructor(url) { assert.equal(url, '/static/js/file_picker_filter_worker.js'); workers.push(this); }
    postMessage(value) { this.request = value; }
    terminate() { this.stopped = true; }
  }
  const filter = createListingFilter((entries, error) => results.push({ entries, error }), FakeWorker);
  const entries = [{ name: 'a.py', path: '/a.py' }, { name: 'b.js', path: '/b.js' }];
  filter.apply(entries, 'py');
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.deepEqual(workers[0].request, { pattern: 'py', names: ['a.py', 'b.js'] });
  filter.apply(entries, '');
  workers[0].onmessage({ data: { indices: [0] } });
  assert.equal(results.length, 1);
  assert.equal(results[0].entries, entries);
  assert.equal(workers[0].stopped, true);
  filter.apply(entries, 'x'.repeat(257));
  assert.match(results.at(-1).error, /256/);
  filter.apply(entries, 'js');
  await new Promise(resolve => setTimeout(resolve, 140));
  workers[1].onmessage({ data: { indices: [1] } });
  assert.deepEqual(results.at(-1).entries, [entries[1]]);
  filter.cancel();
});
