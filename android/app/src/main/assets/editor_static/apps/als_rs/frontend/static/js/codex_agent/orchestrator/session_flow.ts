import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import { createSettingsRpcClient } from '../rpc/settings/client.ts';
import type { JsonObject } from '../rpc/conversations/contract.ts';

interface SessionConversationMeta {
  conversation_id?: string | null;
}

interface SessionFlowState {
  initialized?: boolean;
  rpcTransportEnabled?: boolean;
  autoScroll?: boolean;
  transcriptHistoryMode?: boolean;
  clientConversationId?: string | null;
  conversationMeta?: SessionConversationMeta | null;
}

interface ShellBatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ShellExecResponse extends JsonObject {
  error?: string;
  callId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

interface ShellRowLookup {
  has(callId: string): boolean;
}

interface SessionFlowContext {
  getState: () => SessionFlowState;
  setState: (patch: Partial<SessionFlowState>) => void;
  sioCall: (event: string, payload?: JsonObject, options?: JsonObject) => Promise<unknown>;
  waitForWs: () => Promise<boolean>;
  conversationsRpcClient?: ReturnType<typeof createConversationsRpcClient> | null;
  settingsRpcClient?: Pick<ReturnType<typeof createSettingsRpcClient>, 'getExtensionSessionState'>;
  setActivity: (label: string, active: boolean) => void;
  updateScrollButton: () => void;
  maybeAutoScroll: (force?: boolean) => void;
  renderShellBatchResult: (result: ShellBatchResult) => void;
  setStatusDot: (status: string) => void;
  shellRows: ShellRowLookup;
  snapTranscriptToLive?: () => Promise<void>;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function scopedConversationId(state: SessionFlowState): string | null {
  const clientConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
    ? state.clientConversationId.trim()
    : null;
  const metaConversationId = typeof state.conversationMeta?.conversation_id === 'string' && state.conversationMeta.conversation_id.trim()
    ? state.conversationMeta.conversation_id.trim()
    : null;
  return clientConversationId || metaConversationId;
}

function normalizeShellExecResponse(value: unknown): ShellExecResponse {
  return asObject(value) ?? {};
}

export function bindSessionFlow(ctx: SessionFlowContext) {
  const {
    getState,
    setState,
    sioCall,
    waitForWs,
    conversationsRpcClient,
    settingsRpcClient,
    setActivity,
    updateScrollButton,
    maybeAutoScroll,
    renderShellBatchResult,
    setStatusDot,
    shellRows,
    snapTranscriptToLive,
  } = ctx;
  const activeConversationsRpcClient = conversationsRpcClient ?? createConversationsRpcClient({});
  const sessionStateClient = settingsRpcClient ?? createSettingsRpcClient({ sioCall });

  async function ensureInitialized() {
    const state = getState();
    if (state.initialized) return;
    if (state.rpcTransportEnabled) {
      setState({ initialized: true });
      return;
    }
    await waitForWs();
    setState({ initialized: true });
  }

  async function sendUserMessage(text: string) {
    if (!text) return;
    const state = getState();
    const convoId = scopedConversationId(state);
    if (!convoId) {
      setActivity('save settings first', true);
      return;
    }
    if (typeof snapTranscriptToLive === 'function') {
      await snapTranscriptToLive();
    }
    setState({ autoScroll: true });
    updateScrollButton();
    maybeAutoScroll(true);
    setActivity('sending', true);
    let loadingSession = false;
    try {
      await ensureInitialized();
      try {
        const session = await sessionStateClient.getExtensionSessionState({
          conversationId: convoId,
          timeoutMs: 3000,
        });
        loadingSession = session.ok !== false && session.supported === true
          && session.loaded !== true && (session.state === 'cold' || session.state === 'unbound');
      } catch {
        // Session inspection is optional; an unavailable probe must not block send.
      }
      if (loadingSession && scopedConversationId(getState()) === convoId) {
        setActivity('Loading session', true);
      }
      const result = await activeConversationsRpcClient.sendMessage({
        conversationId: convoId,
        text,
        timeoutMs: loadingSession ? 120000 : 10000,
      });
      if (result?.accepted === false || result?.ok === false) {
        console.error('sendUserMessage failed:', result?.error);
        if (scopedConversationId(getState()) === convoId) setActivity(result?.error || 'send failed', true);
      }
    } catch (error: unknown) {
      let message = error instanceof Error ? error.message : String(error || 'send failed');
      if (loadingSession && message === 'Timed out waiting for conversation.send') {
        message = 'Session loading timed out after 2 minutes';
      }
      console.error('sendUserMessage failed:', error);
      if (scopedConversationId(getState()) === convoId) {
        setStatusDot('error');
        setActivity(message, true);
      }
    }
  }

  async function sendShellCommand(command: string) {
    if (!command) return;
    command = String(command)
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!command) return;
    const state = getState();
    const convoId = scopedConversationId(state);
    if (!convoId) {
      setActivity('save settings first', true);
      return;
    }
    try {
      const resp = normalizeShellExecResponse(await activeConversationsRpcClient.executeShellCommand({
        conversationId: convoId,
        command,
      }));
      const callId = typeof resp.callId === 'string' ? resp.callId : null;
      if (resp.error && (!callId || !shellRows.has(callId))) {
        renderShellBatchResult({
          exitCode: resp.exitCode || 1,
          stdout: resp.stdout || '',
          stderr: resp.stderr || resp.error,
        });
      }
    } catch (err: unknown) {
      renderShellBatchResult({
        exitCode: 1,
        stdout: '',
        stderr: String(err),
      });
      setStatusDot('error');
      setActivity('idle', false);
    }
  }

  async function interruptTurn() {
    try {
      setActivity('interrupt', true);
      const state = getState();
      const convoId = scopedConversationId(state);
      const result = await activeConversationsRpcClient.interruptConversation({ conversationId: convoId });
      if (result?.ok === false) {
        throw new Error(String(result?.error || 'interrupt failed'));
      }
      setActivity('interrupt sent', true);
    } catch (err: unknown) {
      console.warn('interrupt failed', err);
      setActivity('interrupt failed', true);
    }
  }

  return {
    ensureInitialized,
    sendUserMessage,
    sendShellCommand,
    interruptTurn,
  };
}
