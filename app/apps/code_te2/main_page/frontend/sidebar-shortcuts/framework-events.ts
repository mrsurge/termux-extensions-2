import type { ShellEvent, ShellEventPayload } from './types.ts';
import { asRecord, normStr } from './utils.ts';

export function frameworkEventsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/apps`;
}

export function parseShellEvent(raw: unknown): ShellEvent | null {
  let evt: unknown = raw;
  try {
    if (typeof evt === 'string') evt = JSON.parse(evt);
  } catch (_) {
    return null;
  }
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return null;
  return evt as ShellEvent;
}

export function shellPayload(evt: ShellEvent): ShellEventPayload {
  return asRecord(evt.payload) as ShellEventPayload;
}

export function deriveAppIdFromShellEvent(evt: ShellEvent): string {
  const data = asRecord(evt.data) as ShellEventPayload;
  const direct = normStr(evt.app_id || data.app_id);
  if (direct) return direct;

  const label = normStr(data.label);
  if (label.startsWith('app-worker:')) return normStr(label.slice('app-worker:'.length));
  if (label.startsWith('asgi-app:')) return normStr(label.slice('asgi-app:'.length));

  const specId = normStr(data.spec_id);
  if (specId.startsWith('app:')) {
    const parts = specId.split(':');
    if (parts.length >= 2) return normStr(parts[1]);
  }
  return '';
}

export function runningStateFromShellEvent(evt: ShellEvent): boolean | null {
  const data = asRecord(evt.data) as ShellEventPayload;
  const type = normStr(evt.type).toLowerCase();
  const status = normStr(data.status).toLowerCase();

  if (type === 'shell.exited' || type === 'shell.removed') return false;
  if (type === 'shell.ready' || type === 'shell.spawned') return true;
  if (type === 'shell.created') {
    if (!status || status === 'running') return true;
    return null;
  }
  if (type === 'shell.updated') {
    if (!status) return null;
    return status === 'running';
  }
  return null;
}
