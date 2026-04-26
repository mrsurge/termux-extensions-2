import { handleDraftDiffEvent } from './editor_socket_draft_diff_handler_utils.js';
import { logDiagnosticsEvent } from './editor_diagnostics_log_utils.js';
import { applyDiagnosticsBridgeUpdate } from './editor_diagnostics_apply_update_utils.js';
import { handleWorkbenchResponseEvent } from './editor_socket_workbench_response_handler_utils.js';
import { handleSemanticTokensProviderRegistered } from './editor_socket_semantic_registered_handler_utils.js';
import { handleCompletionProviderRegistered } from './editor_socket_completion_registered_handler_utils.ts';
import { handleIssuesDumpRequest } from './editor_socket_issues_dump_handler_utils.js';
import { handleIssuesCommand } from './editor_socket_issues_cmd_handler_utils.js';
import { handleFindCommand } from './editor_socket_find_cmd_handler_utils.js';

interface EditorSocketLike {
  on(eventName: string, handler: (payload: unknown) => void): void;
}

interface WorkbenchPendingEntry {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface EditorRuntimeSocketHandlerDeps {
  getCurrentPath(): string | null;
  getDraftDiffRequestId(): string | null;
  applyDraftDiffDecorations(payload: unknown): void;
  getModel(): unknown;
  absPathFromVscodeUri(raw: string): string | null;
  applyDiagnosticsUpdate(payload: unknown): void;
  workbenchPending: Map<string, WorkbenchPendingEntry>;
  clearTimeoutFn(handle: ReturnType<typeof setTimeout>): void;
  languageBridge: {
    registeredSemanticTokens: Set<string>;
    semanticTokensLegendCache: Record<string, unknown>;
    semanticTokensRangeFlag: Record<string, unknown>;
  };
  registerSemanticTokensWithLegend(lang: string, legend: unknown, isRange: boolean): void;
  cacheCompletionProviderRegistration(lang: string, registration: { handle: string; triggerCharacters: string[]; supportsResolve: boolean }): void;
  getMonaco(): unknown;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  getEditor(): unknown;
  runIssuesCommand(editor: unknown, action: string): void;
  runFindCommand(editor: unknown, action: string, onError: (error: unknown) => void): void;
}

const WORKBENCH_RESPONSE_EVENTS = [
  'open_file',
  'hover',
  'symbols',
  'completions',
  'semantic_tokens',
  'semantic_tokens_legend',
  'semantic_tokens_range',
  'folding_ranges',
  'providers',
  'grammars_list',
  'grammars_load',
  'language_catalog',
] as const;

export function registerEditorRuntimeSocketHandlers(
  socket: EditorSocketLike,
  deps: EditorRuntimeSocketHandlerDeps,
): void {
  socket.on('editor:draft_diff', (payload: unknown) => {
    try {
      handleDraftDiffEvent(
        payload,
        deps.getCurrentPath(),
        deps.getDraftDiffRequestId(),
        deps.applyDraftDiffDecorations,
      );
    } catch (error) {
      console.warn('[DraftDiff] handler failed', error);
    }
  });

  socket.on('editor:diagnostics', (payload: unknown) => {
    try {
      logDiagnosticsEvent(payload, deps.getModel(), deps.getCurrentPath(), deps.absPathFromVscodeUri);
      applyDiagnosticsBridgeUpdate(payload, deps.applyDiagnosticsUpdate);
    } catch (_) {}
  });

  for (const suffix of WORKBENCH_RESPONSE_EVENTS) {
    socket.on(`editor:workbench_${suffix}_response`, (payload: unknown) => {
      try {
        handleWorkbenchResponseEvent(payload, deps.workbenchPending, deps.clearTimeoutFn);
      } catch (_) {}
    });
  }

  socket.on('editor:semantic_tokens_provider_registered', (payload: unknown) => {
    try {
      handleSemanticTokensProviderRegistered(
        payload,
        deps.languageBridge,
        deps.registerSemanticTokensWithLegend,
      );
    } catch (_) {}
  });

  socket.on('editor:completions_provider_registered', (payload: unknown) => {
    try {
      handleCompletionProviderRegistered(
        payload,
        deps.cacheCompletionProviderRegistration,
      );
    } catch (_) {}
  });

  socket.on('editor:issues_dump_request', (payload: unknown) => {
    try {
      handleIssuesDumpRequest(payload, deps.getMonaco(), deps.getModel(), deps.emitToHost);
    } catch (error) {
      console.warn('[Monaco] issues dump response failed', error);
    }
  });

  socket.on('editor:issues_cmd', (payload: unknown) => {
    try {
      handleIssuesCommand(payload, deps.getEditor(), deps.runIssuesCommand);
    } catch (_) {}
  });

  socket.on('editor:find_cmd', (payload: unknown) => {
    try {
      handleFindCommand(payload, deps.getEditor(), deps.runFindCommand);
    } catch (error) {
      console.error('[Find] error:', error);
    }
  });
}
