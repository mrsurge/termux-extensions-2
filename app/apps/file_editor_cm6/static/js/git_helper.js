// app/apps/file_editor_cm6/static/js/git_helper.js
//
// Centralised Git API + state helpers for the Code CM6 frontend.
// The goal is to keep explorer.js / main.js lean by routing all
// git-related fetch logic through this module.

const API_BASE = '/api/app/file_editor_cm6/git';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function buildUrl(path, params) {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
      } else {
        url.searchParams.set(key, value);
      }
    });
  }
  return url;
}

async function requestJson(path, { method = 'GET', body, params, signal } = {}) {
  const url = buildUrl(path, params);
  const init = { method, headers: {}, signal };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { ...JSON_HEADERS };
  }

  const resp = await fetch(url, init);
  let payload = null;
  try {
    payload = await resp.json();
  } catch (err) {
    // fall through; if parsing fails we'll raise a generic error below
  }

  const okFlag = payload && typeof payload === 'object' ? payload.ok : resp.ok;
  if (!okFlag) {
    const err = new Error(
      payload?.error || resp.statusText || `Git request failed (${resp.status})`
    );
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }
  return payload?.data !== undefined ? payload.data : payload;
}

function makeEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, detail) {
      const bucket = listeners.get(event);
      if (!bucket) return;
      for (const handler of bucket) {
        try { handler(detail); } catch (err) { console.error('gitHelper listener error', err); }
      }
    }
  };
}

const emitter = makeEmitter();

export function onGitEvent(event, handler) {
  return emitter.on(event, handler);
}

export const gitApi = {
  status(signal) {
    return requestJson(`${API_BASE}/status`, { signal });
  },
  listBranches({ includeRemote = true } = {}, signal) {
    return requestJson(`${API_BASE}/branches`, {
      params: { remote: includeRemote ? '1' : '0' },
      signal,
    });
  },
  checkoutBranch({ name, create, startPoint } = {}, signal) {
    if (!name) throw new Error('checkoutBranch requires name');
    return requestJson(`${API_BASE}/checkout`, {
      method: 'POST',
      body: { name, create: Boolean(create), startPoint },
      signal,
    }).then((data) => {
      emitter.emit('branch:changed', data);
      return data;
    });
  },
  createBranch({ name, startPoint } = {}, signal) {
    if (!name) throw new Error('createBranch requires name');
    return requestJson(`${API_BASE}/branch`, {
      method: 'POST',
      body: { name, startPoint },
      signal,
    }).then((data) => {
      emitter.emit('branch:created', data);
      return data;
    });
  },
  listCommits({ ref = 'HEAD', limit = 50 } = {}, signal) {
    return requestJson(`${API_BASE}/commits`, {
      params: { ref, limit },
      signal,
    });
  },
  resetToCommit({ ref, mode = 'mixed' } = {}, signal) {
    if (!ref) throw new Error('resetToCommit requires ref');
    return requestJson(`${API_BASE}/reset`, {
      method: 'POST',
      body: { ref, mode },
      signal,
    }).then((data) => {
      emitter.emit('branch:changed', data);
      return data;
    });
  },
  stagePaths(paths, signal) {
    if (!Array.isArray(paths) || paths.length === 0) return Promise.resolve({ staged: [] });
    return requestJson(`${API_BASE}/stage`, {
      method: 'POST',
      body: { paths },
      signal,
    }).then((data) => {
      emitter.emit('stage:changed', data);
      return data;
    });
  },
  unstagePaths(paths, signal) {
    if (!Array.isArray(paths) || paths.length === 0) return Promise.resolve({ unstaged: [] });
    return requestJson(`${API_BASE}/unstage`, {
      method: 'POST',
      body: { paths },
      signal,
    }).then((data) => {
      emitter.emit('stage:changed', data);
      return data;
    });
  },
  commit({ message, body, amend = false } = {}, signal) {
    if (!message) throw new Error('commit requires message');
    return requestJson(`${API_BASE}/commit`, {
      method: 'POST',
      body: { message, body, amend },
      signal,
    }).then((data) => {
      emitter.emit('commit:created', data);
      return data;
    });
  },
  push({ remote, branch, force = false } = {}, signal) {
    return requestJson(`${API_BASE}/push`, {
      method: 'POST',
      body: { remote, branch, force },
      signal,
    }).then((data) => {
      emitter.emit('push:completed', data);
      return data;
    });
  },
  pull({ remote, branch, rebase = false } = {}, signal) {
    return requestJson(`${API_BASE}/pull`, {
      method: 'POST',
      body: { remote, branch, rebase },
      signal,
    }).then((data) => {
      emitter.emit('pull:completed', data);
      return data;
    });
  },
  fileCreate({ kind, baseDir, name, stage = false } = {}, signal) {
    return requestJson(`${API_BASE}/explorer/create`, {
      method: 'POST',
      body: { kind, baseDir, name, stage },
      signal,
    }).then((data) => {
      emitter.emit('explorer:mutated', data);
      return data;
    });
  },
  fileDelete({ path, stageRemoval = false } = {}, signal) {
    return requestJson(`${API_BASE}/explorer/delete`, {
      method: 'POST',
      body: { path, stageRemoval },
      signal,
    }).then((data) => {
      emitter.emit('explorer:mutated', data);
      return data;
    });
  },
  fileRename({ path, newPath, stage = false } = {}, signal) {
    return requestJson(`${API_BASE}/explorer/rename`, {
      method: 'POST',
      body: { path, newPath, stage },
      signal,
    }).then((data) => {
      emitter.emit('explorer:mutated', data);
      return data;
    });
  },
  fetchLog({ offset = 0, limit = 200 } = {}, signal) {
    return requestJson(`${API_BASE}/log`, {
      params: { offset, limit },
      signal,
    });
  },
};

export function withToast(handler) {
  return async (...args) => {
    const { toast } = handler || {};
    try {
      return await handler.action(...args);
    } catch (err) {
      console.error('gitHelper error', err);
      if (toast) {
        toast(err.message || 'Git operation failed');
      } else if (window.host?.toast) {
        window.host.toast(err.message || 'Git operation failed');
      }
      throw err;
    }
  };
}

export function createGitController({ onStatus } = {}) {
  let abortController = null;
  let cachedStatus = null;

  async function refreshStatus(options = {}) {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const data = await gitApi.status(abortController.signal);
      cachedStatus = data;
      onStatus?.(data);
      return data;
    } finally {
      abortController = null;
    }
  }

  function getStatusSnapshot() {
    return cachedStatus;
  }

  const controller = {
    refreshStatus,
    getStatusSnapshot,
    api: gitApi,
  };

  return controller;
}

export default {
  gitApi,
  onGitEvent,
  createGitController,
};
