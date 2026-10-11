import type { FileEntry } from './viewport';
import type { FileProperties, Permissions, createFileExplorerApi } from './api';

const flags = { owner: { read: 0o400, write: 0o200, exec: 0o100 }, group: { read: 0o040, write: 0o020, exec: 0o010 }, others: { read: 0o004, write: 0o002, exec: 0o001 } };
const groups = ['owner', 'group', 'others'] as const;
const bits = ['read', 'write', 'exec'] as const;
export function permissionsToMode(permissions: Permissions): number {
  let mode = 0;
  for (const group of groups) for (const bit of bits) if (permissions[group][bit]) mode |= flags[group][bit];
  return mode;
}
export function modeToPermissions(mode: number | string | undefined): Permissions {
  const parsed = typeof mode === 'number' ? mode : Number.parseInt(String(mode), 8);
  const value = Number.isFinite(parsed) ? parsed : 0;
  const group = (name: typeof groups[number]) => ({ read: Boolean(value & flags[name].read), write: Boolean(value & flags[name].write), exec: Boolean(value & flags[name].exec) });
  return { owner: group('owner'), group: group('group'), others: group('others') };
}
type Files = Pick<ReturnType<typeof createFileExplorerApi>, 'properties' | 'rename' | 'chmod' | 'chown'>;
export interface PropertiesOptions {
  container: HTMLElement;
  files: Files;
  selectedEntry(): FileEntry | null;
  currentDirectory(): string;
  refreshDirectory(path: string): Promise<void>;
  notify(message: string): void;
  parentPath(path: string): string;
  joinPath(directory: string, name: string): string;
  getContextKey?(): string;
}
interface Context { entry: FileEntry; metadata: FileProperties; key: string; applying: boolean }
export function createPropertiesController(options: PropertiesOptions) {
  const { container, files, notify } = options;
  const modal = container.querySelector<HTMLElement>('[data-modal="properties"]');
  const pathLabel = container.querySelector<HTMLElement>('[data-role="properties-path"]');
  const name = container.querySelector<HTMLInputElement>('[data-role="properties-name"]');
  const owner = container.querySelector<HTMLInputElement>('[data-role="properties-owner-input"]');
  const group = container.querySelector<HTMLInputElement>('[data-role="properties-group-input"]');
  const ownerCurrent = container.querySelector<HTMLElement>('[data-role="properties-owner-current"]');
  const groupCurrent = container.querySelector<HTMLElement>('[data-role="properties-group-current"]');
  const recursive = container.querySelector<HTMLInputElement>('[data-role="properties-recurse"]');
  const applyButton = container.querySelector<HTMLButtonElement>('[data-action="properties-apply"]');
  const applyLabel = applyButton?.textContent ?? 'Apply';
  const inputs = (section: typeof groups[number], bit: typeof bits[number]) => container.querySelector<HTMLInputElement>(`[data-role="perm-${section}-${bit}"]`);
  const key = () => options.getContextKey?.() ?? options.currentDirectory();
  let context: Context | null = null, generation = 0, disposed = false;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<() => void> = [];
  const active = (captured: Context): boolean => !disposed && context === captured && captured.key === key();
  function setOpen(open: boolean): void {
    if (!modal) return;
    if (open) modal.dataset.open = 'true'; else delete modal.dataset.open;
    modal.setAttribute('aria-hidden', String(!open));
  }
  function resetButton(): void { if (applyButton) { applyButton.disabled = false; applyButton.textContent = applyLabel; } }
  function close(): void {
    generation++; context = null; clearTimeout(focusTimer); focusTimer = undefined;
    setOpen(false); resetButton();
    if (recursive) { recursive.checked = false; recursive.disabled = false; }
    if (owner) owner.value = ''; if (group) group.value = '';
    if (ownerCurrent) ownerCurrent.textContent = '—'; if (groupCurrent) groupCurrent.textContent = '—';
  }
  async function show(entry: FileEntry): Promise<void> {
    if (disposed) return;
    close();
    const request = generation, origin = key(), capturedEntry = { ...entry };
    try {
      const metadata = await files.properties(capturedEntry.path);
      if (disposed || request !== generation || key() !== origin || !modal) return;
      const permissions = { owner: { ...metadata.permissions.owner }, group: { ...metadata.permissions.group }, others: { ...metadata.permissions.others } };
      const captured: Context = { entry: capturedEntry, metadata: { ...metadata, permissions }, key: origin, applying: false };
      context = captured;
      if (pathLabel) { pathLabel.textContent = metadata.path; pathLabel.title = `Permissions: ${metadata.mode_octal}`; }
      if (name) { name.value = metadata.name; name.select(); }
      if (owner) owner.value = String(metadata.owner); if (group) group.value = String(metadata.group);
      if (ownerCurrent) ownerCurrent.textContent = String(metadata.owner) || '—'; if (groupCurrent) groupCurrent.textContent = String(metadata.group) || '—';
      if (recursive) { recursive.checked = false; recursive.disabled = !metadata.is_directory || metadata.is_symlink; }
      for (const section of groups) for (const bit of bits) { const input = inputs(section, bit); if (input) input.checked = permissions[section][bit]; }
      resetButton(); setOpen(true);
      focusTimer = setTimeout(() => { focusTimer = undefined; if (active(captured)) name?.focus({ preventScroll: true }); }, 40);
    } catch (error) { if (!disposed && request === generation && key() === origin) notify(error instanceof Error ? error.message : 'Failed to fetch properties'); }
  }
  async function openSelected(): Promise<void> {
    const entry = options.selectedEntry();
    if (!entry) { notify('Select an item to view properties'); return; }
    await show(entry);
  }
  async function apply(): Promise<void> {
    const captured = context;
    if (!captured || !active(captured) || captured.applying) return;
    captured.applying = true;
    if (applyButton) { applyButton.disabled = true; applyButton.textContent = 'Applying…'; }
    const metadata = captured.metadata;
    const originalPath = metadata.path, originalName = metadata.name;
    const nextName = name?.value.trim() || originalName;
    const permissions = modeToPermissions(0);
    for (const section of groups) for (const bit of bits) permissions[section][bit] = inputs(section, bit)?.checked ?? false;
    const mode = permissionsToMode(permissions);
    const recurse = Boolean(recursive?.checked && metadata.is_directory && !metadata.is_symlink);
    const nextOwner = owner?.value.trim() ?? '', nextGroup = group?.value.trim() ?? '';
    const ownerChanged = Boolean(nextOwner && nextOwner !== String(metadata.owner));
    const groupChanged = Boolean(nextGroup && nextGroup !== String(metadata.group));
    let target = originalPath, changed = false;
    try {
      if (nextName !== originalName) {
        await files.rename(target, nextName);
        target = options.joinPath(options.parentPath(originalPath), nextName);
        if (!active(captured)) return;
        captured.entry.name = metadata.name = nextName; captured.entry.path = metadata.path = target;
        if (pathLabel) pathLabel.textContent = target;
        changed = true; notify(`Renamed to "${nextName}"`);
      }
      if (mode !== metadata.mode_int) {
        const octal = mode.toString(8).padStart(3, '0');
        await files.chmod(target, octal, recurse);
        if (!active(captured)) return;
        metadata.mode_int = mode; metadata.mode_octal = octal; metadata.permissions = permissions;
        if (pathLabel) pathLabel.title = `Permissions: ${octal}`;
        changed = true; notify(`Permissions updated to ${octal}${recurse ? ' (recursive)' : ''}`);
      }
      if (ownerChanged || groupChanged) {
        await files.chown(target, ownerChanged ? nextOwner : '', groupChanged ? nextGroup : '');
        if (!active(captured)) return;
        if (ownerChanged) { metadata.owner = nextOwner; if (owner) owner.value = nextOwner; if (ownerCurrent) ownerCurrent.textContent = nextOwner; }
        if (groupChanged) { metadata.group = nextGroup; if (group) group.value = nextGroup; if (groupCurrent) groupCurrent.textContent = nextGroup; }
        changed = true; notify('Ownership updated');
      }
      if (!changed) { notify('No changes to apply'); return; }
      await options.refreshDirectory(options.currentDirectory());
      if (active(captured)) close();
    } catch (error) { if (active(captured)) notify(error instanceof Error ? error.message : 'Failed to apply properties'); }
    finally { captured.applying = false; if (active(captured)) resetButton(); }
  }
  const bind = (element: HTMLElement | null, action: () => void): void => { if (!element) return; element.addEventListener('click', action); listeners.push(() => element.removeEventListener('click', action)); };
  for (const selector of ['[data-role="properties-overlay"]', '[data-action="properties-close"]', '[data-action="properties-cancel"]']) bind(container.querySelector<HTMLElement>(selector), close);
  bind(applyButton, () => { void apply(); });
  close();
  return { show, openSelected, close, apply, dispose(): void { close(); disposed = true; for (const remove of listeners) remove(); } };
}
