import type { FileEntry } from './viewport';

/** The framework host has already checked and unwrapped the HTTP envelope. */
export interface HostAppApi {
  get(endpoint: string): Promise<unknown>;
  post(endpoint: string, body: object): Promise<unknown>;
}
export interface DirectoryListing { path: string; entries: FileEntry[] }
export interface PermissionBits { read: boolean; write: boolean; exec: boolean }
export interface Permissions { owner: PermissionBits; group: PermissionBits; others: PermissionBits }
export interface FileProperties {
  path: string; name: string; type: string; is_directory: boolean; is_symlink: boolean;
  size: number; mtime: number; mode_octal: string; mode_int: number;
  permissions: Permissions; owner: string | number; group: string | number;
}
export type SymlinkResolution =
  | { path: string; target: string; is_symlink: false }
  | { path: string; target: string; is_symlink: true; target_exists: boolean; target_type: string };

export function objectDto(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected text`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}: expected a finite number`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}: expected a boolean`);
  return value;
}
function identity(value: unknown, label: string): string | number {
  return typeof value === 'string' ? value : number(value, label);
}
export function fileEntryDto(value: unknown): FileEntry {
  const raw = objectDto(value, 'file entry');
  const entry: FileEntry = { path: text(raw.path, 'entry path'), name: text(raw.name, 'entry name'), type: text(raw.type, 'entry type') };
  if (raw.size != null) entry.size = number(raw.size, 'entry size');
  if (raw.mtime != null) entry.mtime = number(raw.mtime, 'entry mtime');
  if (raw.mode != null) entry.mode = typeof raw.mode === 'string' ? raw.mode : number(raw.mode, 'entry mode');
  if (raw.owner != null) entry.owner = identity(raw.owner, 'entry owner');
  if (raw.group != null) entry.group = identity(raw.group, 'entry group');
  return entry;
}
export function directoryListingDto(value: unknown, requestedPath: string): DirectoryListing {
  const raw = Array.isArray(value) ? { path: requestedPath, entries: value } : objectDto(value, 'directory listing');
  if (!Array.isArray(raw.entries)) throw new Error('Invalid directory listing: expected entries');
  return { path: text(raw.path, 'directory path'), entries: raw.entries.map(fileEntryDto) };
}
export function symlinkResolutionDto(value: unknown): SymlinkResolution {
  const raw = objectDto(value, 'symlink resolution');
  const path = text(raw.path, 'symlink path'), target = text(raw.target, 'symlink target');
  if (!boolean(raw.is_symlink, 'is_symlink')) return { path, target, is_symlink: false };
  return { path, target, is_symlink: true, target_exists: boolean(raw.target_exists, 'target_exists'), target_type: text(raw.target_type, 'target_type') };
}
function permissionDto(value: unknown): PermissionBits {
  const raw = objectDto(value, 'permission bits');
  return { read: boolean(raw.read, 'permission read'), write: boolean(raw.write, 'permission write'), exec: boolean(raw.exec, 'permission exec') };
}
export function filePropertiesDto(value: unknown): FileProperties {
  const raw = objectDto(value, 'file properties'), permissions = objectDto(raw.permissions, 'permissions');
  return {
    path: text(raw.path, 'properties path'), name: text(raw.name, 'properties name'), type: text(raw.type, 'properties type'),
    is_directory: boolean(raw.is_directory, 'is_directory'), is_symlink: boolean(raw.is_symlink, 'is_symlink'),
    size: number(raw.size, 'properties size'), mtime: number(raw.mtime, 'properties mtime'),
    mode_octal: text(raw.mode_octal, 'mode_octal'), mode_int: number(raw.mode_int, 'mode_int'),
    owner: identity(raw.owner, 'properties owner'), group: identity(raw.group, 'properties group'),
    permissions: { owner: permissionDto(permissions.owner), group: permissionDto(permissions.group), others: permissionDto(permissions.others) },
  };
}

/** Named operations make decoding explicit. Mutations are sent once, never retried. */
export function createFileExplorerApi(api: HostAppApi) {
  const pathQuery = (route: string, path: string): string => `${route}?path=${encodeURIComponent(path)}`;
  return {
    async list(path: string, hidden: boolean): Promise<DirectoryListing> {
      return directoryListingDto(await api.get(`${pathQuery('list', path)}&hidden=${hidden ? '1' : '0'}`), path);
    },
    async resolveSymlink(path: string): Promise<SymlinkResolution> { return symlinkResolutionDto(await api.get(pathQuery('resolve_symlink', path))); },
    async properties(path: string): Promise<FileProperties> { return filePropertiesDto(await api.get(pathQuery('properties', path))); },
    async mkdir(path: string, name: string) { const raw = objectDto(await api.post('mkdir', { path, name }), 'mkdir result'); return { created: text(raw.created, 'created') }; },
    async delete(path: string) { const raw = objectDto(await api.post('delete', { path }), 'delete result'); return { deleted: text(raw.deleted, 'deleted') }; },
    async rename(path: string, name: string) { const raw = objectDto(await api.post('rename', { path, name }), 'rename result'); return { renamed: text(raw.renamed, 'renamed'), to: text(raw.to, 'rename destination') }; },
    async copy(source: string, dest: string) { const raw = objectDto(await api.post('copy', { source, dest }), 'copy result'); return { copied: text(raw.copied, 'copied'), to: text(raw.to, 'copy destination') }; },
    async move(source: string, dest: string) { const raw = objectDto(await api.post('move', { source, dest }), 'move result'); return { moved: text(raw.moved, 'moved'), to: text(raw.to, 'move destination') }; },
    async chmod(path: string, mode: string, recursive: boolean) {
      const raw = objectDto(await api.post('chmod', { path, mode, recursive }), 'chmod result');
      return { path: text(raw.path, 'chmod path'), mode: text(raw.mode, 'chmod mode'), recursive: boolean(raw.recursive, 'chmod recursive') };
    },
    async chown(path: string, user: string, group: string) {
      const raw = objectDto(await api.post('chown', { path, user, group }), 'chown result');
      return { path: text(raw.path, 'chown path'), owner: text(raw.owner, 'chown owner'), group: text(raw.group, 'chown group') };
    },
    async sidebarState(body: object) {
      const raw = objectDto(await api.post('sidebar/window/state', body), 'sidebar state result');
      return { sidebar: objectDto(raw.sidebar, 'sidebar state') };
    },
  };
}
