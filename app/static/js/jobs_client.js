/**
 * Minimal client helper for polling the Job Registry API.
 *
 * Usage:
 *   import { createJobPoller } from '/static/js/jobs_client.js';
 *   const poller = createJobPoller({ onUpdate: (jobs) => render(jobs) });
 *   poller.start();
 *   // later poller.stop();
 */

export function createJobPoller({
  interval = 2500,
  fetcher,
  baseUrl = '/api/jobs',
  onUpdate = () => {},
  onError = (err) => console.error('[jobs]', err),
} = {}) {
  let timer = null;
  let active = false;

  const doFetch = async () => {
    if (!active) return;
    try {
      const response = await (fetcher || defaultFetch)(baseUrl);
      onUpdate(Array.isArray(response.data) ? response.data : response);
    } catch (error) {
      onError(error);
    } finally {
      schedule();
    }
  };

  const schedule = () => {
    if (!active) return;
    timer = window.setTimeout(doFetch, interval);
  };

  return {
    start() {
      if (active) return;
      active = true;
      doFetch();
    },
    stop() {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isRunning() {
      return active;
    },
  };
}

async function defaultFetch(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

export function createJobStream({
  jobId,
  onUpdate = () => {},
  onError = (err) => console.error('[jobs stream]', err),
} = {}) {
  if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
    return null;
  }

  let source = null;
  let active = false;

  const buildUrl = () => {
    const base = '/api/jobs/events';
    if (!jobId) return base;
    return `${base}?job_id=${encodeURIComponent(jobId)}`;
  };

  return {
    start() {
      if (active) return;
      const url = buildUrl();
      try {
        source = new EventSource(url);
      } catch (error) {
        onError(error);
        source = null;
        return;
      }
      active = true;

      source.onmessage = (event) => {
        if (!event?.data) return;
        try {
          const payload = JSON.parse(event.data);
          if (Array.isArray(payload?.jobs)) {
            onUpdate(payload.jobs, { partial: payload?.partial !== false });
          } else if (Array.isArray(payload)) {
            onUpdate(payload, { partial: true });
          }
        } catch (error) {
          console.error('[jobs stream] parse error', error);
        }
      };

      source.onerror = (event) => {
        onError(event);
        if (source) {
          source.close();
          source = null;
        }
        active = false;
      };
    },
    stop() {
      if (source) {
        source.close();
        source = null;
      }
      active = false;
    },
    isRunning() {
      return active;
    },
  };
}

export async function fetchJob(jobId, fetcher, baseUrl = '/api/jobs') {
  const response = await (fetcher || defaultFetch)(`${baseUrl}/${encodeURIComponent(jobId)}`);
  return response.data || response;
}

export async function cancelJob(jobId, fetcher, baseUrl = '/api/jobs') {
  const fn = fetcher || defaultFetch;
  const response = await fn(`${baseUrl}/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  return response.data || response;
}

export async function deleteJob(jobId, fetcher, baseUrl = '/api/jobs') {
  const fn = fetcher || defaultFetch;
  const response = await fn(`${baseUrl}/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  return response.data || response;
}

export function createJobClient(baseUrl) {
  return {
    createJobPoller: options => createJobPoller({...options, baseUrl}),
    fetchJob: (id, fetcher) => fetchJob(id, fetcher, baseUrl),
    cancelJob: (id, fetcher) => cancelJob(id, fetcher, baseUrl),
    deleteJob: (id, fetcher) => deleteJob(id, fetcher, baseUrl),
  };
}

if (typeof window !== 'undefined') {
  window.jobsClient = Object.assign(window.jobsClient || {}, {
    createJobPoller,
    createJobStream,
    fetchJob,
    cancelJob,
    deleteJob,
    createJobClient,
  });
}
