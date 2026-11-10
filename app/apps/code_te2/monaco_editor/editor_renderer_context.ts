import { codeTe2SocketQuery, getCodeTe2SocketIdentity, normalizeCodeTe2SocketIdentity,
  type SocketClientIdentity } from '../src/rpc/socketio-topology.ts';

export interface EditorReadinessState {
  __te2AdapterReady?: boolean;
  __te2AdapterProject?: string | null;
  __te2ProjectSwitchInProgress?: boolean;
  __te2ProjectSwitchId?: string | null;
}

/** Immutable transport identity and mutable readiness belong to one renderer. */
export function createEditorRendererContext(input: SocketClientIdentity = getCodeTe2SocketIdentity()) {
  const identity = normalizeCodeTe2SocketIdentity(input);
  const readiness: EditorReadinessState = { __te2AdapterReady: false,
    __te2AdapterProject: null, __te2ProjectSwitchInProgress: false, __te2ProjectSwitchId: null };
  return { identity, readiness, socketQuery: () => codeTe2SocketQuery(identity) };
}
