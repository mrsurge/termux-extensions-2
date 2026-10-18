export interface SettingsHost {
  loadState?: (fallback: object) => unknown;
  saveState?: (state: { frameworkToken: string }) => void;
  toast?: (message: string, duration: number) => void;
}
export type RequestOptions = Omit<RequestInit, 'body'> & { body?: string | Record<string, unknown> };
export interface Shell { id: string; label?: string; status?: string; pid?: number | null; command?: string | string[] }
export interface Extension { name: string; _ext_dir: string }
export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function shellsFrom(value: unknown): Shell[] {
  if (!Array.isArray(value)) throw new Error('Invalid framework shell list');
  return value.map((item: unknown) => {
    const row = record(item);
    if (!row || typeof row.id !== 'string') throw new Error('Invalid framework shell record');
    const shell: Shell = { id: row.id };
    if (typeof row.label === 'string') shell.label = row.label;
    if (typeof row.status === 'string') shell.status = row.status;
    if (row.pid === null || typeof row.pid === 'number') shell.pid = row.pid;
    if (typeof row.command === 'string') shell.command = row.command;
    else if (Array.isArray(row.command) && row.command.every((part: unknown) => typeof part === 'string')) shell.command = row.command as string[];
    return shell;
  });
}
export function extensionsFrom(value: unknown): Extension[] {
  if (!Array.isArray(value)) throw new Error('Invalid extension list');
  return value.map((item: unknown) => {
    const row = record(item);
    if (!row || typeof row.name !== 'string' || typeof row._ext_dir !== 'string') throw new Error('Invalid extension record');
    return { name: row.name, _ext_dir: row._ext_dir };
  });
}
