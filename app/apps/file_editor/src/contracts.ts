/** Validated host/picker/API edges; no application state lives in the host shim. */
export interface AppApi {
  get(path: string): Promise<unknown>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}
export interface StoredEditorState {
  lastPath: string | null;
  draft: string | null;
  showLineNumbers: boolean;
  showLineShading: boolean;
  showSyntaxHighlight: boolean;
  wordWrap: boolean;
  theme: string;
}
export interface HostBridge {
  toast(message: string): void;
  setTitle(title: string): void;
  loadState(seed: StoredEditorState): unknown;
  clearState(): void;
  onBeforeExit(handler: () => Promise<StoredEditorState | { cancel: true }>): void;
  onBeforeUnload?(handler: () => { cancel: boolean }): void;
}
interface Picker {
  openFile(options: { title: string; startPath: string; selectLabel: string }): Promise<unknown>;
  saveFile(options: { title: string; startPath: string; filename: string; selectLabel: string }): Promise<unknown>;
}
declare global {
  interface Window {
    host: HostBridge;
    api: AppApi;
    teFilePicker?: Picker;
    teUI: { dialog: { confirm(message: string): Promise<boolean>; prompt(message: string): Promise<string | null> } };
  }
}
export function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function unwrapObject(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  if (record.ok === false) throw new Error(typeof record.error === 'string' ? record.error : 'Request failed');
  return 'data' in record ? objectRecord(record.data) : record;
}
export function readDocument(value: unknown): { path: string; content: string } {
  const record = unwrapObject(value);
  if (typeof record.path !== 'string' || typeof record.content !== 'string') throw new Error('Invalid file response');
  return { path: record.path, content: record.content };
}
export function pickerChoice(value: unknown): { path: string; existed: boolean } | null {
  if (value == null) return null;
  const record = objectRecord(value);
  if (typeof record.path !== 'string' || !record.path) throw new Error('Invalid picker response');
  return { path: record.path, existed: record.existed === true };
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return error == null ? '' : String(error);
}
export function normalizeState(value: unknown): StoredEditorState {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    lastPath: typeof record.lastPath === 'string' ? record.lastPath : null,
    draft: typeof record.draft === 'string' ? record.draft : null,
    showLineNumbers: typeof record.showLineNumbers === 'boolean' ? record.showLineNumbers : true,
    showLineShading: typeof record.showLineShading === 'boolean' ? record.showLineShading : false,
    showSyntaxHighlight: typeof record.showSyntaxHighlight === 'boolean' ? record.showSyntaxHighlight : true,
    wordWrap: typeof record.wordWrap === 'boolean' ? record.wordWrap : false,
    theme: typeof record.theme === 'string' ? record.theme : 'cm6-dark',
  };
}
