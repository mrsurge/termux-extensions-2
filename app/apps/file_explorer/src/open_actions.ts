import { objectDto, type createFileExplorerApi } from './api';
import type { FileEntry } from './viewport';

interface OpenIntents {
  openFile(path: string): Promise<unknown>;
  openProject(path: string): Promise<unknown>;
  openTerminal(path: string): Promise<unknown>;
}
export interface OpenActionDependencies {
  files: Pick<ReturnType<typeof createFileExplorerApi>, 'resolveSymlink' | 'properties'>;
  snapshot(): { selected: FileEntry | null; path: string; showHidden: boolean };
  contextKey(): string;
  intentsReady: Promise<OpenIntents>;
  loadDirectory(path: string): Promise<void>;
  notify(message: string): void;
  closeMenus(): void;
  isArchive(name: string): boolean;
  isEditableFile(name: string): boolean;
  maxEditorSize: number;
  picker(): { openDirectory(options: { title: string; startPath: string; selectLabel: string }): Promise<{ path: string } | null | undefined> } | null;
  hasJobSupport(): boolean;
  submitExtraction(entry: FileEntry, destination: string): Promise<void>;
  fetch: typeof fetch;
  navigate(url: string): void;
}

/** Captured file targets survive selection changes; async reads cannot retarget a new tab. */
export function createOpenActions(deps: OpenActionDependencies) {
  let disposed = false;
  const current = (origin: string): boolean => !disposed && deps.contextKey() === origin;
  const message = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;
  const selected = (): FileEntry | null => {
    const entry = deps.snapshot().selected;
    return entry ? { ...entry } : null;
  };

  async function editor(path: string, origin: string): Promise<void> {
    try {
      const intents = await deps.intentsReady;
      if (current(origin)) await intents.openFile(path);
    } catch (error) { if (current(origin)) deps.notify(message(error, 'Failed to open file')); }
  }
  async function openInEditor(path: string): Promise<void> { await editor(path, deps.contextKey()); }

  async function follow(entry: Pick<FileEntry, 'path'> & Partial<FileEntry>, origin: string, seen: Set<string>): Promise<void> {
    if (!current(origin)) return;
    if (seen.has(entry.path)) { deps.notify('Symlink chain contains a cycle'); return; }
    seen.add(entry.path);
    try {
      const response = await deps.files.resolveSymlink(entry.path);
      if (!current(origin)) return;
      if (!response.is_symlink) {
        if (entry.type === 'directory') await deps.loadDirectory(entry.path);
        else await editor(entry.path, origin);
      } else if (!response.target_exists) deps.notify('Symlink target does not exist');
      else if (response.target_type === 'directory') await deps.loadDirectory(response.target);
      else if (response.target_type === 'file') {
        if (deps.isArchive(response.target)) await archive(response.target, {}, origin);
        else await editor(response.target, origin);
      } else if (response.target_type === 'symlink') {
        deps.notify('Target is another symlink. Following...');
        await follow({ path: response.target }, origin, seen);
      }
    } catch (error) { if (current(origin)) deps.notify(message(error, 'Failed to resolve symlink')); }
  }
  async function followSymlink(entry: Pick<FileEntry, 'path'> & Partial<FileEntry>): Promise<void> {
    await follow({ ...entry }, deps.contextKey(), new Set());
  }
  async function openSelected(): Promise<void> {
    const entry = selected(); if (!entry || disposed) return;
    const origin = deps.contextKey();
    if (entry.type === 'symlink') await follow(entry, origin, new Set());
    else if (entry.type === 'directory') await deps.loadDirectory(entry.path);
    else if (deps.isArchive(entry.name)) await archive(entry.path, {}, origin);
    else if (!deps.isEditableFile(entry.name)) deps.notify('This file type cannot be opened in the text editor');
    else await editor(entry.path, origin);
  }
  async function openSelectedAsProject(): Promise<void> {
    const entry = selected(); if (!entry || entry.type !== 'directory' || disposed) return;
    const origin = deps.contextKey();
    try { const intents = await deps.intentsReady; if (current(origin)) await intents.openProject(entry.path); }
    catch (error) { if (current(origin)) deps.notify(message(error, 'Unable to open project')); }
  }
  async function openSelectedInTerminal(): Promise<void> {
    const entry = selected(); if (disposed) return;
    if (!entry || entry.type !== 'directory') { deps.notify('Select a directory to open in Terminal'); return; }
    const origin = deps.contextKey();
    try { const intents = await deps.intentsReady; if (current(origin)) await intents.openTerminal(entry.path); }
    catch (error) { if (current(origin)) deps.notify(message(error, 'Failed to open Terminal')); }
  }
  async function openSelectedInEditor(): Promise<void> {
    const entry = selected(); if (!entry || disposed) return;
    const origin = deps.contextKey();
    if (entry.type === 'directory') { deps.notify('Select a file to open in the editor'); return; }
    let path = entry.path, name = entry.name;
    try {
      if (entry.type === 'symlink') {
        const info = await deps.files.resolveSymlink(entry.path);
        if (!current(origin)) return;
        if (info.is_symlink) {
          if (!info.target_exists) { deps.notify('Symlink target does not exist'); return; }
          if (info.target_type === 'directory') { deps.notify('Symlink points to a directory'); return; }
          if (info.target_type === 'symlink') { deps.notify('Symlink chain not supported for editor'); return; }
        }
        path = info.target; name = path.split('/').pop() || path;
      }
      if (deps.isArchive(name)) { deps.notify('Open archives with the Archive Manager'); return; }
      let size = Number(entry.size);
      if (entry.type === 'symlink' || !Number.isFinite(size) || size <= 0) {
        const meta = await deps.files.properties(path);
        if (!current(origin)) return;
        size = meta.size;
      }
      if (size > deps.maxEditorSize) { deps.notify('File is too large to open in the editor'); return; }
      await editor(path, origin);
    } catch (error) { if (current(origin)) deps.notify(message(error, 'Failed to open file')); }
  }

  async function responseBody(response: Response, fallback: string): Promise<Record<string, unknown>> {
    const value: unknown = await response.json().catch(() => ({}));
    const body = objectDto(value, 'archive response');
    if (!response.ok || body.ok === false) throw new Error(typeof body.error === 'string' ? body.error : `${fallback} (HTTP ${response.status})`);
    return body;
  }
  async function extractArchive(entry: FileEntry): Promise<void> {
    if (disposed) return;
    const captured = { ...entry }, origin = deps.contextKey(), snapshot = deps.snapshot();
    const picker = deps.picker();
    if (!picker) { deps.notify('File picker unavailable'); return; }
    try {
      const destination = await picker.openDirectory({ title: 'Extract Archive To…', startPath: snapshot.path, selectLabel: 'Extract Here' });
      if (!destination?.path || !current(origin)) return;
      if (deps.hasJobSupport()) {
        // Failure after submission is uncertain: never fall back to a second extraction.
        await deps.submitExtraction(captured, destination.path);
        if (current(origin)) deps.notify('Extraction started.');
      } else {
        deps.notify('Extracting archive…');
        const response = await deps.fetch('/api/app/archive_manager/archives/expand', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archive_path: captured.path, destination: destination.path, options: { overwrite: 'rename', password: null } }),
        });
        await responseBody(response, 'Extraction failed');
        if (!current(origin)) return;
        deps.notify(`Archive extracted to ${destination.path}`);
        if (destination.path === snapshot.path) await deps.loadDirectory(snapshot.path);
      }
    } catch (error) {
      if (current(origin) && message(error, '') !== 'cancelled') deps.notify(message(error, 'Extraction failed'));
    }
  }
  async function extractSelectedArchive(): Promise<void> {
    const entry = selected(); if (!entry || disposed) return;
    if (entry.type !== 'file' || !deps.isArchive(entry.name)) { deps.notify('Select an archive to extract'); return; }
    await extractArchive(entry);
  }
  async function archive(path: string, options: { internal?: string; destination?: string }, origin: string): Promise<void> {
    if (!current(origin)) return;
    if (!path) { deps.notify('Archive path missing'); return; }
    const snapshot = deps.snapshot();
    try {
      deps.closeMenus();
      const response = await deps.fetch('/api/app/archive_manager/archives/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive_path: path, filesystem_path: snapshot.path, show_hidden: snapshot.showHidden, ...options }),
      });
      const body = await responseBody(response, 'Failed to open archive');
      if (!current(origin)) return;
      const data = objectDto(body.data ?? {}, 'archive launch data');
      if (typeof data.app_url !== 'string' || !data.app_url) throw new Error('Archive Manager did not provide a launch URL');
      deps.navigate(data.app_url);
    } catch (error) { if (current(origin)) deps.notify(message(error, 'Unable to open archive')); }
  }
  async function launchArchiveManager(entry: string | Pick<FileEntry, 'path'>, options: { internal?: string; destination?: string } = {}): Promise<void> {
    await archive(typeof entry === 'string' ? entry : entry.path, options, deps.contextKey());
  }
  return { followSymlink, openSelected, openInEditor, openSelectedAsProject, openSelectedInTerminal, openSelectedInEditor,
    extractArchive, extractSelectedArchive, launchArchiveManager, dispose() { disposed = true; } };
}
