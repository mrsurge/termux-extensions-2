import type { FileEntry } from './viewport';
export interface ActionContext {
  directory: string; tabId: string | null;
  contextKey?: string;
  entries?: readonly FileEntry[];
  selected: FileEntry | null; selectedPaths: ReadonlySet<string>;
}
export type ContextReader = () => ActionContext;
export function captureActionContext(read: ContextReader): ActionContext {
  const current = read();
  return { directory: current.directory, tabId: current.tabId, contextKey: current.contextKey, entries: current.entries?.map(entry => ({ ...entry })), selected: current.selected ? { ...current.selected } : null, selectedPaths: new Set(current.selectedPaths) };
}
export function isCurrentOrigin(read: ContextReader, origin: ActionContext): boolean {
  const current = read(); return current.directory === origin.directory && current.tabId === origin.tabId && current.contextKey === origin.contextKey;
}
export function requireCurrentOrigin(read: ContextReader, origin: ActionContext): void {
  if (!isCurrentOrigin(read, origin)) throw new Error('File Explorer tab or directory changed; action cancelled');
}
export interface ActionDialog {
  prompt(message: string, defaultValue?: string): Promise<string | null | undefined>;
  confirm(message: string): Promise<boolean>;
}
export interface PickerOptions { title: string; startPath: string; filename?: string; selectLabel?: string }
export interface PickerChoice { path: string }
export interface FilePicker {
  saveFile?(options: PickerOptions): Promise<PickerChoice | null | undefined>;
  openDirectory?(options: PickerOptions): Promise<PickerChoice | null | undefined>;
}
export interface JobRecord {
  id: string; status?: string; message?: string; error?: string;
  [key: string]: unknown;
}
export type JobMessage = string | ((job: JobRecord) => string);
export interface JobMetadata {
  type?: string; title?: string; destination?: string;
  archivePath?: string; archiveName?: string; itemCount?: number;
  runningMessage?: JobMessage; successMessage?: JobMessage; failureMessage?: JobMessage; cancelMessage?: JobMessage;
  successToast?: JobMessage; failureToast?: JobMessage; cancelToast?: JobMessage;
  refreshOnSuccess?: string[];
}
export interface JobServices {
  available(): boolean;
  create(type: 'bulk_copy' | 'bulk_move' | 'extract_archive', params: object): Promise<unknown>;
  track(job: JobRecord, metadata: JobMetadata): void;
}
export function jobRecordDto(value: unknown): JobRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid job response');
  const fields = value as Record<string, unknown>;
  if (typeof fields.id !== 'string' || !fields.id) throw new Error('Invalid job identity');
  const job: JobRecord = { ...fields, id: fields.id };
  for (const key of ['status', 'message', 'error'] as const) {
    if (fields[key] != null) {
      if (typeof fields[key] !== 'string') throw new Error(`Invalid job ${key}`);
      job[key] = fields[key];
    } else delete job[key];
  }
  return job;
}
export function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function actionCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'cancelled';
}
