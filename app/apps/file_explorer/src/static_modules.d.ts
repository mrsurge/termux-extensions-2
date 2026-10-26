declare module '*/te2_console_bridge.js' {
  export function initBuiltinConsoleBridge(options: { prepare?: () => Promise<void>; appId: string; workerLabel: string; socketPath: string; namespace: string; workerId?: string; uniquePerWindow?: boolean }): Promise<unknown>;
  export function initConsoleBridge(options: { appId: string; workerLabel: string; socketPath: string; namespace: string; workerId?: string; uniquePerWindow?: boolean }): unknown;
  export function getConsoleBridgeStatus(): unknown;
}
declare module '*/file_icons.js' {
  export function getIcon(name: string): Promise<import('./viewport').FileIcon>;
  export function renderIcon(element: HTMLElement, icon: import('./viewport').FileIcon): void;
}
declare module '*/file_explorer_selection.mjs' {
  export function selectPaths(selected: Set<string>, order: string[], anchor: string | null, path: string, options: import('./viewport').SelectionModifiers): import('./viewport').SelectionResult;
}
declare module '*/file_explorer_filter.mjs' {
  export const createListingFilter: import('./viewport').FilterFactory;
}
declare module '*/te_file_explorer_intents.mjs' {
  export function createFileExplorerIntents(options: { api: import('./api').HostAppApi; location: Location; dialog: import('./action_types').ActionDialog; randomId(): string }): {
    openFile(path: string): Promise<void>; openProject(path: string): Promise<void>; openTerminal(path: string): Promise<void>;
  };
}
