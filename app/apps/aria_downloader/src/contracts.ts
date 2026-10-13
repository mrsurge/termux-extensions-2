export interface Host {
  setTitle?(title: string): void;
  toast?(message: string): void;
  onBeforeExit?(callback: () => void): void;
  loadState?(fallback?: Record<string, unknown>): unknown;
  saveState?(state: Record<string, unknown>): void;
}
export interface API {
  get(path: string): Promise<unknown>;
  post(path: string, payload: Record<string, unknown>): Promise<unknown>;
}
export interface Task {
  gid: string; status: string; name: string;
  totalLength: number; completedLength: number; downloadSpeed: number;
  uploadSpeed: number; progress: number; connections: number;
  errorMessage?: string | null;
}
export type Group = 'active' | 'waiting' | 'stopped';
export type Downloads = Record<Group, Task[]>;
export interface Status {
  version?: string | { version?: string; status?: string } | null;
  globalStat?: { numWaiting?: string | number; numStoppedTotal?: string | number };
}
export interface Logs { stdout: string[]; stderr: string[] }
export interface ShellRecord {
  id: string; label?: string; cwd?: string; pid?: number | null; exit_code?: number | null;
  created_at?: number | null; updated_at?: number | null;
  stats?: { alive?: boolean; cpu_percent?: number; memory_rss?: number; uptime?: number };
  logs?: { stdout_tail: string[]; stderr_tail: string[] };
}
export interface ShellConfig { label?: string; cwd?: string; created_at?: number | null }
export interface ShellPayload { record: ShellRecord; config?: ShellConfig | null }
export interface ShellResponse { shell: ShellPayload | null }
export interface State {
  downloads: Downloads; selected: Set<string>; status: Status | null;
  sortKey: string; sortDir: string; lastDirectory: string;
  pollTimer: ReturnType<typeof setInterval> | null;
  lastErrorMessage: string | null; errorToastShown: boolean; loading: boolean;
  lastRefresh: number | null; browsePath: string;
}
export interface ShellState {
  record: ShellRecord | null; config: ShellConfig | null; loading: boolean;
  error: string | null; actionPending: boolean; lastLogs: Logs | null;
}
export interface RefreshOptions { manual?: boolean }
export interface ShellRefreshOptions { includeLogs?: boolean; tail?: number; silent?: boolean }
export interface ActionOptions { message?: string }
declare global {
  interface Window {
    __ariaDownloaderHost?: Host;
    __ariaDownloaderErrorsBound?: boolean;
    teUI?: { dialog: { confirm(message: string): Promise<boolean> } };
    teFilePicker?: { openDirectory(options: { startPath: string; title: string; selectLabel: string }): Promise<unknown> };
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || 'Unknown error');
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${name}`);
  return value;
}
function optionalText(value: unknown, name: string): string | undefined {
  return value == null ? undefined : text(value, name);
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function optionalNumber(value: unknown, name: string): number | undefined {
  return value == null ? undefined : number(value, name);
}
function strings(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Invalid string list');
  return value.map((item: unknown) => text(item, 'string list entry'));
}
export function readDownloads(value: unknown): Downloads {
  const data = object(value);
  function tasks(value: unknown): Task[] {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new Error('Invalid download list');
    return value.map((value: unknown) => {
      const task = object(value);
      return {
        gid: text(task.gid, 'GID'), status: text(task.status, 'task status'), name: text(task.name, 'task name'),
        totalLength: number(task.totalLength, 'total length'), completedLength: number(task.completedLength, 'completed length'),
        downloadSpeed: number(task.downloadSpeed, 'download speed'), uploadSpeed: number(task.uploadSpeed, 'upload speed'),
        progress: number(task.progress, 'progress'), connections: number(task.connections, 'connections'),
        errorMessage: optionalText(task.errorMessage, 'task error'),
      };
    });
  }
  return { active: tasks(data.active), waiting: tasks(data.waiting), stopped: tasks(data.stopped) };
}
export function readStatus(value: unknown): Status {
  const data = object(value);
  let version: Status['version'];
  if (typeof data.version === 'string' || data.version == null) version = data.version;
  else {
    const info = object(data.version);
    version = { version: optionalText(info.version, 'aria2 version'), status: optionalText(info.status, 'version status') };
  }
  const stats = data.globalStat == null ? {} : object(data.globalStat);
  function count(value: unknown): string | number | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid global count');
    return value;
  }
  return { version, globalStat: { numWaiting: count(stats.numWaiting), numStoppedTotal: count(stats.numStoppedTotal) } };
}
export function readShell(value: unknown): ShellResponse {
  const data = object(value);
  if (data.shell == null) return { shell: null };
  const payload = object(data.shell);
  const raw = object(payload.record);
  const record: ShellRecord = {
    id: text(raw.id, 'shell id'), label: optionalText(raw.label, 'shell label'), cwd: optionalText(raw.cwd, 'shell cwd'),
    pid: optionalNumber(raw.pid, 'shell PID'), exit_code: optionalNumber(raw.exit_code, 'shell exit'),
    created_at: optionalNumber(raw.created_at, 'created at'), updated_at: optionalNumber(raw.updated_at, 'updated at'),
  };
  if (raw.stats != null) {
    const stats = object(raw.stats);
    if (stats.alive != null && typeof stats.alive !== 'boolean') throw new Error('Invalid shell liveness');
    record.stats = { alive: stats.alive === true, cpu_percent: optionalNumber(stats.cpu_percent, 'CPU'),
      memory_rss: optionalNumber(stats.memory_rss, 'memory'), uptime: optionalNumber(stats.uptime, 'uptime') };
  }
  if (raw.logs != null) {
    const logs = object(raw.logs);
    record.logs = { stdout_tail: strings(logs.stdout_tail), stderr_tail: strings(logs.stderr_tail) };
  }
  let config: ShellConfig | null = null;
  if (payload.config != null) {
    const raw = object(payload.config);
    config = { label: optionalText(raw.label, 'config label'), cwd: optionalText(raw.cwd, 'config cwd'),
      created_at: optionalNumber(raw.created_at, 'config timestamp') };
  }
  return { shell: { record, config } };
}
export function readPicker(value: unknown): { path: string } | null {
  if (value == null) return null;
  return { path: text(object(value).path, 'picker path') };
}
export function readSaved(value: unknown): { sortKey: string; sortDir: string; lastDirectory: string } {
  let saved: Record<string, unknown> = {};
  try { saved = object(value); } catch { /* malformed saved state is not authority */ }
  return {
    sortKey: typeof saved.sortKey === 'string' ? saved.sortKey : 'status',
    sortDir: typeof saved.sortDir === 'string' ? saved.sortDir : 'desc',
    lastDirectory: typeof saved.lastDirectory === 'string' ? saved.lastDirectory : '~',
  };
}
export function readDirectoryResponse(value: unknown): { type: string; name: string; path: string }[] {
  const body = object(value);
  if (!body.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Browse failed');
  const list = body.data ?? [];
  if (!Array.isArray(list)) throw new Error('Invalid directory list');
  return list.map((value: unknown) => {
    const item = object(value);
    return { type: text(item.type, 'entry type'), name: text(item.name, 'entry name'), path: text(item.path, 'entry path') };
  });
}
export function required<T extends HTMLElement>(root: ParentNode, selector: string, type: { new(): T }): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing Aria element: ${selector}`);
  return element;
}
