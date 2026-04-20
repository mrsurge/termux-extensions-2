import type {
  CoercePositiveIntFn,
  EditorOpenJumpPayload,
  EditorOpenPayload,
  EditorOpenTransaction,
  EditorOpenTransactionStore,
} from './editor_open_contract.ts';

export function createEditorOpenTransactionStore(): EditorOpenTransactionStore {
  return {
    activeOpenTransaction: null,
    openTransactionChain: Promise.resolve(),
  };
}

export function pruneOpenTransactionIfExpired(store: EditorOpenTransactionStore): void {
  try {
    if (!store.activeOpenTransaction) return;
    const now = Date.now();
    const guardUntil = Number(store.activeOpenTransaction.guardUntil || 0);
    const createdAt = Number(store.activeOpenTransaction.createdAt || 0);
    if (guardUntil > 0) {
      if (now > guardUntil) store.activeOpenTransaction = null;
      return;
    }
    if (createdAt > 0 && (now - createdAt) > 15000) {
      store.activeOpenTransaction = null;
    }
  } catch (_) {
    store.activeOpenTransaction = null;
  }
}

export function getOpenTransactionForPath(
  store: EditorOpenTransactionStore,
  path: string | null | undefined,
): EditorOpenTransaction | null {
  try {
    pruneOpenTransactionIfExpired(store);
    if (!store.activeOpenTransaction) return null;
    if (String(store.activeOpenTransaction.path || '') !== String(path || '')) return null;
    return store.activeOpenTransaction;
  } catch (_) {
    return null;
  }
}

export function beginOpenTransaction(
  store: EditorOpenTransactionStore,
  path: string | null | undefined,
  generation: number | null | undefined,
  payload: EditorOpenPayload | null | undefined,
  coerceInt: CoercePositiveIntFn,
): EditorOpenTransaction {
  const line = coerceInt(payload && (payload.line != null ? payload.line : payload.lineNo));
  const column = coerceInt(payload && (payload.column != null ? payload.column : payload.col));
  store.activeOpenTransaction = {
    path: String(path || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : null,
    line,
    column: column || 1,
    focus: payload && Object.prototype.hasOwnProperty.call(payload, 'focus') ? payload.focus : undefined,
    scroll_y: payload?.scroll_y,
    scroll_to_top: payload?.scroll_to_top,
    request_id: payload?.request_id ? String(payload.request_id) : '',
    hasExplicitNavigation: line != null,
    navigationApplied: false,
    createdAt: Date.now(),
    guardUntil: 0,
  };
  return store.activeOpenTransaction;
}

export function buildTransactionJumpPayload(
  tx: EditorOpenTransaction | null | undefined,
): EditorOpenJumpPayload | null {
  try {
    if (!tx || !tx.hasExplicitNavigation) return null;
    return {
      line: tx.line || 1,
      column: tx.column,
      focus: tx.focus,
      scroll_y: tx.scroll_y,
      scroll_to_top: tx.scroll_to_top,
    };
  } catch (_) {
    return null;
  }
}

export function buildScrollLineJumpPayload(
  scrollLine: unknown,
  coerceInt: CoercePositiveIntFn,
): EditorOpenJumpPayload | null {
  try {
    const line = coerceInt(scrollLine);
    if (line == null) return null;
    return {
      line,
      focus: false,
      scroll_to_top: true,
    };
  } catch (_) {
    return null;
  }
}

export function resolveOpenJumpPayload(
  store: EditorOpenTransactionStore,
  currentPath: string | null | undefined,
  tx: EditorOpenTransaction | null | undefined,
  scrollLine: unknown,
  sameFileNavigationOnly: boolean,
  coerceInt: CoercePositiveIntFn,
): EditorOpenJumpPayload | null {
  const explicitPayload = buildTransactionJumpPayload(tx);
  if (explicitPayload) return explicitPayload;
  if (sameFileNavigationOnly) return null;
  const guardTx = getOpenTransactionForPath(store, currentPath);
  if (guardTx && guardTx.hasExplicitNavigation) return null;
  return buildScrollLineJumpPayload(scrollLine, coerceInt);
}

export function settleOpenTransaction(
  store: EditorOpenTransactionStore,
  tx: EditorOpenTransaction | null | undefined,
): void {
  try {
    if (!tx || store.activeOpenTransaction !== tx) return;
    if (tx.hasExplicitNavigation) {
      tx.guardUntil = Math.max(Number(tx.guardUntil || 0), Date.now() + 5000);
      return;
    }
    store.activeOpenTransaction = null;
  } catch (_) {}
}

export function queueOpenTransaction(
  store: EditorOpenTransactionStore,
  taskFn: () => Promise<unknown>,
): Promise<unknown> {
  store.openTransactionChain = store.openTransactionChain.catch(function () {}).then(function () {
    return taskFn();
  });
  return store.openTransactionChain;
}
