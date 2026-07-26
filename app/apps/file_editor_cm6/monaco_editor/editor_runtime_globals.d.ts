interface MonacoRuntimeEditorOptionMap {
  fontFamily?: unknown;
  fontSize?: unknown;
  lineHeight?: unknown;
  readOnly?: unknown;
}

interface MonacoRuntimePositionLike {
  lineNumber?: number;
  column?: number;
}

interface MonacoRuntimeSelectionLike extends MonacoRuntimePositionLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  isEmpty?(): boolean;
}

interface MonacoRuntimeMarkerLike {
  severity?: number;
  startLineNumber?: number;
  startColumn?: number;
}

interface MonacoRuntimeModelLike {
  uri?: { toString(): string };
  getLineCount?(): number;
  getValueInRange?(range: unknown): string;
  getLineContent?(lineNumber: number): string;
}

interface MonacoRuntimeDisposableLike {
  dispose?(): void;
}

interface MonacoRuntimeViewZoneAccessorLike {
  removeZone?(id: string | number): void;
}

interface MonacoRuntimeEditorLike {
  __te2MarkerNavBound?: boolean;
  _themeService?: unknown;
  _instantiationService?: unknown;
  addCommand?(keybinding: number, handler: () => void): void;
  onDidFocusEditorWidget?(handler: () => void): MonacoRuntimeDisposableLike;
  onDidBlurEditorWidget?(handler: () => void): MonacoRuntimeDisposableLike;
  onDidScrollChange?(handler: () => void): MonacoRuntimeDisposableLike;
  onDidChangeCursorPosition?(handler: () => void): MonacoRuntimeDisposableLike;
  getPosition?(): MonacoRuntimePositionLike | null;
  getSelection?(): MonacoRuntimeSelectionLike | null;
  setPosition?(position: { lineNumber: number; column: number }): void;
  revealLineInCenter?(lineNumber: number, scrollType?: number): void;
  focus?(): void;
  getOption?(option: unknown): unknown;
  getDomNode?(): HTMLElement | null;
  getModel?(): MonacoRuntimeModelLike | null;
  updateOptions?(options: Record<string, unknown>): void;
  deltaDecorations?(oldIds: Array<string | number>, newDecorations: unknown[]): Array<string | number>;
  changeViewZones?(callback: (accessor: MonacoRuntimeViewZoneAccessorLike) => void): void;
  hasTextFocus?(): boolean;
}

interface MonacoRuntimeDiffEditorLike {
  getOriginalEditor?(): MonacoRuntimeEditorLike | null;
  getModifiedEditor?(): MonacoRuntimeEditorLike | null;
  updateOptions?(options: Record<string, unknown>): void;
}

interface MonacoRuntimeEditorNamespace {
  EditorOption?: MonacoRuntimeEditorOptionMap;
  createModel?(value: string, language: string): unknown;
  setModelLanguage?(model: unknown, language: string): void;
  getModels?(): Array<{ resetTokenization?(): void }>;
  getModelMarkers?(opts: { resource: { toString(): string } }): MonacoRuntimeMarkerLike[];
  setModelMarkers?(model: unknown, owner: string, markers: Record<string, unknown>[]): void;
  defineTheme?(themeId: string, theme: Record<string, unknown>): void;
  setTheme?(themeId: string): void;
}

interface MonacoRuntimeGlobal {
  editor?: MonacoRuntimeEditorNamespace;
  languages?: {
    CompletionItemKind?: unknown;
    setColorMap?(colorMap: string[]): void;
    getLanguages?(): Array<{ id?: string }>;
    getEncodedLanguageId?(languageId: string): number;
    register?(desc: Record<string, unknown>): void;
    setTokensProvider?(languageId: string, provider: Record<string, unknown>): void;
    setLanguageConfiguration?(languageId: string, configuration: Record<string, unknown>): void;
    typescript?: unknown;
  };
  Uri?: {
    file?(path: string): unknown;
  };
  Range?: new (...args: number[]) => unknown;
  MarkerSeverity?: {
    Error?: number;
    Warning?: number;
    Info?: number;
    Hint?: number;
  };
  KeyMod?: {
    CtrlCmd?: number;
    Alt?: number;
    Shift?: number;
  };
  KeyCode?: {
    KeyS?: number;
    F8?: number;
  };
}

interface MonacoTextmateTokenLike {
  startIndex: number;
  endIndex: number;
  scopes?: string[];
}

interface MonacoTextmateTokenizeLineResultLike {
  tokens: MonacoTextmateTokenLike[];
  ruleStack: unknown;
}

interface MonacoTextmateGrammarLike {
  tokenizeLine?(text: string, ruleStack: unknown): MonacoTextmateTokenizeLineResultLike;
}

interface MonacoTextmateGlobal {
  INITIAL?: unknown;
}

interface MonacoRuntimeSocketLike {
  connected?: boolean;
  on?(eventName: string, handler: (payload: unknown) => void): void;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface MonacoSocketIoLike {
  (namespace: string, options?: Record<string, unknown>): MonacoRuntimeSocketLike;
}

interface MonacoTouchSelectionGlobal {
  editorTouchSelectionHelp?(
    editor: MonacoRuntimeEditorLike,
    options?: {
      navigationTools?: (options: {
        editor: MonacoRuntimeEditorLike;
        selectorMenu: HTMLDivElement;
        defaultTools: Map<string, MonacoTouchSelectionTool>;
        openMenu(): void;
        closeMenu(): void;
      }) => Iterable<MonacoTouchSelectionTool> | undefined;
    },
  ): void;
}

interface MonacoTouchSelectionTool {
  name: string;
  innerHTML: string | Element | (() => string | Element);
  action(): Promise<void> | void;
}

interface MonacoRuntimeTermShim {
  attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean | void): void;
  input?(data: string): void;
}

interface Window {
  monaco?: MonacoRuntimeGlobal;
  io?: MonacoSocketIoLike;
  vscodetextmate?: MonacoTextmateGlobal;
  __debugDraftDiffs?: boolean;
  __debugWorkbenchDiag?: boolean;
  __debugDisableTextmate?: boolean;
  __debugDisableSemanticTokens?: boolean;
  ['monaco-touch-selection']?: MonacoTouchSelectionGlobal;
  term?: MonacoRuntimeTermShim;
  ctrl?: boolean;
}

declare const monaco: MonacoRuntimeGlobal | undefined;
