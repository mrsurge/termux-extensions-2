import { unpackObject } from '../wire_codec';
import { randomTabOperation, type TabSocket } from './tab_client';
import { usageAck, usageUpdate, type UsageEntry } from './usage_protocol';
interface Context { tabId: string; path: string }
interface Options { container: HTMLElement; current(): Context | null; request(method: string, params: object): Promise<unknown>; notify(message: string): void; changed?(): void }
interface Scan extends Context { scanId: string; finished: boolean }
export function createDirectoryUsage(options: Options) {
  const { container } = options, document = container.ownerDocument;
  const header = container.querySelector<HTMLElement>('[data-role="usage-header"]')!;
  const status = container.querySelector<HTMLElement>('[data-role="usage-status"]')!;
  const cancel = container.querySelector<HTMLButtonElement>('[data-action="usage-cancel"]')!;
  let socket: TabSocket | null = null, scan: Scan | null = null, disposed = false;
  let enabled = false;
  const preferenceKey = 'te2:file-explorer:directory-usage:v1';
  try { enabled = document.defaultView?.localStorage.getItem(preferenceKey) === 'true'; } catch { /* Optional preference storage. */ }
  const entries = new Map<string, UsageEntry>();
  const matches = (item: Scan): boolean => { const current = options.current(); return !disposed && scan === item && current?.tabId === item.tabId && current.path === item.path; };
  function size(value: number): string { const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; } return `${value.toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`; }
  function refresh(): void {
    for (const node of container.querySelectorAll<HTMLElement>('.fx-item[data-path], .fx-tile[data-path]')) {
      const row = node.classList.contains('fx-item'); let target = node.querySelector<HTMLElement>(row ? '.fx-size' : '.fx-usage-icon-size');
      if (!target && !row && scan) { target = document.createElement('span'); target.className = 'fx-usage-icon-size'; node.append(target); }
      if (!target) continue;
      if (row && target.dataset.normalSize === undefined) target.dataset.normalSize = target.textContent || '';
      target.classList.toggle('fx-usage-pill', !!scan);
      if (!scan) { if (row) { target.textContent = target.dataset.normalSize || ''; target.removeAttribute('title'); } else target.remove(); continue; }
      const entry = entries.get(node.dataset.path || ''); target.textContent = entry ? `${size(entry.bytes)}${entry.complete ? '' : '…'}` : scan.finished ? '—' : '…'; target.title = entry?.complete ? 'Disk usage' : 'Partial or pending disk usage';
    }
  }
  function cancelRequest(item: Scan): void { if (socket?.connected) void options.request('directoryUsage.cancel', { scanId: item.scanId }).catch(() => {}); }
  function close(): void { const item = scan; scan = null; if (item && !item.finished) cancelRequest(item); entries.clear(); header.hidden = true; refresh(); }
  const receive = (raw: unknown): void => {
    const item = scan; if (!item || item.finished || !matches(item)) return;
    try {
      const body = unpackObject(raw); if (body.scanId !== item.scanId || body.tabId !== item.tabId || body.path !== item.path) return;
      const update = usageUpdate(body); for (const entry of update.entries) entries.set(entry.path, entry);
      item.finished = update.status !== 'running'; cancel.hidden = item.finished;
      status.textContent = `${size(update.totalBytes)} ${update.mode === 'allocated' ? 'on disk' : 'apparent'} · ${update.status === 'running' ? 'calculating…' : update.status === 'complete' ? 'complete' : update.status === 'cancelled' ? 'cancelled · partial' : update.status === 'error' ? 'failed' : 'partial'}`;
      status.title = update.errors.map(error => `${error.path}: ${error.message}`).join('\n'); refresh(); options.changed?.();
    } catch (error) { cancelRequest(item); item.finished = true; cancel.hidden = true; status.textContent = error instanceof Error ? error.message : 'Invalid directory usage response'; refresh(); }
  };
  const disconnected = (): void => { if (scan && !scan.finished) { scan.finished = true; cancel.hidden = true; status.textContent = 'Usage interrupted · partial'; refresh(); } };
  function bindSocket(next: TabSocket): void { if (socket) { socket.off('directory_usage', receive); socket.off('disconnect', disconnected); } socket = next; socket.on('directory_usage', receive); socket.on('disconnect', disconnected); }
  async function open(): Promise<void> {
    enabled = true;
    if (disposed) return; const context = options.current(); if (!context || !socket?.connected) { options.notify('Open a tab and connect before measuring directory usage.'); return; }
    close(); const item: Scan = { ...context, scanId: randomTabOperation(), finished: false }; scan = item;
    header.hidden = false; cancel.hidden = false; cancel.disabled = false; status.textContent = 'Calculating directory usage…'; refresh();
    try { const ack = usageAck(await options.request('directoryUsage.start', { scanId: item.scanId }), true); if (!matches(item)) { cancelRequest(item); return; } if (ack.scanId !== item.scanId || !ack.accepted) throw new Error('Directory usage request was not accepted'); }
    catch (error) { if (!matches(item) || item.finished) return; cancelRequest(item); item.finished = true; cancel.hidden = true; status.textContent = error instanceof Error ? error.message : 'Directory usage failed'; refresh(); }
  }
  const cancelled = (): void => {
    const item = scan; if (!item || item.finished || cancel.disabled) return; cancel.disabled = true;
    void options.request('directoryUsage.cancel', { scanId: item.scanId }).then(value => { const ack = usageAck(value, false); if (ack.scanId !== item.scanId) throw new Error('Directory usage cancellation identity changed'); if (matches(item) && !item.finished) { item.finished = true; cancel.hidden = true; status.textContent = 'Usage cancelled · partial'; refresh(); } }).catch(error => { if (matches(item) && !item.finished) { cancel.disabled = false; status.textContent = error instanceof Error ? error.message : 'Cancellation failed'; } });
  };
  cancel.addEventListener('click', cancelled);
  function toggle(): void {
    enabled = !enabled;
    try { document.defaultView?.localStorage.setItem(preferenceKey, String(enabled)); } catch { /* Optional preference storage. */ }
    if (enabled) void open(); else close();
    options.changed?.();
  }
  return { open, close, bindSocket, refresh, toggle, isEnabled: () => enabled,
    sizeFor: (path: string): number | undefined => {
      const entry = scan ? entries.get(path) : undefined;
      return entry && (entry.complete || entry.bytes > 0) ? entry.bytes : undefined;
    },
    directoryReady(): void { if (enabled && (!scan || !matches(scan))) void open(); },
    sync(): void { if (scan && !matches(scan)) close(); }, dispose(): void { close(); disposed = true; socket?.off('directory_usage', receive); socket?.off('disconnect', disconnected); socket = null; cancel.removeEventListener('click', cancelled); } };
}
