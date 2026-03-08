const CACHE = new Map();
const INFLIGHT = new Map();

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

async function fetchKeys(keys) {
  const unique = Array.from(new Set(keys.filter((key) => typeof key === 'string' && key.trim() !== '')));
  const waitList = unique
    .map((key) => INFLIGHT.get(key))
    .filter((entry) => entry && entry.promise)
    .map((entry) => entry.promise);
  if (waitList.length) {
    await Promise.allSettled(waitList);
  }

  const pending = unique.filter((key) => !CACHE.has(key) && !INFLIGHT.has(key));
  if (!pending.length) return;

  const params = new URLSearchParams();
  pending.forEach((key) => {
    params.append('key', key);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    INFLIGHT.set(key, { promise, resolve, reject });
  });

  try {
    const response = await fetch(`/api/state?${params.toString()}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      const error = new Error(body.error || `HTTP ${response.status} ${response.statusText}`);
      pending.forEach((key) => {
        const inflight = INFLIGHT.get(key);
        if (inflight && inflight.reject) inflight.reject(error);
        INFLIGHT.delete(key);
      });
      throw error;
    }
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    pending.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        CACHE.set(key, data[key]);
      } else {
        CACHE.set(key, undefined);
      }
      const inflight = INFLIGHT.get(key);
      if (inflight && inflight.resolve) inflight.resolve();
      INFLIGHT.delete(key);
    });
  } catch (error) {
    pending.forEach((key) => {
      const inflight = INFLIGHT.get(key);
      if (inflight && inflight.reject) inflight.reject(error);
      INFLIGHT.delete(key);
    });
    throw error;
  }
}

function fromCache(key, defaultValue) {
  if (!CACHE.has(key)) return defaultValue;
  const value = CACHE.get(key);
  return value === undefined ? defaultValue : value;
}

async function get(key, defaultValue = null) {
  try {
    if (!CACHE.has(key)) {
      await fetchKeys([key]);
    }
    return fromCache(key, defaultValue);
  } catch (error) {
    console.warn('[teState] get failed for', key, error);
    return defaultValue;
  }
}

function getSync(key, defaultValue = null) {
  return fromCache(key, defaultValue);
}

async function preload(keys) {
  try {
    await fetchKeys(keys);
  } catch (error) {
    console.warn('[teState] preload failed', keys, error);
  }
}

async function set(key, value) {
  const payload = { key, value };
  const response = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status} ${response.statusText}`);
  }
  const stored = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : value;
  CACHE.set(key, stored);
  return stored;
}

async function merge(key, value) {
  const payload = { key, value, merge: true };
  const response = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status} ${response.statusText}`);
  }
  const stored = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : value;
  CACHE.set(key, stored);
  return stored;
}

async function remove(keys) {
  const list = toArray(keys);
  if (!list.length) return { removed: 0 };
  const params = new URLSearchParams();
  list.forEach((key) => params.append('key', key));
  const response = await fetch(`/api/state?${params.toString()}`, { method: 'DELETE' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status} ${response.statusText}`);
  }
  list.forEach((key) => CACHE.delete(key));
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  return data;
}

function has(key) {
  return CACHE.has(key) && CACHE.get(key) !== undefined;
}

const teState = {
  get,
  getSync,
  set,
  merge,
  remove,
  preload,
  has,
};

if (!window.teState) {
  window.teState = teState;
}

export default teState;
