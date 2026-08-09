import { EDITOR_RPC_NOTIFICATIONS } from "./editor_rpc_contract.ts";
import { handleDraftDiffEvent } from "./editor_socket_draft_diff_handler_utils.js";
import { handleIssuesDumpRequest } from "./editor_socket_issues_dump_handler_utils.js";
import { handleIssuesCommand } from "./editor_socket_issues_cmd_handler_utils.js";
import { handleFindCommand } from "./editor_socket_find_cmd_handler_utils.js";
import { createAgentEditReviewRuntime } from "./editor_agent_edit_review_runtime.ts";
import {
  clearSearchHighlight,
  handleSearchHighlight,
  reapplySearchHighlight,
} from "./editor_search_highlight_runtime.ts";

interface DisposableRuntime {
  dispose(): void;
}

let activeAgentEditReviewRuntime: DisposableRuntime | null = null;

interface EditorSocketLike {
  on(eventName: string, handler: (payload: unknown) => void): void;
}

interface EditorRpcNotificationSource {
  onNotification(
    method: string,
    handler: (payload: Record<string, unknown>) => void,
  ): () => void;
}

interface EditorRuntimeSocketHandlerDeps {
  rpcNotifications?: EditorRpcNotificationSource | null;
  getCurrentPath(): string | null;
  getDraftDiffRequestId(): string | null;
  applyDraftDiffDecorations(payload: unknown): void;
  getMonaco(): unknown;
  getModel(): unknown;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  getEditor(): unknown;
  getDocument(): Document | null;
  rpcCall(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  schedule(callback: () => void, delayMs: number): unknown;
  reapplyCodeInspectorHighlights(): void;
  clearCodeInspectorHighlights(): void;
  runIssuesCommand(editor: unknown, action: string): void;
  runFindCommand(
    editor: unknown,
    action: string,
    onError: (error: unknown) => void,
  ): void;
  runEditCommand(editor: unknown, command: string): boolean;
}

export function registerEditorRuntimeSocketHandlers(
  socket: EditorSocketLike,
  deps: EditorRuntimeSocketHandlerDeps,
): void {
  const handleDraftDiffPayload = (payload: unknown): void => {
    try {
      handleDraftDiffEvent(
        payload,
        deps.getCurrentPath(),
        deps.getDraftDiffRequestId(),
        deps.applyDraftDiffDecorations,
      );
    } catch (error) {
      console.warn("[DraftDiff] handler failed", error);
    }
  };

  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.draftDiff,
      handleDraftDiffPayload,
    );
  }

  try {
    activeAgentEditReviewRuntime?.dispose();
  } catch (_) {}

  const agentEditReviewRuntime = createAgentEditReviewRuntime({
    getDocument: deps.getDocument,
    getEditor: deps.getEditor,
    getModel: deps.getModel,
    getMonaco: deps.getMonaco,
    getCurrentPath: deps.getCurrentPath,
    rpcCall: deps.rpcCall,
    schedule: deps.schedule,
  });
  activeAgentEditReviewRuntime = agentEditReviewRuntime;

  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.agentEditsChanged,
      (payload) => {
        try {
          agentEditReviewRuntime.scheduleReapply(payload);
        } catch (error) {
          console.warn("[AgentEditReview] handler failed", error);
        }
      },
    );
  }

  const handleIssuesDumpRequestPayload = (payload: unknown): void => {
    try {
      handleIssuesDumpRequest(
        payload,
        deps.getMonaco(),
        deps.getModel(),
        deps.emitToHost,
      );
    } catch (error) {
      console.warn("[Monaco] issues dump response failed", error);
    }
  };

  const handleIssuesCommandPayload = (payload: unknown): void => {
    try {
      handleIssuesCommand(payload, deps.getEditor(), deps.runIssuesCommand);
    } catch (_) {}
  };

  const handleFindCommandPayload = (payload: unknown): void => {
    try {
      handleFindCommand(payload, deps.getEditor(), deps.runFindCommand);
    } catch (error) {
      console.error("[Find] error:", error);
    }
  };

  const handleSearchHighlightPayload = (payload: unknown): void => {
    try {
      handleSearchHighlight(payload, {
        getCurrentPath: deps.getCurrentPath,
        getEditor: deps.getEditor,
        getModel: deps.getModel,
        schedule: deps.schedule,
      });
    } catch (error) {
      console.warn("[SearchHighlight] handler failed", error);
    }
  };

  const handleEditCommandPayload = (payload: unknown): void => {
    try {
      const record =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      const command = typeof record.command === "string" ? record.command : "";
      if (!command) return;
      const ok = deps.runEditCommand(deps.getEditor(), command);
      if (!ok) console.warn("[Edit] command failed or unsupported", command);
    } catch (error) {
      console.warn("[Edit] command handler failed", error);
    }
  };

  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.issuesDumpRequest,
      handleIssuesDumpRequestPayload,
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.issuesCommand,
      handleIssuesCommandPayload,
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.findCommand,
      handleFindCommandPayload,
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.searchHighlight,
      handleSearchHighlightPayload,
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.fileOpened,
      () => {
        reapplySearchHighlight({
          getCurrentPath: deps.getCurrentPath,
          getEditor: deps.getEditor,
          getModel: deps.getModel,
          schedule: deps.schedule,
        });
        deps.reapplyCodeInspectorHighlights();
      },
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.openStateChanged,
      () => {
        reapplySearchHighlight({
          getCurrentPath: deps.getCurrentPath,
          getEditor: deps.getEditor,
          getModel: deps.getModel,
          schedule: deps.schedule,
        });
        deps.reapplyCodeInspectorHighlights();
      },
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.projectSwitching,
      () => {
        clearSearchHighlight(deps.getEditor());
        deps.clearCodeInspectorHighlights();
      },
    );
    deps.rpcNotifications.onNotification(
      EDITOR_RPC_NOTIFICATIONS.editCommand,
      handleEditCommandPayload,
    );
  }
}
