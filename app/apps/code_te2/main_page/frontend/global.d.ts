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

interface TeDialogPromptOptions {
  title?: string;
  detail?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  password?: boolean;
}

interface TeDialogMessageOptions {
  title?: string;
  detail?: string;
  severity?: 'info' | 'warning' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  surface?: Record<string, unknown>;
}

interface TeDialogOpenRequest extends Record<string, unknown> {
  kind: 'alert' | 'confirm' | 'prompt' | 'form' | 'surface';
  title: string;
  message?: string;
  actions?: Array<Record<string, unknown>>;
  surface?: Record<string, unknown>;
}

interface TeDialogOpenResult {
  status: 'accepted' | 'cancelled' | 'closed' | 'replaced';
  action: string | null;
  values: Record<string, unknown>;
}

interface TeDialogApi {
  open(request: TeDialogOpenRequest): Promise<TeDialogOpenResult>;
  alert(message: string, options?: TeDialogMessageOptions): Promise<void>;
  confirm(message: string, options?: TeDialogMessageOptions): Promise<boolean>;
  prompt(message: string, defaultValue?: string, options?: TeDialogPromptOptions): Promise<string | null>;
}

interface TeUiApi {
  dialog: TeDialogApi;
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
    VConsole?: import('./host-console-drawer.ts').VConsoleConstructor;
    __adapterConnected?: boolean;
    __codeTe2CloseLspMenus?: () => void;
    __codeTe2EditorState?: unknown;
    __codeTe2ApplyAutosaveContent?: (payload: unknown) => void;
    __codeTe2ApplyRemoteDraft?: (payload: unknown) => void;
    __codeTe2EnsureDraftDiffs?: (force?: boolean) => Promise<void> | void;
    __codeTe2EnsureInlineDiffs?: (force?: boolean) => Promise<void> | void;
    __codeTe2HandleLspStatusUpdate?: (args: import('./ui/adapter-ui.ts').LspStatusArgs) => void;
    __codeTe2HandlePrefsChanged?: (payload: unknown) => void;
    __codeTe2HandleProjectOpened?: (path: string, payload?: Record<string, unknown>) => void;
    __codeTe2HandleUiPrefs?: (payload: unknown) => void;
    __codeTe2HandleWatcherConfig?: (config: Partial<import('./ui/watcher-settings.ts').WatcherConfig> & Record<string, unknown>) => void;
    __codeTe2HandleWatcherError?: (payload: import('./ui/watcher-settings.ts').WatcherErrorPayload | null) => void;
    __codeTe2HandleWatcherModeStatus?: (status: Partial<import('./ui/watcher-settings.ts').WatcherConfig> & { active?: boolean }) => void;
    __codeTe2HandleWatcherRaiseResult?: (payload: import('./ui/watcher-settings.ts').WatcherRaisePayload | null) => void;
    __codeTe2LspUi?: { activeLang: string | undefined; activeAttempt: number; loadingToastTimer: ReturnType<typeof setTimeout> | null; loadingToastShown: boolean; lastReadyToastAt: number };
    __codeTe2PendingUiPrefs?: unknown;
    __codeTe2PendingPrefsChanged?: unknown;
    __codeTe2PendingWatcherError?: import('./ui/watcher-settings.ts').WatcherErrorPayload | null;
    __codeTe2PendingWatcherRaiseResult?: import('./ui/watcher-settings.ts').WatcherRaisePayload | null;
    __codeTe2RefreshRecents?: (state: unknown) => void;
    __codeTe2ReloadCurrentFile?: () => void;
    __codeTe2RequestGitBaselines?: () => void;
    __codeTe2SyncState?: (force?: boolean) => void;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    __feAdapterUi?: RuntimeAdapterUi;
    __feAppContext?: unknown;
    __feLspSpinnerState?: { shownAtMs: number; hideTimer: ReturnType<typeof setTimeout> | null };
    __feLspSpinnerUi?: { lspShow: boolean; lspTitle: string; busyShow: boolean; busyTitle: string; busyLanguageId: string; busyActivity: string };
    __fePendingCacheIndicator?: unknown;
    appOpenFile?: ExplorerOpenFileAbsFn;
    appOpenFileRel?: ExplorerOpenFileRelFn;
    jumpToCurrentFileLine?: ExplorerJumpToLineFn;
    applyCacheIndicator?: (value: unknown) => void;
    currentPath?: string | null;
    teUI: TeUiApi;
    teFilePicker?: TeFilePicker;
    wsPort?: number | string;
  }
}

declare module '/static/js/file_icons.js' {
  interface SetiIconPayload {
    svg?: string;
    color?: string;
    codicon?: string;
  }

  export function getIcon(
    fileName: string,
  ): Promise<SetiIconPayload | null>;
  export function renderIcon(element: HTMLElement, icon: SetiIconPayload | null | undefined): boolean;
}
