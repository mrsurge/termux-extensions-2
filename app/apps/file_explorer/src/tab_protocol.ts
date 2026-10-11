import { usageAck, type UsageAck } from './usage_protocol';

export interface TabOptions {
  showHidden: boolean;
  view: 'list' | 'grid';
  sortBy: 'name' | 'size' | 'type' | 'date';
  sortAsc: boolean;
}
export interface TabRecord {
  id: string; path: string; revision: number; options: TabOptions;
  shellId: string | null; directoryLocked: boolean; shellTrackingId: string | null;
}
export type MountIntent = { kind: 'splash' } | { kind: 'attach'; tabId: string } | { kind: 'create'; path: string };
export type ActiveMountIntent = Exclude<MountIntent, { kind: 'splash' }>;
export interface DirectoryTracking { state: string; path: string }
export interface TerminalReply {
  tab?: TabRecord; token?: string; shellId?: string; ansi?: string; pendingBytes?: Uint8Array;
  outputOffset?: number; columns?: number; rows?: number; directoryTracking?: DirectoryTracking;
}
export interface TabResult { tab: TabRecord | null }
export interface CatalogResult { tabs: TabRecord[] }
export interface PathResult { path: string }
export interface ClosedResult { closedId: string }
export type MethodResult = TabResult | CatalogResult | PathResult | ClosedResult | TerminalReply | UsageAck;
export type TabSnapshot = { tab: TabRecord } | { tab: null; closedId: string };

export function objectFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('Expected protocol object');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
function integer(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error(`Invalid ${label}`);
  return value;
}
export function decodeTabOptions(value: unknown): TabOptions {
  const body = objectFields(value);
  if (typeof body.showHidden !== 'boolean' || typeof body.sortAsc !== 'boolean') throw new Error('Invalid tab option booleans');
  if (body.view !== 'list' && body.view !== 'grid') throw new Error('Invalid tab view');
  if (body.sortBy !== 'name' && body.sortBy !== 'size' && body.sortBy !== 'type' && body.sortBy !== 'date') throw new Error('Invalid tab sort');
  return { showHidden: body.showHidden, view: body.view, sortBy: body.sortBy, sortAsc: body.sortAsc };
}
export function decodeTabRecord(value: unknown): TabRecord {
  const body = objectFields(value);
  if (body.shellId !== null && typeof body.shellId !== 'string') throw new Error('Invalid tab shell');
  if (typeof body.directoryLocked !== 'boolean') throw new Error('Invalid directory lock');
  if (body.shellTrackingId !== null && (typeof body.shellTrackingId !== 'string' || !/^[0-9a-f]{32}$/.test(body.shellTrackingId) || body.shellId === null)) throw new Error('Invalid shell tracking generation');
  return { id: text(body.id, 'tab id'), path: text(body.path, 'tab path'), revision: integer(body.revision, 'tab revision', 1),
    options: decodeTabOptions(body.options), shellId: body.shellId, directoryLocked: body.directoryLocked, shellTrackingId: body.shellTrackingId };
}
export function decodeTabResult(value: unknown): TabResult {
  const body = objectFields(value);
  return { tab: body.tab === null ? null : decodeTabRecord(body.tab) };
}
export function decodeCatalogResult(value: unknown): CatalogResult {
  const body = objectFields(value);
  if (!Array.isArray(body.tabs)) throw new Error('Invalid tab catalog');
  return { tabs: body.tabs.map(decodeTabRecord) };
}
export function decodeSnapshot(value: unknown): TabSnapshot {
  const body = objectFields(value);
  return body.tab === null ? { tab: null, closedId: text(body.closedId, 'closed tab id') } : { tab: decodeTabRecord(body.tab) };
}
export function decodeTerminalReply(value: unknown): TerminalReply {
  const body = objectFields(value), result: TerminalReply = {};
  if ('tab' in body) result.tab = decodeTabRecord(body.tab);
  for (const key of ['token', 'shellId'] as const) if (key in body) result[key] = text(body[key], key);
  if ('ansi' in body) { if (typeof body.ansi !== 'string') throw new Error('Invalid terminal ANSI'); result.ansi = body.ansi; }
  if ('pendingBytes' in body) { if (!(body.pendingBytes instanceof Uint8Array)) throw new Error('Invalid terminal pending bytes'); result.pendingBytes = body.pendingBytes; }
  for (const key of ['outputOffset', 'columns', 'rows'] as const) if (key in body) result[key] = integer(body[key], key);
  if ('directoryTracking' in body) {
    const tracking = objectFields(body.directoryTracking);
    if (typeof tracking.state !== 'string' || typeof tracking.path !== 'string') throw new Error('Invalid terminal directory status');
    result.directoryTracking = { state: tracking.state, path: tracking.path };
  }
  return result;
}
export function decodeMethodResult(method: string, value: unknown): MethodResult {
  if (method === 'directoryUsage.start' || method === 'directoryUsage.cancel') return usageAck(value, method.endsWith('.start'));
  if (method === 'tabs.list' || method === 'tabs.catalog') return decodeCatalogResult(value);
  if (method === 'tabs.create' || method === 'tabs.attach') return decodeTabResult(value);
  if (method === 'tabs.update') return { tab: decodeTabRecord(objectFields(value).tab) };
  const body = objectFields(value);
  if (method === 'tabs.defaultPath') return { path: text(body.path, 'default path') };
  if (method === 'tabs.close') return { closedId: text(body.closedId, 'closed tab id') };
  if (['terminal.start', 'terminal.status', 'terminal.close', 'terminal.directoryLock'].includes(method)) {
    const reply = decodeTerminalReply(body);
    if (!reply.tab) throw new Error('Missing terminal tab');
    return reply;
  }
  if (['terminal.stream', 'terminal.input', 'terminal.resize', 'terminal.checkpoint'].includes(method)) {
    const reply = decodeTerminalReply(body);
    if (!reply.shellId || (method === 'terminal.stream' && !reply.token)
        || (method === 'terminal.checkpoint' && (reply.ansi === undefined || reply.pendingBytes === undefined || reply.outputOffset === undefined || reply.columns === undefined || reply.rows === undefined))) throw new Error('Incomplete terminal result');
    return reply;
  }
  throw new Error('Unsupported tab method');
}
export function decodeResponse(raw: Record<string, unknown>, id: number, method: string): MethodResult {
  if (raw.id !== id) throw new Error('Tab response id mismatch');
  if (raw.ok === false) throw new Error(typeof raw.error === 'string' && raw.error ? raw.error : 'Tab request failed');
  if (raw.ok !== true) throw new Error('Invalid tab response status');
  return decodeMethodResult(method, raw.result);
}
