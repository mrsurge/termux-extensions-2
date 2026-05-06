import type { ExplorerStickyScopesApi } from '../../src/explorer/chrome/sticky-scopes.ts';

export {};

interface HostBridge {
  toast: (message: string, kind?: unknown) => void;
  onBeforeExit: (cb: () => Record<string, unknown>) => void;
}

interface RuntimeAdapterUi {
  updateLspSpinner?: () => void;
  [key: string]: unknown;
}

interface ExplorerOpenFileOptions extends Record<string, unknown> {
  line?: number;
  column?: number;
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
}

interface TeFilePickerOpenDirectoryOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface TeFilePickerOpenOptions {
  title: string;
  startPath?: string;
  mode?: 'any' | 'file' | 'dir';
  selectLabel?: string;
}

interface TeFilePickerOpenFileOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface TeFilePickerSaveFileOptions {
  title: string;
  startPath?: string;
  filename?: string;
  selectLabel?: string;
}

interface TeFilePickerPathChoice {
  path: string;
}

interface TeFilePickerSaveChoice extends TeFilePickerPathChoice {
  directory: string;
  name: string;
  existed?: boolean;
}

interface TeFilePicker {
  openDirectory(
    options: TeFilePickerOpenDirectoryOptions,
  ): Promise<TeFilePickerPathChoice | null>;
  open(
    options: TeFilePickerOpenOptions,
  ): Promise<TeFilePickerPathChoice | null>;
  openFile?(
    options: TeFilePickerOpenFileOptions,
  ): Promise<TeFilePickerPathChoice | null>;
  saveFile(
    options: TeFilePickerSaveFileOptions,
  ): Promise<TeFilePickerSaveChoice | null>;
}

type ExplorerOpenFileAbsFn = (
  path: string,
  options?: ExplorerOpenFileOptions,
) => Promise<unknown>;

type ExplorerOpenFileRelFn = (
  path: string,
  projectPath?: string | null,
  options?: ExplorerOpenFileOptions,
) => Promise<unknown>;

type ExplorerJumpToLineFn = (
  line: number,
  options?: ExplorerOpenFileOptions,
) => Promise<unknown>;

declare global {
  interface Window {
    host?: HostBridge;
    api?: unknown;
    VConsole?: any;
    __adapterConnected?: any;
    __cm6CloseLspMenus?: any;
    __cm6EditorState?: any;
    __cm6ApplyAutosaveContent?: (payload: unknown) => void;
    __cm6ApplyRemoteDraft?: (payload: unknown) => void;
    __cm6EnsureDraftDiffs?: any;
    __cm6EnsureInlineDiffs?: any;
    __cm6HandleLspStatusUpdate?: any;
    __cm6HandlePrefsChanged?: any;
    __cm6HandleProjectOpened?: any;
    __cm6HandleUiPrefs?: (payload: unknown) => void;
    __cm6HandleWatcherConfig?: any;
    __cm6HandleWatcherError?: any;
    __cm6HandleWatcherModeStatus?: any;
    __cm6HandleWatcherRaiseResult?: any;
    __cm6LspUi?: any;
    __cm6PendingUiPrefs?: unknown;
    __cm6PendingPrefsChanged?: any;
    __cm6PendingWatcherError?: any;
    __cm6PendingWatcherRaiseResult?: any;
    __cm6RefreshRecents?: any;
    __cm6ReloadCurrentFile?: any;
    __cm6RequestGitBaselines?: any;
    __cm6SyncState?: any;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    __feAdapterUi?: RuntimeAdapterUi;
    __feAppContext?: unknown;
    __feCursorStateDebounceMs?: number;
    __feLspSpinnerState?: any;
    __feLspSpinnerUi?: any;
    __fePendingCacheIndicator?: any;
    appOpenFile?: ExplorerOpenFileAbsFn;
    appOpenFileRel?: ExplorerOpenFileRelFn;
    fileNameEl?: HTMLElement;
    jumpToCurrentFileLine?: ExplorerJumpToLineFn;
    applyCacheIndicator?: any;
    currentPath?: string | null;
    monaco?: any;
    io?: any;
    teFilePicker?: TeFilePicker;
    wsPort?: any;
  }
}

declare module '/static/vendor/seti-icons/seti-icons.js' {
  interface SetiIconPayload {
    svg?: string;
    color?: string;
  }

  export function getIcon(
    fileName: string,
  ): Promise<SetiIconPayload | null>;
}
