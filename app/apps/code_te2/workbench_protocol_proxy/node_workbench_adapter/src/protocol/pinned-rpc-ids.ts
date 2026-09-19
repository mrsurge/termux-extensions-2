// Authoritative NIDs for our managed code-server build, not runtime defaults.
// Update this map explicitly when the pinned build changes or an actor is added.
// build.mjs ships this imported module alongside WBA; never extract NIDs at startup.
export const PINNED_CODE_SERVER_VERSION = "4.130.0";
export const PINNED_CODE_SERVER_COMMIT = "197ef3e8da8ee99ed6ca8f1a630157527e6d448f";
export const PINNED_RPC_IDS = Object.freeze({
  MainThreadConsole: 13,
  MainThreadCommands: 10,
  MainThreadLogger: 28,
  MainThreadMessageService: 29,
  MainThreadOutputService: 30,
  MainThreadStatusBar: 36,
  MainThreadStorage: 38,
  MainThreadTextEditors: 20,
  MainThreadWebviews: 44,
  MainThreadWebviewPanels: 45,
  MainThreadWebviewViews: 46,
  MainThreadExtensionService: 54,
  MainThreadDocumentContentProviders: 19,
  ExtHostConfiguration: 90,
  ExtHostCommands: 89,
  ExtHostDocumentsAndEditors: 94,
  ExtHostDocuments: 95,
  ExtHostDocumentContentProviders: 96,
  ExtHostEditors: 98,
  ExtHostFileSystemInfo: 101,
  ExtHostLanguages: 103,
  ExtHostLanguageFeatures: 104,
  ExtHostStatusBar: 108,
  ExtHostExtensionService: 110,
  ExtHostWorkspace: 117,
  ExtHostEditorTabs: 125,
  ExtHostOutputService: 134,
  ExtHostWebviews: 120,
  ExtHostWebviewPanels: 121,
  ExtHostWebviewViews: 123,
} as const);
