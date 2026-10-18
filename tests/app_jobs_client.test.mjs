import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/static/js/jobs_client.js', import.meta.url), 'utf8');
const jobs = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('bound app jobs helper uses only its own app for polling, cancel and deletion', async () => {
  const calls = [];
  const fetcher = async (url, options) => {calls.push([url, options?.method || 'GET']); return {ok: true, data: []};};
  const previous = globalThis.window;
  globalThis.window = {setTimeout};
  try {
    const client = jobs.createJobClient('/api/app/file_explorer/jobs');
    let updated;
    const poller = client.createJobPoller({fetcher, onUpdate: value => {updated = value;}});
    poller.start();
    await new Promise(resolve => setImmediate(resolve));
    poller.stop();
    assert.deepEqual(updated, []);
    await client.cancelJob('id/one', fetcher);
    await client.deleteJob('id/one', fetcher);
    assert.deepEqual(calls, [
      ['/api/app/file_explorer/jobs', 'GET'],
      ['/api/app/file_explorer/jobs/id%2Fone/cancel', 'POST'],
      ['/api/app/file_explorer/jobs/id%2Fone', 'DELETE'],
    ]);
  } finally {globalThis.window = previous;}
});
