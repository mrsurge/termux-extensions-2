import { RPC_NAMESPACES } from '../namespaces.ts';

export type JsonObject = Record<string, unknown>;
export type ConversationsRpcTransport = 'rpc' | 'stream' | 'legacy';

export const CONVERSATIONS_RPC_NAMESPACE = RPC_NAMESPACES.conversations;
export const CONVERSATIONS_RPC_IMPLEMENTATION_STATUS = 'implemented' as const;

export const CONVERSATIONS_RPC_METHODS = {
  get: 'conversation.get',
  list: 'conversation.list',
  create: 'conversation.create',
  select: 'conversation.select',
  update: 'conversation.update',
  delete: 'conversation.delete',
  fork: 'conversation.fork',
  pinsSet: 'conversation.pins.set',
  draftSet: 'conversation.draft.set',
  draftAuthorClaim: 'conversation.draft.author.claim',
  draftSelectionSet: 'conversation.draft.selection.set',
  send: 'conversation.send',
  interrupt: 'conversation.interrupt',
  compact: 'conversation.compact',
  replayGetChunk: 'conversation.replay.getChunk',
  approvalRespond: 'conversation.approval.respond',
  shellExec: 'conversation.shell.exec',
  shellOutputWindow: 'conversation.shell.output.window',
} as const;

export type ConversationsRpcMethod =
  typeof CONVERSATIONS_RPC_METHODS[keyof typeof CONVERSATIONS_RPC_METHODS];

export const CONVERSATIONS_RPC_ANCHOR_MODULES = [
  'conversation/runtime.ts',
  'conversation_drawer/actions.ts',
  'orchestrator/session_flow.js',
  'transcript_loader.js',
] as const;

export interface ConversationMetaRecord extends JsonObject {
  conversation_id?: string | null;
  active_view?: string | null;
  settings?: JsonObject;
  integrity?: string;
  integrity_error?: string;
}

export interface ComposerSelectionState extends JsonObject {
  anchor: number;
  focus: number;
}

export interface ConversationListResult extends JsonObject {
  items: ConversationMetaRecord[];
  active_conversation_id: string | null;
  active_view: string | null;
  pinned_conversations?: string[];
  revision?: number;
  reason?: string;
  changed_conversation_id?: string;
  deleted_conversation_id?: string;
  transport: ConversationsRpcTransport;
}

export interface ConversationMetaResult extends ConversationMetaRecord {
  transport: ConversationsRpcTransport;
}

export interface ReplayChunkCursor {
  offset: number;
}

export interface ReplayChunkFrame {
  format: 'jsonl';
  offset: number;
  item_count: number;
  total_count: number;
  chunk_index: number;
  complete: boolean;
  next_cursor: ReplayChunkCursor | null;
  jsonl: string;
}

export interface TranscriptCardProjectionFrame {
  format: 'card_recipes';
  card_count: number;
  raw_event_count: number;
  raw_total_count: number;
  complete: boolean;
}

export type TranscriptProjectionAction = 'tail' | 'older' | 'newer' | 'current';

export interface TranscriptProjectionState {
  unit: 'transcript_card';
  start_card: number;
  end_card: number;
  total_cards: number;
  window_cards: number;
  shift_cards: number;
  card_count: number;
  at_start: boolean;
  at_tail: boolean;
  revision: number;
}

export interface TranscriptCardRecipe {
  card_id: string;
  card_index: number;
  version: number;
  family: string;
  scope: 'durable';
  parent_card_id?: string;
  events: JsonObject[];
}

export interface TurnProjectionItemSnapshot {
  key: string;
  card_id: string;
  family: string;
  scope: 'active';
  source_id: string;
  turn_id?: string;
  subagent_id?: string;
  parent_card_id?: string;
  sequence: number;
  events: JsonObject[];
}

export interface TurnProjectionSnapshot {
  generation: number;
  revision: number;
  turn_id?: string;
  items: TurnProjectionItemSnapshot[];
  truncated: boolean;
}

export interface TurnProjectionChange extends JsonObject {
  conversation_id: string;
  generation: number;
  revision: number;
  turn_id?: string;
  item_count: number;
  reason: string;
  truncated: boolean;
}

export const CONVERSATIONS_RPC_PROJECTION_NOTIFICATION_METHOD = 'conversation.projection.updated' as const;

export interface ReplayChunkResult {
  conversation_id: string | null;
  replay_id: string;
  projection: TranscriptProjectionState | null;
  live_projection: TurnProjectionSnapshot;
  frame: ReplayChunkFrame | TranscriptCardProjectionFrame;
  items: JsonObject[];
  cards: TranscriptCardRecipe[];
  runtime_state: JsonObject[];
  transport: ConversationsRpcTransport;
}

export interface ConversationSendResult extends JsonObject {
  conversation_id: string | null;
  accepted: boolean;
  transport: ConversationsRpcTransport;
  ok?: boolean;
  error?: string;
  restore_draft?: boolean;
  draft_restored?: boolean;
  surface_error?: boolean;
  error_source?: string;
  error_type?: string;
  failure_kind?: string;
  status_code?: number;
  provider_call_id?: string;
  details?: string;
  stack?: string;
  turn_id?: string;
  code?: unknown;
}

export interface ConversationDraftResult extends JsonObject {
  conversation_id: string | null;
  status?: string;
  draft_hash?: string;
  transport: ConversationsRpcTransport;
  ok?: boolean;
  error?: string;
  draft_revision?: number;
  selection_revision?: number;
  client_sequence?: number;
  author_epoch?: number;
  author_client_id?: string;
  draft_selection?: ComposerSelectionState;
  origin_client_id?: string;
}

export interface ConversationControlResult extends JsonObject {
  transport: ConversationsRpcTransport;
  ok?: boolean;
  error?: string;
  conversation_id?: string;
  thread_id?: string | null;
  turn_id?: string | null;
}

export interface ConversationForkResult extends ConversationMetaResult {
  ok?: boolean;
  source_conversation_id?: string;
  fork_result?: JsonObject;
}

export const CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE = {
  activity: 'conversation.activity',
  approval: 'conversation.approval.request',
  approval_handoff: 'conversation.approval.handoff',
  approval_invalidated: 'conversation.approval.invalidated',
  assistant_delta: 'conversation.message.delta',
  assistant_end: 'conversation.message.final',
  assistant_finalize: 'conversation.message.final',
  command_result: 'conversation.command.result',
  context_compacted: 'conversation.context.compacted',
  diff: 'conversation.diff',
  diff_declined: 'conversation.diff.declined',
  draft_update: 'conversation.draft.updated',
  draft_selection_update: 'conversation.draft.selection.updated',
  error: 'conversation.error',
  import_started: 'conversation.import.started',
  import_progress: 'conversation.import.progress',
  import_completed: 'conversation.import.completed',
  import_failed: 'conversation.import.failed',
  list_updated: 'conversation.list.updated',
  mention_insert: 'conversation.mention.inserted',
  message: 'conversation.user.message',
  meta_updated: 'conversation.meta.updated',
  mode: 'conversation.mode.changed',
  plan: 'conversation.plan',
  plan_state: 'conversation.plan.state',
  plan_update: 'conversation.plan.update',
  preview_updated: 'conversation.preview.updated',
  reasoning_delta: 'conversation.reasoning.delta',
  reasoning_end: 'conversation.reasoning.final',
  reasoning_finalize: 'conversation.reasoning.final',
  shell_begin: 'conversation.command.begin',
  shell_delta: 'conversation.command.delta',
  shell_end: 'conversation.command.end',
  status: 'conversation.status',
  subagent_end: 'conversation.subagent.end',
  subagent_start: 'conversation.subagent.start',
  thought: 'conversation.thought',
  token_count: 'conversation.token.updated',
  tool_interaction: 'conversation.tool.interaction',
  tool_begin: 'conversation.tool.begin',
  tool_delta: 'conversation.tool.delta',
  tool_end: 'conversation.tool.end',
  search: 'conversation.search',
  view: 'conversation.view',
  warning: 'conversation.warning',
} as const;

export type ConversationsRpcEventType =
  keyof typeof CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE;

export type ConversationsRpcNotificationMethod =
  typeof CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE[ConversationsRpcEventType];

export const CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD = {
  'conversation.activity': 'activity',
  'conversation.approval.handoff': 'approval_handoff',
  'conversation.approval.invalidated': 'approval_invalidated',
  'conversation.approval.request': 'approval',
  'conversation.command.begin': 'shell_begin',
  'conversation.command.delta': 'shell_delta',
  'conversation.command.end': 'shell_end',
  'conversation.command.result': 'command_result',
  'conversation.context.compacted': 'context_compacted',
  'conversation.diff': 'diff',
  'conversation.diff.declined': 'diff_declined',
  'conversation.draft.updated': 'draft_update',
  'conversation.draft.selection.updated': 'draft_selection_update',
  'conversation.error': 'error',
  'conversation.import.started': 'import_started',
  'conversation.import.progress': 'import_progress',
  'conversation.import.completed': 'import_completed',
  'conversation.import.failed': 'import_failed',
  'conversation.list.updated': 'list_updated',
  'conversation.mention.inserted': 'mention_insert',
  'conversation.message.delta': 'assistant_delta',
  'conversation.message.final': 'assistant_finalize',
  'conversation.meta.updated': 'meta_updated',
  'conversation.mode.changed': 'mode',
  'conversation.plan': 'plan',
  'conversation.plan.state': 'plan_state',
  'conversation.plan.update': 'plan_update',
  'conversation.preview.updated': 'preview_updated',
  'conversation.reasoning.delta': 'reasoning_delta',
  'conversation.reasoning.final': 'reasoning_finalize',
  'conversation.status': 'status',
  'conversation.subagent.end': 'subagent_end',
  'conversation.subagent.start': 'subagent_start',
  'conversation.thought': 'thought',
  'conversation.token.updated': 'token_count',
  'conversation.tool.interaction': 'tool_interaction',
  'conversation.tool.begin': 'tool_begin',
  'conversation.tool.delta': 'tool_delta',
  'conversation.tool.end': 'tool_end',
  'conversation.search': 'search',
  'conversation.user.message': 'message',
  'conversation.view': 'view',
  'conversation.warning': 'warning',
} as const;

export type ConversationsRpcCanonicalEventType =
  typeof CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD[ConversationsRpcNotificationMethod];

export const CONVERSATIONS_RPC_NOTIFICATION_METHODS = Object.keys(
  CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD,
) as ConversationsRpcNotificationMethod[];

export interface ConversationsLiveEvent extends JsonObject {
  type?: ConversationsRpcCanonicalEventType;
  conversation_id?: string;
}

export interface RpcMethodDescriptor<Name extends string = string> {
  name: Name;
  namespace: typeof CONVERSATIONS_RPC_NAMESPACE;
  status: typeof CONVERSATIONS_RPC_IMPLEMENTATION_STATUS;
}

export const CONVERSATIONS_RPC_METHOD_DESCRIPTORS: readonly RpcMethodDescriptor<ConversationsRpcMethod>[] = [
  {
    name: CONVERSATIONS_RPC_METHODS.get,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.list,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.create,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.select,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.update,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.delete,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.fork,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.pinsSet,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.draftSet,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.send,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.interrupt,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.compact,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.replayGetChunk,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.approvalRespond,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.shellExec,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
  {
    name: CONVERSATIONS_RPC_METHODS.shellOutputWindow,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  },
];
