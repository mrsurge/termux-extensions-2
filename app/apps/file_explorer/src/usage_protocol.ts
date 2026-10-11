import { objectDto } from './api';

export interface UsageAck { scanId: string; accepted?: boolean; cancelled?: boolean }
export interface UsageEntry { path: string; name: string; type: string; bytes: number; complete: boolean }
export interface UsageUpdate {
  tabId: string; scanId: string; path: string;
  status: 'running' | 'complete' | 'partial' | 'cancelled' | 'error';
  mode: 'allocated' | 'apparent'; totalBytes: number; entriesVisited: number;
  entries: UsageEntry[]; complete: boolean; errorCount: number;
  errors: { path: string; message: string }[]; reason?: string;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid directory usage text');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid directory usage count');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid directory usage flag');
  return value;
}
export function usageAck(value: unknown, start: boolean): UsageAck {
  const raw = objectDto(value, 'directory usage acknowledgement');
  const scanId = text(raw.scanId);
  if (!scanId) throw new Error('Missing directory usage identity');
  return start ? { scanId, accepted: boolean(raw.accepted) } : { scanId, cancelled: boolean(raw.cancelled) };
}
export function usageUpdate(value: unknown): UsageUpdate {
  const raw = objectDto(value, 'directory usage');
  const { status, mode } = raw;
  if (status !== 'running' && status !== 'complete' && status !== 'partial' && status !== 'cancelled' && status !== 'error') throw new Error('Invalid directory usage status');
  if (mode !== 'allocated' && mode !== 'apparent') throw new Error('Invalid directory usage measurement');
  if (!Array.isArray(raw.entries) || raw.entries.length > 10000 || !Array.isArray(raw.errors) || raw.errors.length > 32) throw new Error('Invalid directory usage rows');
  const complete = boolean(raw.complete);
  if (complete !== (status === 'complete')) throw new Error('Inconsistent directory usage completion');
  return { tabId: text(raw.tabId), scanId: text(raw.scanId), path: text(raw.path), status, mode,
    totalBytes: count(raw.totalBytes), entriesVisited: count(raw.entriesVisited), complete, errorCount: count(raw.errorCount),
    entries: raw.entries.map(value => { const row = objectDto(value, 'directory usage row');
      return { path: text(row.path), name: text(row.name), type: text(row.type), bytes: count(row.bytes), complete: boolean(row.complete) }; }),
    errors: raw.errors.map(value => { const error = objectDto(value, 'directory usage error'); return { path: text(error.path), message: text(error.message) }; }),
    ...(raw.reason == null ? {} : { reason: text(raw.reason) }),
  };
}
