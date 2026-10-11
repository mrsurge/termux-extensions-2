import type { createFileExplorerApi } from './api';
import { actionCancelled, actionError, captureActionContext, isCurrentOrigin, jobRecordDto, requireCurrentOrigin, type ActionContext, type ActionDialog, type ContextReader, type FilePicker, type JobMetadata, type JobServices } from './action_types';
export type FileMutationApi = Pick<ReturnType<typeof createFileExplorerApi>, 'mkdir' | 'rename' | 'delete' | 'copy' | 'move'>;
export interface FileActionsDependencies {
  files: FileMutationApi;
  getContext: ContextReader;
  dialog: ActionDialog;
  picker?: FilePicker;
  getPicker?(): FilePicker | undefined;
  jobs?: JobServices;
  toast(message: string): void;
  navigate(url: string): void;
  download(url: string, filename: string): void;
  clearSelection(): void;
  loadDirectory(path: string): Promise<void> | void;
  parentPath(path: string): string;
  onError?(label: string, details: unknown): void;
}

/** User action snapshots are immutable targets, never aliases of later selection. */
export function createFileActions(deps: FileActionsDependencies) {
  let disposed = false;
  const picker = () => deps.getPicker?.() ?? deps.picker;
  const context = () => captureActionContext(deps.getContext);
  const guard = (origin: ActionContext) => { if (disposed) throw new Error('File Explorer action controller is closed'); requireCurrentOrigin(deps.getContext, origin); };
  const current = (origin: ActionContext) => !disposed && isCurrentOrigin(deps.getContext, origin);
  async function finish(origin: ActionContext, refresh: boolean, clear = true): Promise<void> {
    if (!current(origin)) return;
    if (clear) deps.clearSelection();
    if (refresh) await deps.loadDirectory(origin.directory);
  }
  function report(error: unknown, fallback: string): void { if (!disposed && !actionCancelled(error)) deps.toast(actionError(error, fallback)); }
  async function createFolder(): Promise<void> {
    if (disposed) return;
    const origin = context();
    try {
      const name = (await deps.dialog.prompt('New folder name:') ?? '').trim();
      if (!name) return;
      if (/[\\/]/.test(name) || name === '.' || name === '..') { deps.toast('Invalid folder name'); return; }
      guard(origin); await deps.files.mkdir(origin.directory, name);
      if (!disposed) deps.toast(`Created folder "${name}"`); await finish(origin, true, false);
    } catch (error) { report(error, 'Failed to create folder'); }
  }
  async function createNewFile(): Promise<void> {
    if (disposed) return;
    const origin = context();
    try {
      let path: string;
      const activePicker = picker();
      if (activePicker?.saveFile) {
        const choice = await activePicker.saveFile({ title: 'Create New File', startPath: origin.directory, filename: 'untitled.txt', selectLabel: 'Create' });
        if (!choice?.path) return; path = choice.path;
      } else {
        const name = (await deps.dialog.prompt('New file name:') ?? '').trim();
        if (!name) return;
        if (/[\\/]/.test(name)) { deps.toast('Invalid file name'); return; }
        path = `${origin.directory.replace(/\/$/, '')}/${name}`;
      }
      guard(origin); deps.navigate(`/app/file_editor?file=${encodeURIComponent(path)}`);
    } catch (error) { report(error, 'Failed to create file'); }
  }
  async function renameSelected(): Promise<void> {
    if (disposed) return;
    const origin = context(), entry = origin.selected;
    if (!entry) return;
    try {
      const name = (await deps.dialog.prompt('Rename to:', entry.name) ?? '').trim();
      if (!name || name === entry.name) return;
      guard(origin); await deps.files.rename(entry.path, name);
      if (!disposed) deps.toast(`Renamed to "${name}"`); await finish(origin, true, false);
    } catch (error) { report(error, 'Failed to rename'); }
  }
  async function deleteSelected(): Promise<void> {
    if (disposed) return;
    const origin = context(), paths = [...origin.selectedPaths];
    if (!paths.length && origin.selected) paths.push(origin.selected.path);
    if (!paths.length) return;
    try {
      const batch = origin.selectedPaths.size > 0;
      const warning = batch ? `Delete ${paths.length} selected item${paths.length > 1 ? 's' : ''}? This cannot be undone.` : `Delete "${origin.selected?.name ?? paths[0]}"? This cannot be undone.`;
      if (!await deps.dialog.confirm(warning)) return; guard(origin);
      let succeeded = 0; const errors: string[] = [];
      for (const path of paths) {
        guard(origin);
        try { await deps.files.delete(path); succeeded++; } catch (error) { if (!batch) throw error; errors.push(`${path}: ${actionError(error, 'Failed')}`); }
      }
      if (disposed) return;
      if (!batch && origin.selected && !errors.length) deps.toast(`Deleted "${origin.selected.name}"`);
      else summarize('delete', succeeded, errors);
      await finish(origin, true);
    } catch (error) { report(error, 'Failed to delete'); }
  }
  function summarize(kind: 'copy' | 'move' | 'delete', succeeded: number, errors: string[], destination?: string): void {
    const completed = { copy: 'copied', move: 'moved', delete: 'deleted' }[kind];
    if (!errors.length) deps.toast(`Successfully ${completed} ${succeeded} item${succeeded > 1 ? 's' : ''}${destination ? ` to ${destination}` : ''}`);
    else if (succeeded) deps.toast(`${completed[0]?.toUpperCase()}${completed.slice(1)} ${succeeded} item${succeeded > 1 ? 's' : ''}, ${errors.length} failed`);
    else deps.toast(`Failed to ${kind} ${errors.length} item${errors.length > 1 ? 's' : ''}`);
    if (errors.length) deps.onError?.(`${kind[0]?.toUpperCase()}${kind.slice(1)} errors:`, errors);
  }
  function jobMetadata(kind: 'copy' | 'move', title: string, destination: string, refresh: string[]): JobMetadata {
    const label = kind === 'copy' ? 'Copy' : 'Move', running = kind === 'copy' ? 'Copying' : 'Moving', complete = kind === 'copy' ? 'Copied' : 'Moved';
    return { type: `bulk-${kind}`, title, destination,
      runningMessage: `${running} → ${destination}`, successMessage: job => job.message || `${complete} to ${destination}`,
      failureMessage: job => job.error || `${label} failed.`, cancelMessage: `${label} cancelled.`,
      successToast: job => job.message || `${complete} to ${destination}`, failureToast: job => job.error || `${label} failed.`,
      cancelToast: `${label} cancelled.`, refreshOnSuccess: refresh.filter(Boolean) };
  }
  async function submitJob(kind: 'copy' | 'move', params: object, metadata: JobMetadata, origin: ActionContext): Promise<void> {
    const jobs = deps.jobs; if (!jobs) throw new Error('Job service unavailable');
    guard(origin);
    // Once attempted, a missing/invalid ACK is uncertain. Do not resend through direct CRUD.
    const job = jobRecordDto(await jobs.create(kind === 'copy' ? 'bulk_copy' : 'bulk_move', params));
    if (disposed) return;
    jobs.track(job, metadata); deps.toast(kind === 'copy' ? 'Copy started.' : 'Move started.'); await finish(origin, false);
  }
  async function transferSelected(kind: 'copy' | 'move'): Promise<void> {
    if (disposed) return;
    const origin = context(), batch = origin.selectedPaths.size > 0, selected = origin.selected;
    const sources = batch ? [...origin.selectedPaths] : selected ? [selected.path] : [];
    if (!sources.length) return;
    const label = kind === 'copy' ? 'Copy' : 'Move';
    try {
      let destination: string, destinationParent: string, singleCopy = !batch && kind === 'copy';
      const activePicker = picker();
      if (singleCopy) {
        if (!activePicker?.saveFile) { deps.toast('File picker unavailable'); return; }
        const choice = await activePicker.saveFile({ title: 'Copy As...', startPath: origin.directory, filename: selected?.name, selectLabel: 'Copy' });
        if (!choice?.path) return; destination = choice.path; destinationParent = deps.parentPath(destination);
      } else {
        if (!activePicker?.openDirectory) { deps.toast('File picker unavailable'); return; }
        const choice = await activePicker.openDirectory({ title: batch ? `${label} ${sources.length} item${sources.length > 1 ? 's' : ''} to...` : 'Move to...', startPath: origin.directory });
        if (!choice?.path) return; destination = choice.path; destinationParent = destination;
      }
      guard(origin);
      // Legacy single Move has no job path; all other supported paths retain jobs when available.
      if ((batch || singleCopy) && deps.jobs?.available()) {
        const params = singleCopy ? { sources, destination: destinationParent || null, destinations: { [sources[0] ?? '']: destination } } : { sources, destination };
        const title = batch ? `${label} ${sources.length} item${sources.length > 1 ? 's' : ''}` : `${label} ${selected?.name ?? ''}`;
        const metadata = jobMetadata(kind, title, destination, kind === 'move' ? [origin.directory, destination] : singleCopy ? [destinationParent, origin.directory] : [destination]);
        if (singleCopy) metadata.destination = destinationParent || destination;
        await submitJob(kind, params, metadata, origin);
        return;
      }
      let succeeded = 0; const errors: string[] = [];
      for (const source of sources) {
        guard(origin);
        try {
          if (kind === 'copy') await deps.files.copy(source, singleCopy ? destination : `${destination}/${source.split('/').pop() ?? ''}`);
          else await deps.files.move(source, destination);
          succeeded++;
        } catch (error) { if (!batch) throw error; errors.push(`${source}: ${actionError(error, 'Failed')}`); }
      }
      if (disposed) return;
      if (!batch && selected && !errors.length) deps.toast(`${kind === 'copy' ? 'Copied' : 'Moved'} "${selected.name}" to ${destination}`);
      else summarize(kind, succeeded, errors, destination);
      const refresh = kind === 'move' || destinationParent === origin.directory || (!singleCopy && deps.parentPath(destination) === origin.directory);
      await finish(origin, refresh);
    } catch (error) { report(error, `${label} failed`); }
  }
  function downloadSelected(): void {
    if (disposed) return;
    const origin = context(); let entry = origin.selected;
    if (!entry && origin.selectedPaths.size === 1) entry = origin.entries?.find(candidate => origin.selectedPaths.has(candidate.path)) ?? null;
    if (!entry || entry.type !== 'file') return;
    deps.download(`/api/app/file_explorer/download?path=${encodeURIComponent(entry.path)}`, entry.name);
  }
  return { createFolder, createNewFile, renameSelected, deleteSelected, copySelected: () => transferSelected('copy'), moveSelected: () => transferSelected('move'), downloadSelected, dispose() { disposed = true; } };
}
