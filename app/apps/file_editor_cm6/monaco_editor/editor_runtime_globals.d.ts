interface MonacoRuntimeEditorOptionMap {
  fontFamily?: unknown;
  fontSize?: unknown;
  lineHeight?: unknown;
}

interface MonacoRuntimeMarkerLike {
  severity?: number;
  startLineNumber?: number;
}

interface MonacoRuntimeEditorNamespace {
  EditorOption?: MonacoRuntimeEditorOptionMap;
  createModel?(value: string, language: string): unknown;
  setModelLanguage?(model: unknown, language: string): void;
  getModels?(): Array<{ resetTokenization?(): void }>;
  getModelMarkers?(opts: { resource: { toString(): string } }): MonacoRuntimeMarkerLike[];
  setModelMarkers?(model: unknown, owner: string, markers: Record<string, unknown>[]): void;
}

interface MonacoRuntimeGlobal {
  editor?: MonacoRuntimeEditorNamespace;
  languages?: {
    CompletionItemKind?: unknown;
    setColorMap?(colorMap: string[]): void;
    getLanguages?(): Array<{ id?: string }>;
    register?(desc: Record<string, unknown>): void;
    setTokensProvider?(languageId: string, provider: Record<string, unknown>): void;
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
}

interface MonacoTextmateGlobal {
  INITIAL?: unknown;
}

interface MonacoSocketIoLike {
  (namespace: string, options?: Record<string, unknown>): unknown;
}

interface Window {
  monaco?: MonacoRuntimeGlobal;
  io?: MonacoSocketIoLike;
  vscodetextmate?: MonacoTextmateGlobal;
  __debugDraftDiffs?: boolean;
  __debugWorkbenchDiag?: boolean;
}

declare const monaco: MonacoRuntimeGlobal | undefined;
