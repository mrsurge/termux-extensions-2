export type Mode = 'filesystem' | 'archive';
export interface Entry {
  id: string; name: string; type: 'file' | 'directory'; path: string;
  internal?: string; size?: number | null; packed_size?: number | null;
  is_archive?: boolean; isArchive?: boolean; meta?: string;
}
export interface Listing {
  mode: Mode; path?: string; archive_path?: string; internal?: string;
  entries: Entry[];
}
export interface Bookmark { name: string; path: string }
export interface PickerTarget { path: string; existed?: boolean }
export interface Host {
  setTitle?(title: string): void;
  loadState?(): unknown;
  saveState?(state: Record<string, unknown>): void;
  toast?(message: string, duration?: number): void;
  onBeforeExit?(callback: () => void): void;
}
export interface API {
  get(path: string): Promise<unknown>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}
export interface Client {
  browse(params: Record<string, string>): Promise<Listing>;
  createArchive(body: Record<string, unknown>): Promise<unknown>;
  extractArchive(body: Record<string, unknown>): Promise<unknown>;
  testArchive(body: Record<string, unknown>): Promise<unknown>;
}
export interface State {
  mode: Mode; cwd: string; archivePath: string | null; archiveInternal: string;
  entries: Entry[]; entryMap: Map<string, Entry>; pending: boolean;
  selectedIds: Set<string>; showHidden: boolean; lastPickedTarget: string | null;
  homeDir: string | null; lastFilesystemPath: string; bookmarks: Bookmark[];
  host: Host | undefined; client: Client;
  updateActionButtons(): void; clearSelection(): void;
  navigateToFilesystem(path: string): void;
  navigateWithinArchive(internal: string): void;
  navigateToArchiveRoot(path: string): void;
  handleOpen(entry: Entry): void;
  handleCreateArchive(): Promise<void>;
  handleAddToArchive(): Promise<void>;
  handleExitArchive(): void;
  handleExtract(): Promise<void>;
  refresh(): Promise<void>;
}
export interface Job {
  id: string; status: string; message?: string; error?: string;
  progress?: Record<string, unknown>;
}
export interface ExtractionMeta {
  archivePath: string; archiveName: string; destination: string; itemCount: number;
}
export interface JobInfo { meta: ExtractionMeta; lastStatus: string; cleaned: boolean }
export interface NotificationAction { label: string; onClick(): Promise<void> }
export interface UI {
  toast?(message: string, duration?: number): void;
  dismiss?(id: string): void;
  notify?(options: {
    id: string; title: string; message: string;
    variant: 'info' | 'success' | 'error' | 'warning'; status: string;
    progress?: Record<string, unknown>; actions: NotificationAction[];
    onDismiss(): void;
  }): void;
  dialog: {
    prompt(message: string, initial: string): Promise<string | null>;
    confirm(message: string): Promise<boolean>;
  };
}
export interface FilePicker {
  saveFile?(options: { startPath: string; filename: string; title: string }): Promise<unknown>;
  openFile?(options: { startPath: string; title: string }): Promise<unknown>;
  openDirectory?(options: { startPath: string; title: string; selectLabel: string }): Promise<unknown>;
}
declare global {
  interface Window { teUI?: UI; teFilePicker?: FilePicker }
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}
export function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  return value;
}
function optionalText(value: unknown, field: string): string | undefined {
  return value == null ? undefined : text(value, field);
}
function size(value: unknown): number | null | undefined {
  if (value == null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid entry size');
  }
  return value;
}
export function decodeListing(value: unknown): Listing {
  const data = record(value);
  if (data.mode !== 'filesystem' && data.mode !== 'archive') throw new Error('Invalid listing mode');
  if (!Array.isArray(data.entries)) throw new Error('Invalid listing entries');
  const entries = data.entries.map((value: unknown): Entry => {
    const item = record(value);
    if (item.type !== 'directory' && item.type !== 'file') throw new Error('Invalid entry type');
    if (item.is_archive != null && typeof item.is_archive !== 'boolean') throw new Error('Invalid archive flag');
    return {
      id: text(item.id, 'entry id'), name: text(item.name, 'entry name'),
      type: item.type, path: text(item.path, 'entry path'),
      internal: optionalText(item.internal, 'entry internal'),
      size: size(item.size), packed_size: size(item.packed_size),
      is_archive: item.is_archive === true,
    };
  });
  return {
    mode: data.mode, entries, path: optionalText(data.path, 'listing path'),
    archive_path: optionalText(data.archive_path, 'archive path'),
    internal: optionalText(data.internal, 'archive internal'),
  };
}
export function decodeBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) throw new Error('Invalid bookmarks');
  return value.map((value: unknown) => {
    const item = record(value);
    return { name: text(item.name, 'bookmark name'), path: text(item.path, 'bookmark path') };
  });
}
export function decodeJob(value: unknown): Job {
  const item = record(value);
  return {
    id: text(item.id, 'job id'), status: text(item.status, 'job status'),
    message: optionalText(item.message, 'job message'),
    error: optionalText(item.error, 'job error'),
    progress: item.progress == null ? undefined : record(item.progress),
  };
}
export function decodeJobs(value: unknown): Job[] {
  if (!Array.isArray(value)) throw new Error('Invalid jobs');
  return value.map(decodeJob);
}
export function decodePicker(value: unknown): PickerTarget | null {
  if (value == null) return null;
  const item = record(value);
  if (item.existed != null && typeof item.existed !== 'boolean') throw new Error('Invalid picker existence flag');
  return { path: text(item.path, 'picker path'), existed: item.existed === true };
}
export function savedRecord(value: unknown): Record<string, unknown> {
  try { return record(value); } catch { return {}; }
}
export function savedText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
export function savedNullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
export function unwrapResponse(value: unknown, ok: boolean, status: number): unknown {
  const body = record(value);
  if (!ok || body.ok === false) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${status}`);
  }
  return body.data ?? body;
}
export function requiredElement<T extends HTMLElement>(
  root: ParentNode, selector: string, constructor: { new(): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing Archive Manager element: ${selector}`);
  return element;
}
