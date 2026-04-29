import { handleDraftDiffEvent } from './editor_socket_draft_diff_handler_utils.js';
import { handleIssuesDumpRequest } from './editor_socket_issues_dump_handler_utils.js';
import { handleIssuesCommand } from './editor_socket_issues_cmd_handler_utils.js';
import { handleFindCommand } from './editor_socket_find_cmd_handler_utils.js';

interface EditorSocketLike {
  on(eventName: string, handler: (payload: unknown) => void): void;
}

interface EditorRuntimeSocketHandlerDeps {
  getCurrentPath(): string | null;
  getDraftDiffRequestId(): string | null;
  applyDraftDiffDecorations(payload: unknown): void;
  getMonaco(): unknown;
  getModel(): unknown;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  getEditor(): unknown;
  runIssuesCommand(editor: unknown, action: string): void;
  runFindCommand(editor: unknown, action: string, onError: (error: unknown) => void): void;
}

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
