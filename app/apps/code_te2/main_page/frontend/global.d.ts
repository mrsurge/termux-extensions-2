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
    VConsole?: any;
    __adapterConnected?: any;
    __codeTe2CloseLspMenus?: any;
    __codeTe2EditorState?: unknown;
    __codeTe2ApplyAutosaveContent?: (payload: unknown) => void;
    __codeTe2ApplyRemoteDraft?: (payload: unknown) => void;
    __codeTe2EnsureDraftDiffs?: any;
    __codeTe2EnsureInlineDiffs?: any;
    __codeTe2HandleLspStatusUpdate?: any;
    __codeTe2HandlePrefsChanged?: any;
    __codeTe2HandleProjectOpened?: any;
    __codeTe2HandleUiPrefs?: (payload: unknown) => void;
    __codeTe2HandleWatcherConfig?: any;
    __codeTe2HandleWatcherError?: any;
    __codeTe2HandleWatcherModeStatus?: any;
    __codeTe2HandleWatcherRaiseResult?: any;
    __codeTe2LspUi?: any;
    __codeTe2PendingUiPrefs?: unknown;
    __codeTe2PendingPrefsChanged?: any;
    __codeTe2PendingWatcherError?: any;
    __codeTe2PendingWatcherRaiseResult?: any;
    __codeTe2RefreshRecents?: (state: unknown) => void;
    __codeTe2ReloadCurrentFile?: any;
    __codeTe2RequestGitBaselines?: any;
    __codeTe2SyncState?: any;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    __feAdapterUi?: RuntimeAdapterUi;
    __feAppContext?: unknown;
    __feLspSpinnerState?: any;
    __feLspSpinnerUi?: any;
    __fePendingCacheIndicator?: any;
    appOpenFile?: ExplorerOpenFileAbsFn;
    appOpenFileRel?: ExplorerOpenFileRelFn;
    jumpToCurrentFileLine?: ExplorerJumpToLineFn;
    applyCacheIndicator?: any;
    currentPath?: string | null;
    monaco?: any;
    io?: any;
    teUI: TeUiApi;
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
