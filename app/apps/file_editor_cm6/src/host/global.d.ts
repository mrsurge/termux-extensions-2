export {};

interface HostBridge {
  toast?: (message: string, ms?: number) => void;
}

interface ExplorerStickyScopesApi {
  update?(): void;
  destroy?(): void;
}

interface ExplorerOpenFileOptions {
  line?: number;
  column?: number;
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
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
    VConsole?: any;
    __adapterConnected?: any;
    __cm6CloseLspMenus?: any;
    __cm6EditorState?: any;
    __cm6ApplyAutosaveContent?: (payload: unknown) => void;
    __cm6ApplyRemoteDraft?: (payload: unknown) => void;
    __cm6EnsureDraftDiffs?: any;
    __cm6ExplorerOnReconnect?: () => void;
    __cm6EnsureInlineDiffs?: any;
    __cm6HandleLspStatusUpdate?: any;
    __cm6HandlePrefsChanged?: any;
    __cm6HandleProjectOpened?: any;
    __cm6HandleWatcherConfig?: any;
    __cm6HandleWatcherError?: any;
    __cm6HandleWatcherModeStatus?: any;
    __cm6HandleWatcherRaiseResult?: any;
    __cm6LspUi?: any;
    __cm6PendingPrefsChanged?: any;
    __cm6PendingWatcherError?: any;
    __cm6PendingWatcherRaiseResult?: any;
    __cm6RefreshExplorer?: any;
    __cm6RefreshRecents?: any;
    __cm6ReloadCurrentFile?: any;
    __cm6RequestGitBaselines?: any;
    __cm6SyncState?: any;
    __explorerHandleNotification?: any;
    __explorerScrollToActiveFile?: () => Promise<void>;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    __explorerRpc?: any;
    __feLspSpinnerState?: any;
    __feLspSpinnerUi?: any;
    __fePendingCacheIndicator?: any;
    appOpenFile?: ExplorerOpenFileAbsFn;
    appOpenFileRel?: ExplorerOpenFileRelFn;
    jumpToCurrentFileLine?: ExplorerJumpToLineFn;
    applyCacheIndicator?: any;
    io?: any;
    teFilePicker?: any;
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
