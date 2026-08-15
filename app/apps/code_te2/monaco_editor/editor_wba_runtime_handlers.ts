import { logDiagnosticsEvent } from "./editor_diagnostics_log_utils.js";
import { applyDiagnosticsBridgeUpdate } from "./editor_diagnostics_apply_update_utils.js";
import { handleSemanticTokensProviderRegistered } from "./editor_socket_semantic_registered_handler_utils.js";
import { handleCompletionProviderRegistered } from "./editor_socket_completion_registered_handler_utils.ts";
import { handleDocumentColorProviderRegistered } from "./editor_socket_document_colors_registered_handler_utils.ts";
import { handleInlayHintsProviderRegistered } from "./editor_socket_inlay_hints_registered_handler_utils.ts";
import { handleInlineCompletionProviderRegistered } from "./editor_socket_inline_completions_registered_handler_utils.ts";
import { emitExtensionActivityEvent } from "../main_page/frontend/connections/extension-activity-bridge.ts";

interface WbaNotificationTransportLike {
  onNotification(
    method: string,
    handler: (params: Record<string, unknown>) => void,
  ): () => void;
}

interface EditorWbaRuntimeHandlerDeps {
  getCurrentPath(): string | null;
  getModel(): unknown;
  absPathFromVscodeUri(raw: string): string | null;
  applyDiagnosticsUpdate(payload: unknown): void;
  languageBridge: {
    registeredSemanticTokens: Set<string>;
    semanticTokensProviderKeysByLanguage: Record<string, Set<string>>;
    semanticTokensLegendCache: Record<string, unknown>;
    semanticTokensRangeFlag: Record<string, unknown>;
    semanticTokensLanguagesByEventHandle: Record<string, string[]>;
  };
  registerSemanticTokensWithLegend(
    lang: string,
    legend: unknown,
    isRange: boolean,
    options?: {
      providerKey?: string;
      replay?: boolean;
    },
  ): void;
  fireSemanticTokensChanged(lang?: string | null): void;
  cacheCompletionProviderRegistration(
    lang: string,
    registration: {
      handle: string;
      triggerCharacters: string[];
      supportsResolve: boolean;
    },
  ): void;
  cacheDocumentColorProviderRegistration(
    lang: string,
    registration: {
      handle: string;
    },
  ): void;
  cacheInlayHintsProviderRegistration(
    lang: string,
    registration: {
      handle: string;
      supportsResolve: boolean;
      displayName?: string | null;
      eventHandle?: number | null;
    },
  ): void;
  cacheInlineCompletionProviderRegistration(
    lang: string,
    registration: {
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
    },
  ): void;
  cacheLanguageProviderRegistration(
    kind:
      | "documentHighlights"
      | "definitions"
      | "references"
      | "implementations",
    lang: string,
  ): void;
  resetDynamicProviderCaches?(reason?: string): void;
  onWorkspaceSwitchedAck?(event: Record<string, unknown>): void;
  notifyExtensionMessage?(event: Record<string, unknown>): void;
  handleEditorOperation?(event: Record<string, unknown>): void;
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === "string" ? event.type : "";
}

export function registerEditorWbaRuntimeHandlers(
  transport: WbaNotificationTransportLike,
  deps: EditorWbaRuntimeHandlerDeps,
): void {
  transport.onNotification("vscode.editorOperation", (event) => {
    deps.handleEditorOperation?.(event);
  });
  transport.onNotification("te2.event", (event: Record<string, unknown>) => {
    try {
      const type = eventType(event);
      if (type === "extension/message") {
        deps.notifyExtensionMessage?.(event);
        return;
      }
      if (type.startsWith("extension/")) {
        emitExtensionActivityEvent(event);
        return;
      }
      if (type === "adapter/sessionReset") {
        deps.resetDynamicProviderCaches?.(
          typeof event.reason === "string" ? event.reason : "session_reset",
        );
        return;
      }

      if (type === "workspace/switched") {
        deps.onWorkspaceSwitchedAck?.(event);
        return;
      }

      if (type === "diagnostics/changeMany") {
        logDiagnosticsEvent(
          event,
          deps.getModel(),
          deps.getCurrentPath(),
          deps.absPathFromVscodeUri,
        );
        applyDiagnosticsBridgeUpdate(event, deps.applyDiagnosticsUpdate);
        return;
      }

      if (type === "provider/semanticTokens") {
        handleSemanticTokensProviderRegistered(
          event,
          deps.languageBridge,
          deps.registerSemanticTokensWithLegend,
        );
        return;
      }

      if (type === "provider/semanticTokens/didChange") {
        const eventHandle = Number(event.eventHandle);
        if (Number.isFinite(eventHandle)) {
          const languages =
            deps.languageBridge.semanticTokensLanguagesByEventHandle[
              String(eventHandle)
            ] || [];
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

      if (type === "provider/completions") {
        handleCompletionProviderRegistered(
          event,
          deps.cacheCompletionProviderRegistration,
        );
        return;
      }

      if (type === "provider/documentColors") {
        handleDocumentColorProviderRegistered(
          event,
          deps.cacheDocumentColorProviderRegistration,
        );
        return;
      }

      if (type === "provider/inlayHints") {
        handleInlayHintsProviderRegistered(
          event,
          deps.cacheInlayHintsProviderRegistration,
        );
        return;
      }

      if (type === "provider/inlineCompletions") {
        handleInlineCompletionProviderRegistered(
          event,
          deps.cacheInlineCompletionProviderRegistration,
        );
        return;
      }

      const positionProviderKind = {
        "provider/documentHighlights": "documentHighlights",
        "provider/definitions": "definitions",
        "provider/references": "references",
        "provider/implementations": "implementations",
      }[type] as
        | "documentHighlights"
        | "definitions"
        | "references"
        | "implementations"
        | undefined;
      if (positionProviderKind && typeof event.language === "string") {
        deps.cacheLanguageProviderRegistration(
          positionProviderKind,
          event.language,
        );
      }
    } catch (_) {}
  });
}
