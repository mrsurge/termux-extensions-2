// File Explorer owns durable tabs; URLs/last-tab storage are references only.
import { packObject, unpackObject } from './file_explorer_codec.js';
export function randomTabOperation() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function mountIntent(url, lastTab = '') {
  const tabId = url.searchParams.get('tab_id');
  if (tabId) return { kind: 'attach', tabId };
  if (url.searchParams.has('path')) return { kind: 'create', path: url.searchParams.get('path') || '~' };
  if (!url.searchParams.get('te2_host_id') && lastTab) return { kind: 'attach', tabId: lastTab };
  return { kind: 'splash' };
}

export function tabUrl(url, tabId, baseUrl) {
  const next = new URL(url, baseUrl);
  next.searchParams.delete('path');
  next.searchParams.delete('tab_create');
  next.searchParams.delete('tab_id');
  if (tabId) next.searchParams.set('tab_id', tabId);
  return next;
}

export function createTabClient(socket, onSnapshot, onError, onCatalog = () => {}) {
  let tab = null;
  let generation = 0;
  let mutationEpoch = 0;
  const pending = new Set();
  let lane = Promise.resolve();
  let disposed = false;
  let mounting = 0;
  let requestId = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (!socket.connected || disposed) return reject(new Error('Tab connection is unavailable'));
    const current = generation;
    const entry = { reject, timer: null };
    const finish = () => { clearTimeout(entry.timer); pending.delete(entry); };
    entry.timer = setTimeout(() => { finish(); reject(new Error('Tab request timed out; no retry performed')); }, 15000);
    pending.add(entry);
    const id = ++requestId;
    socket.emit('tab_request', packObject({ id, method, params }), raw => {
      finish();
      if (current !== generation || disposed) return reject(new Error('Tab connection changed'));
      try {
        const reply = unpackObject(raw);
        if (reply.id !== id) throw new Error('Tab response id mismatch');
        if (!reply.ok) throw new Error(reply.error || 'Tab request failed');
        resolve(reply.result);
      } catch (error) { reject(error); }
    });
  });
  const disconnected = () => {
    generation++;
    for (const entry of pending) { clearTimeout(entry.timer); entry.reject(new Error('Tab connection lost; no retry performed')); }
    pending.clear();
    if (socket.sendBuffer) socket.sendBuffer.length = 0;
  };
  const receive = raw => {
    let payload;
    try { payload = unpackObject(raw); } catch (error) { onError(error); return; }
    if (payload?.closedId === tab?.id) { tab = null; onSnapshot(null); }
    else if (payload?.tab?.id === tab?.id && payload.tab.revision > tab.revision) {
      tab = payload.tab; onSnapshot(tab);
    }
  };
  const resync = async () => {
    if (!tab) { onCatalog(); return; }
    const identity = tab.id;
    try {
      const result = await request('tabs.attach', { tabId: identity });
      if (tab?.id !== identity) return;
      tab = result.tab; onSnapshot(tab);
    } catch (error) { onError(error); }
  };
  socket.on('disconnect', disconnected);
  socket.on('tab_snapshot', receive);
  socket.on('connect', resync);
  const catalog = raw => {
    try { unpackObject(raw); if (!mounting) onCatalog(); } catch (error) { onError(error); }
  };
  socket.on('tab_catalog', catalog);
  return {
    request,
    get tab() { return tab; },
    async mount(intent, preferences, operationId) {
      mutationEpoch++;
      mounting++;
      try {
        const result = intent.kind === 'create'
          ? await request('tabs.create', { path: intent.path, options: preferences, operationId })
          : await request('tabs.attach', { tabId: intent.tabId });
        tab = result.tab;
        return tab;
      } finally { mounting--; }
    },
    update(path, preferences) {
      const identity = tab?.id;
      const connection = generation;
      const epoch = mutationEpoch;
      const run = async () => {
        if (!identity || identity !== tab?.id || connection !== generation || epoch !== mutationEpoch) throw new Error('Tab selection changed');
        const result = await request('tabs.update', { tabId: identity, revision: tab.revision, path, options: preferences });
        if (connection !== generation || identity !== tab?.id) throw new Error('Tab selection changed');
        // A peer event can overtake our ACK. Never regress its authoritative revision.
        if (result.tab.revision >= tab.revision) tab = result.tab;
        return tab;
      };
      const operation = lane.then(run).catch(async error => {
        // A rejected/uncertain mutation is not replayed. Read back authority,
        // and discard queued writes prepared before that resynchronization.
        if (epoch === mutationEpoch && connection === generation && identity === tab?.id) {
          mutationEpoch++;
          await resync();
        }
        throw error;
      });
      lane = operation.catch(() => {});
      return operation;
    },
    async list() { mutationEpoch++; tab = null; return (await request('tabs.list')).tabs; },
    async catalog() { return (await request('tabs.catalog')).tabs; },
    terminal(method, params = {}) {
      const identity = tab?.id;
      const connection = generation;
      const epoch = mutationEpoch;
      const operation = lane.then(async () => {
        if (!identity || identity !== tab?.id || connection !== generation || epoch !== mutationEpoch) throw new Error('Tab selection changed');
        const result = await request(method, { ...params, tabId: identity, revision: tab.revision });
        if (connection !== generation || identity !== tab?.id) throw new Error('Tab selection changed');
        if (result.tab && result.tab.revision >= tab.revision) { tab = result.tab; onSnapshot(tab); }
        return result;
      }).catch(async error => {
        if (epoch === mutationEpoch && connection === generation && identity === tab?.id) {
          mutationEpoch++; await resync();
        }
        throw error;
      });
      lane = operation.catch(() => {});
      return operation;
    },
    async close(record, closeTerminal = false) { return request('tabs.close', { tabId: record.id, revision: record.revision, closeTerminal }); },
    dispose() {
      disposed = true; disconnected();
      socket.off('disconnect', disconnected); socket.off('tab_snapshot', receive); socket.off('connect', resync);
      socket.off('tab_catalog', catalog);
      socket.disconnect();
    },
  };
}
