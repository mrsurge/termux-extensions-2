import type { ExplorerStickyScopesApi } from './chrome/sticky-scopes.ts';

export {};

interface ExplorerHostBridge {
  toast?: (message: string, ms?: number) => void;
}

interface ExplorerTeFilePickerPathChoice {
  path: string;
}

interface ExplorerTeFilePickerSaveChoice extends ExplorerTeFilePickerPathChoice {
  directory: string;
  name: string;
  existed?: boolean;
}

interface ExplorerTeFilePickerOpenDirectoryOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePickerOpenFileOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePickerOpenOptions {
  title: string;
  startPath?: string;
  mode?: 'any' | 'file' | 'dir';
  selectLabel?: string;
}

interface ExplorerTeFilePickerSaveFileOptions {
  title: string;
  startPath?: string;
  filename?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePicker {
  openDirectory(
    options: ExplorerTeFilePickerOpenDirectoryOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  open?(
    options: ExplorerTeFilePickerOpenOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  openFile?(
    options: ExplorerTeFilePickerOpenFileOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  saveFile(
    options: ExplorerTeFilePickerSaveFileOptions,
  ): Promise<ExplorerTeFilePickerSaveChoice | null>;
}

declare global {
  interface Window {
    host?: ExplorerHostBridge;
    __cm6EditorState?: unknown;
    __cm6ApplyAutosaveContent?: (payload: unknown) => void;
    __cm6ApplyRemoteDraft?: (payload: unknown) => void;
    __cm6EnsureDraftDiffs?: (force?: boolean) => Promise<void> | void;
    __cm6EnsureInlineDiffs?: (force?: boolean) => Promise<void> | void;
    __cm6HandlePrefsChanged?: (payload: unknown) => void;
    __cm6HandleProjectOpened?: (path: string) => void;
    __cm6HandleWatcherError?: (payload: Record<string, unknown>) => void;
    __cm6HandleWatcherRaiseResult?: (payload: Record<string, unknown>) => void;
    __cm6PendingPrefsChanged?: unknown;
    __cm6PendingWatcherError?: Record<string, unknown>;
    __cm6PendingWatcherRaiseResult?: Record<string, unknown>;
    __cm6ReloadCurrentFile?: () => void;
    __cm6RequestGitBaselines?: () => void;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    teFilePicker?: ExplorerTeFilePicker;
  }
}

declare module '/static/vendor/seti-icons/seti-icons.js' {
  interface SetiIconPayload {
    svg?: string;
    color?: string;
  }

  export function getIcon(fileName: string): Promise<SetiIconPayload | null>;
}
