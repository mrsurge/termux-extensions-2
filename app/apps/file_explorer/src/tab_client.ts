import { packObject, unpackObject } from '../wire_codec';
import { decodeResponse, decodeSnapshot, objectFields, type ActiveMountIntent, type CatalogResult, type ClosedResult, type MethodResult, type MountIntent, type PathResult, type TabOptions, type TabRecord, type TabResult, type TerminalReply } from './tab_protocol';
export type { MountIntent, TabOptions, TabRecord, TerminalReply } from './tab_protocol';

type Listener = (...args: unknown[]) => void;
export interface TabSocket {
  connected: boolean; sendBuffer?: unknown[];
  on(name: string, callback: Listener): void;
  off(name: string, callback: Listener): void;
  emit(event: string, raw: Uint8Array, ack: (raw: unknown) => void): void;
  disconnect(): void;
}
export interface TabClient {
  readonly tab: TabRecord | null;
  request(method: 'tabs.defaultPath', params?: object): Promise<PathResult>;
  request(method: 'tabs.list' | 'tabs.catalog', params?: object): Promise<CatalogResult>;
  request(method: 'tabs.create' | 'tabs.attach' | 'tabs.update', params?: object): Promise<TabResult>;
  request(method: 'tabs.close', params?: object): Promise<ClosedResult>;
  request(method: string, params?: object): Promise<MethodResult>;
  mount(intent: ActiveMountIntent, preferences?: TabOptions, operationId?: string): Promise<TabRecord | null>;
  update(path: string, preferences: TabOptions): Promise<TabRecord>;
  list(): Promise<TabRecord[]>; catalog(): Promise<TabRecord[]>;
  terminal(method: string, params?: object): Promise<TerminalReply>;
  close(record: TabRecord, closeTerminal?: boolean): Promise<ClosedResult>;
  dispose(): void;
}
export function randomTabOperation(): string {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function mountIntent(url: URL, lastTab = ''): MountIntent {
  const tabId = url.searchParams.get('tab_id');
  if (tabId) return { kind: 'attach', tabId };
  if (url.searchParams.has('path')) return { kind: 'create', path: url.searchParams.get('path') || '~' };
  if (!url.searchParams.get('te2_host_id') && lastTab) return { kind: 'attach', tabId: lastTab };
  return { kind: 'splash' };
}
export function tabUrl(url: string | URL, tabId = '', baseUrl?: string | URL): URL {
  const next = new URL(url, baseUrl); next.searchParams.delete('path'); next.searchParams.delete('tab_create'); next.searchParams.delete('tab_id');
  if (tabId) next.searchParams.set('tab_id', tabId); return next;
}
export function createTabClient(socket: TabSocket, onSnapshot: (tab: TabRecord | null) => void, onError: (error: unknown) => void, onCatalog: () => void = () => {}): TabClient {
  let tab: TabRecord | null = null, generation = 0, mutationEpoch = 0, mounting = 0, requestId = 0;
  let lane: Promise<unknown> = Promise.resolve(), disposed = false;
  const pending = new Set<{ reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function request(method: 'tabs.defaultPath', params?: object): Promise<PathResult>;
  function request(method: 'tabs.list' | 'tabs.catalog', params?: object): Promise<CatalogResult>;
  function request(method: 'tabs.create' | 'tabs.attach' | 'tabs.update', params?: object): Promise<TabResult>;
  function request(method: 'tabs.close', params?: object): Promise<ClosedResult>;
  function request(method: string, params?: object): Promise<MethodResult>;
  function request(method: string, params: object = {}): Promise<MethodResult> {
    return new Promise((resolve, reject) => {
      if (!socket.connected || disposed) { reject(new Error('Tab connection is unavailable')); return; }
      const current = generation, id = ++requestId;
      const entry = { reject, timer: setTimeout(() => { pending.delete(entry); reject(new Error('Tab request timed out; no retry performed')); }, 15000) };
      const finish = () => { clearTimeout(entry.timer); pending.delete(entry); }; pending.add(entry);
      try { socket.emit('tab_request', packObject({ id, method, params }), raw => {
        finish();
        if (current !== generation || disposed) { reject(new Error('Tab connection changed')); return; }
        try { resolve(decodeResponse(unpackObject(raw), id, method)); } catch (error) { reject(error); }
      }); } catch (error) { finish(); reject(error); }
    });
  }
  const disconnected = () => {
    generation++; mutationEpoch++;
    for (const entry of pending) { clearTimeout(entry.timer); entry.reject(new Error('Tab connection lost; no retry performed')); }
    pending.clear(); if (socket.sendBuffer) socket.sendBuffer.length = 0;
  };
  const receive = (raw: unknown) => {
    try {
      const payload = decodeSnapshot(unpackObject(raw));
      if (payload.tab === null) { if (payload.closedId === tab?.id) { tab = null; mutationEpoch++; onSnapshot(null); } }
      else if (tab && payload.tab.id === tab.id && payload.tab.revision > tab.revision) { tab = payload.tab; onSnapshot(tab); }
    } catch (error) { onError(error); }
  };
  const resync = async () => {
    if (!tab) { onCatalog(); return; }
    const identity = tab.id, epoch = mutationEpoch;
    try {
      const result = await request('tabs.attach', { tabId: identity });
      if (tab?.id !== identity || epoch !== mutationEpoch) return;
      if (!result.tab || result.tab.revision >= tab.revision) { tab = result.tab; onSnapshot(tab); }
    } catch (error) { onError(error); }
  };
  const catalogEvent = (raw: unknown) => {
    try { if (objectFields(unpackObject(raw)).changed !== true) throw new Error('Invalid tab catalog event'); if (!mounting) onCatalog(); } catch (error) { onError(error); }
  };
  socket.on('disconnect', disconnected); socket.on('tab_snapshot', receive); socket.on('connect', resync); socket.on('tab_catalog', catalogEvent);
  async function mutation<Result>(run: () => Promise<Result>): Promise<Result> {
    const identity = tab?.id, connection = generation, epoch = mutationEpoch;
    const operation = lane.then(async () => {
      if (!identity || identity !== tab?.id || connection !== generation || epoch !== mutationEpoch) throw new Error('Tab selection changed');
      return run();
    }).catch(async (error: unknown) => {
      if (epoch === mutationEpoch && connection === generation && identity === tab?.id) { mutationEpoch++; await resync(); }
      throw error;
    });
    lane = operation.catch(() => {}); return operation;
  }
  return {
    request, get tab() { return tab; },
    async mount(intent, preferences, operationId) {
      const epoch = ++mutationEpoch, connection = generation; mounting++;
      try {
        const result = intent.kind === 'create' ? await request('tabs.create', { path: intent.path, options: preferences, operationId }) : await request('tabs.attach', { tabId: intent.tabId });
        if (epoch !== mutationEpoch || connection !== generation || disposed) throw new Error('Tab selection changed');
        tab = result.tab; return tab;
      } finally { mounting--; }
    },
    update(path, preferences) {
      const identity = tab?.id, connection = generation, epoch = mutationEpoch;
      return mutation(async () => {
        if (!tab) throw new Error('Tab selection changed');
        const result = await request('tabs.update', { tabId: identity, revision: tab.revision, path, options: preferences });
        if (connection !== generation || epoch !== mutationEpoch || identity !== tab?.id || !tab || !result.tab) throw new Error('Tab selection changed');
        if (result.tab.revision >= tab.revision) tab = result.tab; return tab;
      });
    },
    async list() { mutationEpoch++; tab = null; return (await request('tabs.list')).tabs; },
    async catalog() { return (await request('tabs.catalog')).tabs; },
    terminal(method, params = {}) {
      const identity = tab?.id, connection = generation, epoch = mutationEpoch;
      return mutation(async () => {
        if (!tab) throw new Error('Tab selection changed');
        const result = decodeTerminalReplyResult(await request(method, { ...params, tabId: identity, revision: tab.revision }));
        if (connection !== generation || epoch !== mutationEpoch || identity !== tab?.id || !tab) throw new Error('Tab selection changed');
        if (result.tab && result.tab.revision >= tab.revision) { tab = result.tab; onSnapshot(tab); } return result;
      });
    },
    close(record, closeTerminal = false) { return request('tabs.close', { tabId: record.id, revision: record.revision, closeTerminal }); },
    dispose() { disposed = true; disconnected(); socket.off('disconnect', disconnected); socket.off('tab_snapshot', receive); socket.off('connect', resync); socket.off('tab_catalog', catalogEvent); socket.disconnect(); },
  };
}
function decodeTerminalReplyResult(result: MethodResult): TerminalReply {
  // Request already decoded the wire boundary; reject non-terminal results here.
  if ('tabs' in result || 'path' in result || 'closedId' in result || ('tab' in result && result.tab === null)) throw new Error('Invalid terminal result');
  if ('tab' in result) {
    const { tab, ...fields } = result;
    if (tab === null) throw new Error('Invalid terminal result');
    return { ...fields, tab };
  }
  return result;
}
