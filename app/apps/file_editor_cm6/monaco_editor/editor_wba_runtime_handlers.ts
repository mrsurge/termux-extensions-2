import { logDiagnosticsEvent } from './editor_diagnostics_log_utils.js';
import { applyDiagnosticsBridgeUpdate } from './editor_diagnostics_apply_update_utils.js';
import { handleSemanticTokensProviderRegistered } from './editor_socket_semantic_registered_handler_utils.js';
import { handleCompletionProviderRegistered } from './editor_socket_completion_registered_handler_utils.ts';
import { handleInlayHintsProviderRegistered } from './editor_socket_inlay_hints_registered_handler_utils.ts';
import { handleInlineCompletionProviderRegistered } from './editor_socket_inline_completions_registered_handler_utils.ts';

interface WbaNotificationTransportLike {
  onNotification(method: string, handler: (params: Record<string, unknown>) => void): () => void;
}

interface EditorWbaRuntimeHandlerDeps {
  getCurrentPath(): string | null;
  getModel(): unknown;
  absPathFromVscodeUri(raw: string): string | null;
  applyDiagnosticsUpdate(payload: unknown): void;
  languageBridge: {
    registeredSemanticTokens: Set<string>;
    semanticTokensLegendCache: Record<string, unknown>;
    semanticTokensRangeFlag: Record<string, unknown>;
    semanticTokensLanguagesByEventHandle: Record<string, string[]>;
  };
  registerSemanticTokensWithLegend(lang: string, legend: unknown, isRange: boolean): void;
  fireSemanticTokensChanged(lang?: string | null): void;
  cacheCompletionProviderRegistration(lang: string, registration: { handle: string; triggerCharacters: string[]; supportsResolve: boolean }): void;
  cacheInlayHintsProviderRegistration(lang: string, registration: {
    handle: string;
    supportsResolve: boolean;
    displayName?: string | null;
    eventHandle?: number | null;
  }): void;
  cacheInlineCompletionProviderRegistration(lang: string, registration: {
    handle: string;
    supportsHandleEvents: boolean;
    extensionId?: string | null;
    extensionVersion?: string | null;
    groupId?: string | null;
    yieldsToGroupIds: string[];
    excludesGroupIds: string[];
    displayName?: string | null;
    debounceDelayMs?: number | null;
    eventHandle?: number | null;
  }): void;
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === 'string' ? event.type : '';
}

export function registerEditorWbaRuntimeHandlers(
  transport: WbaNotificationTransportLike,
  deps: EditorWbaRuntimeHandlerDeps,
): void {
  transport.onNotification('te2.event', (event: Record<string, unknown>) => {
    try {
      const type = eventType(event);
      if (type === 'diagnostics/changeMany') {
        logDiagnosticsEvent(event, deps.getModel(), deps.getCurrentPath(), deps.absPathFromVscodeUri);
        applyDiagnosticsBridgeUpdate(event, deps.applyDiagnosticsUpdate);
        return;
      }

      if (type === 'provider/semanticTokens') {
        handleSemanticTokensProviderRegistered(
          event,
          deps.languageBridge,
          deps.registerSemanticTokensWithLegend,
        );
        return;
      }

      if (type === 'provider/semanticTokens/didChange') {
        const eventHandle = Number(event.eventHandle);
        if (Number.isFinite(eventHandle)) {
          const languages = deps.languageBridge.semanticTokensLanguagesByEventHandle[String(eventHandle)] || [];
          if (languages.length) {
            for (const lang of languages) deps.fireSemanticTokensChanged(lang);
          } else {
            deps.fireSemanticTokensChanged(null);
          }
        } else {
          deps.fireSemanticTokensChanged(null);
        }
        return;
      }

      if (type === 'provider/completions') {
        handleCompletionProviderRegistered(
          event,
          deps.cacheCompletionProviderRegistration,
        );
        return;
      }

      if (type === 'provider/inlayHints') {
        handleInlayHintsProviderRegistered(
          event,
          deps.cacheInlayHintsProviderRegistration,
        );
        return;
      }

      if (type === 'provider/inlineCompletions') {
        handleInlineCompletionProviderRegistered(
          event,
          deps.cacheInlineCompletionProviderRegistration,
        );
      }
    } catch (_) {}
  });
}
