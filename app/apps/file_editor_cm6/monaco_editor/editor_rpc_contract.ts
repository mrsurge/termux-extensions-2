export const JSONRPC_VERSION = '2.0' as const;
export const EDITOR_RPC_EVENT = 'rpc' as const;

export type JsonRpcId = string | number;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface JsonRpcRequestEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: EditorRpcMethodName;
  params: Record<string, unknown>;
}

export interface JsonRpcNotificationEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  method: EditorRpcMethodName | EditorRpcNotificationName;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccessEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export const EDITOR_RPC_METHODS = {
  open: 'editor.open',
  jumpToLine: 'editor.jumpToLine',
  gitBaselinesGet: 'editor.gitBaselines.get',
  draftDiffGet: 'editor.draftDiff.get',
  mirrorPublish: 'editor.mirror.publish',
  save: 'editor.save',
  workbenchOpenFile: 'editor.workbench.openFile',
  workbenchHover: 'editor.workbench.hover',
  workbenchCompletions: 'editor.workbench.completions',
  workbenchSemanticTokens: 'editor.workbench.semanticTokens',
  workbenchSemanticTokensLegend: 'editor.workbench.semanticTokensLegend',
  workbenchSemanticTokensRange: 'editor.workbench.semanticTokensRange',
  workbenchSymbols: 'editor.workbench.symbols',
  workbenchFoldingRanges: 'editor.workbench.foldingRanges',
  workbenchProviders: 'editor.workbench.providers',
  workbenchDidChange: 'editor.workbench.didChange',
  workbenchGrammarsList: 'editor.workbench.grammarsList',
  workbenchGrammarsLoad: 'editor.workbench.grammarsLoad',
} as const;

export type EditorRpcMethodName = (typeof EDITOR_RPC_METHODS)[keyof typeof EDITOR_RPC_METHODS];

export const EDITOR_RPC_NOTIFICATIONS = {
  stateSsot: 'editor.state.ssot',
  fileOpened: 'editor.file.opened',
  fileJumpToLine: 'editor.file.jumpToLine',
  mirrorUpdated: 'editor.mirror.updated',
  gitBaselines: 'editor.gitBaselines.updated',
  draftDiff: 'editor.draftDiff.updated',
  prefsChanged: 'editor.prefs.changed',
  cacheState: 'editor.cache.state',
  draftState: 'editor.draft.state',
  ready: 'editor.ready',
  notify: 'editor.notify',
  openComplete: 'editor.open.complete',
  diagnostics: 'editor.diagnostics.updated',
  diagnosticsCounts: 'editor.diagnostics.counts',
  semanticTokensProviderRegistered: 'editor.semanticTokens.providerRegistered',
  issuesDumpRequest: 'editor.issues.dump.request',
  issuesDumpResponse: 'editor.issues.dump.response',
  issuesCommand: 'editor.issues.command',
  findCommand: 'editor.find.command',
} as const;

export type EditorRpcNotificationName = (typeof EDITOR_RPC_NOTIFICATIONS)[keyof typeof EDITOR_RPC_NOTIFICATIONS];

export interface EditorRpcOpenParams {
  path: string;
  line?: number;
  column?: number;
  request_id?: string;
}

export interface EditorRpcJumpToLineParams {
  line: number;
  column?: number;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
}

export interface EditorRpcGitBaselinesGetParams {
  path: string;
}

export interface EditorRpcDraftDiffGetParams {
  path: string;
  requestId?: string;
  request_id?: string;
}

export interface EditorRpcMirrorPublishParams {
  path: string;
  content: string;
  content_sha256?: string;
  base_sha256?: string;
}

export interface EditorRpcSaveParams {
  path: string;
  content?: string;
  content_sha256?: string;
  base_sha256?: string;
  request_id?: string;
  requestId?: string;
}

export interface EditorRpcWorkbenchOpenFileParams {
  path: string;
  languageId?: string;
  uri?: string;
  requestId?: string;
  forceRefresh?: boolean;
  generation?: number;
}

export interface EditorRpcWorkbenchHoverParams {
  path: string;
  languageId?: string;
  lineNumber?: number;
  line?: number;
  column?: number;
  character?: number;
}

export interface EditorRpcWorkbenchCompletionsParams extends EditorRpcWorkbenchHoverParams {
  triggerKind?: number;
  triggerCharacter?: string;
  text?: string;
}

export interface EditorRpcWorkbenchSemanticTokensParams {
  path: string;
  languageId?: string;
  previousResultId?: string;
}

export interface EditorRpcWorkbenchSemanticTokensLegendParams {
  languageId: string;
}

export interface EditorRpcWorkbenchSemanticTokensRangeParams {
  path: string;
  languageId?: string;
  range: Record<string, unknown>;
}

export interface EditorRpcWorkbenchSymbolsParams {
  path: string;
  languageId?: string;
  generation?: number;
}

export interface EditorRpcWorkbenchFoldingRangesParams {
  path: string;
  languageId?: string;
  generation?: number;
  context?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface EditorRpcWorkbenchDidChangeParams {
  path: string;
  text: string;
  languageId?: string;
  generation?: number;
}

export interface EditorRpcWorkbenchGrammarsLoadParams {
  id: string;
}

export interface EditorRpcStateSsotNotificationParams {
  project?: string | null;
  session_state?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  currentPath?: string | null;
  file?: Record<string, unknown>;
}

export interface EditorRpcFileOpenedNotificationParams extends Record<string, unknown> {
  path?: string;
  request_id?: string;
}

export interface EditorRpcGitBaselinesNotificationParams extends Record<string, unknown> {
  path?: string;
}

export interface EditorRpcDraftDiffNotificationParams extends Record<string, unknown> {
  path?: string;
  hunks?: unknown[];
}

export interface EditorRpcPrefsChangedNotificationParams extends Record<string, unknown> {
  source_client?: string;
}

export function buildEditorRpcRequestEnvelope(
  id: JsonRpcId,
  method: EditorRpcMethodName,
  params: Record<string, unknown>,
): JsonRpcRequestEnvelope {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    method,
    params,
  };
}

export function buildEditorRpcNotificationEnvelope(
  method: EditorRpcMethodName | EditorRpcNotificationName,
  params: Record<string, unknown>,
): JsonRpcNotificationEnvelope {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params,
  };
}

export function isJsonRpcSuccessEnvelope(value: unknown): value is JsonRpcSuccessEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && 'id' in record && 'result' in record;
}

export function isJsonRpcErrorEnvelope(value: unknown): value is JsonRpcErrorEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && 'error' in record;
}

export function isJsonRpcNotificationEnvelope(value: unknown): value is JsonRpcNotificationEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && typeof record.method === 'string' && !('id' in record);
}

export function editorWorkbenchMethodToRpcMethod(method: string): EditorRpcMethodName | null {
  switch (String(method || '')) {
    case 'open_file':
      return EDITOR_RPC_METHODS.workbenchOpenFile;
    case 'hover':
      return EDITOR_RPC_METHODS.workbenchHover;
    case 'completions':
      return EDITOR_RPC_METHODS.workbenchCompletions;
    case 'semantic_tokens':
      return EDITOR_RPC_METHODS.workbenchSemanticTokens;
    case 'semantic_tokens_legend':
      return EDITOR_RPC_METHODS.workbenchSemanticTokensLegend;
    case 'semantic_tokens_range':
      return EDITOR_RPC_METHODS.workbenchSemanticTokensRange;
    case 'symbols':
      return EDITOR_RPC_METHODS.workbenchSymbols;
    case 'folding_ranges':
      return EDITOR_RPC_METHODS.workbenchFoldingRanges;
    case 'providers':
      return EDITOR_RPC_METHODS.workbenchProviders;
    case 'did_change':
      return EDITOR_RPC_METHODS.workbenchDidChange;
    case 'grammars_list':
      return EDITOR_RPC_METHODS.workbenchGrammarsList;
    case 'grammars_load':
      return EDITOR_RPC_METHODS.workbenchGrammarsLoad;
    default:
      return null;
  }
}
