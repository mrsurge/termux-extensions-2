import { EDITOR_RPC_NOTIFICATIONS } from './editor_rpc_contract.ts';
import { isMirrorPayloadValid } from './editor_mirror_payload_valid_utils.js';
import { shouldDropMirrorForSource } from './editor_mirror_source_drop_utils.js';
import { shouldDropMirrorForPath } from './editor_mirror_path_drop_utils.js';
import { shouldDropMirrorForNoModel } from './editor_mirror_model_drop_utils.js';
import { shouldDropMirrorForSha } from './editor_mirror_sha_drop_utils.js';
import { shouldDropMirrorForHotWindow } from './editor_mirror_hot_drop_utils.js';
import { applyMirrorContentToModel } from './editor_mirror_apply_content_utils.js';
import { emitMirrorCacheState } from './editor_mirror_emit_cache_utils.js';
import { handleSaveSnapshotRequest } from './editor_socket_save_snapshot_handler_utils.js';
import {
  isCacheStatePayloadForCurrentPath,
  isCacheStateClean,
  isCacheStateUnsaved,
} from './editor_cache_state_payload_utils.js';
import { handleCleanCacheState } from './editor_cache_state_clean_handler_utils.js';
import { handleUnsavedCacheState } from './editor_cache_state_unsaved_handler_utils.js';
import type {
  EditorCacheStatePayload,
  EditorMirrorState,
  EditorSaveSnapshotRequestPayload,
  EditorSocketLike,
} from './editor_save_mirror_contract.ts';
import type { DraftDiffPayloadLike } from './editor_socket_draft_diff_handler_utils.ts';

interface EditorRpcNotificationSource {
  onNotification(method: string, handler: (payload: Record<string, unknown>) => void): () => void;
}

interface MonacoModelLike {
  getValue?(): string;
  getFullModelRange?(): unknown;
  applyEdits?(edits: Array<{ range: unknown; text: string }>): void;
}

interface EditorMirrorPayloadLike {
  path?: unknown;
  content?: unknown;
  base_sha256?: unknown;
  content_sha256?: unknown;
  unsaved?: unknown;
  source_client?: unknown;
}

interface SaveMirrorSocketHandlerDeps {
  rpcNotifications?: EditorRpcNotificationSource | null;
  getCurrentPath(): string | null;
  getModel(): unknown;
  getDiffEditor(): unknown;
  getGitHeadModel(): unknown;
  getBaseSha256(): string | null;
  setBaseSha256(value: string | null): void;
  getLastContentSha256(): string | null;
  setLastContentSha256(value: string | null): void;
  getLastLocalEditAt(): number;
  getMirrorHotWindowMs(): number;
  getEditorSocketId(): string | null;
  getMonaco(): unknown;
  setApplyingRemote(value: boolean): void;
  applyLineNumberSizing(): void;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  setUnsavedTrace(reason: string, unsaved: boolean): void;
  requestDraftDiff(reason: string): void;
  clearDraftDiffDecorations(): void;
  getAutoSave(): boolean;
  shouldSkipAutosave(diffEditor: unknown, gitHeadModel: unknown, model: unknown): boolean;
  requestGitBaselines(payload: { immediate?: boolean; reason: string }): void;
  resnapshotDraftBaseline(diffEditor: unknown, monacoRef: unknown, model: unknown): void;
  incrementMirrorState(metric: keyof EditorMirrorState): void;
  syncMirrorDebug(): void;
}

function asMirrorPayload(value: unknown): EditorMirrorPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorMirrorPayloadLike
    : null;
}

function asCacheStatePayload(value: unknown): EditorCacheStatePayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorCacheStatePayload
    : null;
}

function asSaveSnapshotRequestPayload(value: unknown): EditorSaveSnapshotRequestPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorSaveSnapshotRequestPayload
    : null;
}

function handleEditorMirrorEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: unknown,
): void {
  const mirrorPayload = asMirrorPayload(payload);
  deps.incrementMirrorState('rx');
  if (!isMirrorPayloadValid(mirrorPayload)) return;
  if (shouldDropMirrorForSource(mirrorPayload, deps.getEditorSocketId())) {
    deps.incrementMirrorState('drop_self');
    deps.syncMirrorDebug();
    return;
  }
  if (shouldDropMirrorForPath(mirrorPayload?.path, deps.getCurrentPath())) {
    deps.incrementMirrorState('drop_path');
    deps.syncMirrorDebug();
    return;
  }

  const model = deps.getModel();
  if (shouldDropMirrorForNoModel(model)) {
    deps.incrementMirrorState('drop_no_model');
    deps.syncMirrorDebug();
    return;
  }
  if (shouldDropMirrorForSha(mirrorPayload?.content_sha256, deps.getLastContentSha256(), model, mirrorPayload?.content)) {
    deps.incrementMirrorState('drop_sha');
    deps.syncMirrorDebug();
    return;
  }
  if (shouldDropMirrorForHotWindow(deps.getLastLocalEditAt(), Date.now(), deps.getMirrorHotWindowMs())) {
    deps.incrementMirrorState('drop_hot');
    deps.syncMirrorDebug();
    return;
  }

  applyMirrorContentToModel(model as MonacoModelLike, mirrorPayload?.content, (value: boolean) => {
    deps.setApplyingRemote(!!value);
  });

  const contentSha = typeof mirrorPayload?.content_sha256 === 'string'
    ? mirrorPayload.content_sha256
    : null;
  if (contentSha) deps.setLastContentSha256(contentSha);

  deps.incrementMirrorState('ap');
  deps.syncMirrorDebug();
  deps.applyLineNumberSizing();

  const mirrorUnsaved = mirrorPayload?.unsaved === true;
  deps.setUnsavedTrace('mirror', mirrorUnsaved);
  emitMirrorCacheState(deps.emitToHost, mirrorPayload as DraftDiffPayloadLike & { content_sha256?: unknown }, mirrorUnsaved);
  if (mirrorUnsaved) {
    deps.requestDraftDiff('mirror');
    return;
  }
  deps.clearDraftDiffDecorations();
}

function handleEditorCacheStateEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: unknown,
): void {
  const cacheStatePayload = asCacheStatePayload(payload);
  const currentPath = deps.getCurrentPath();
  if (!isCacheStatePayloadForCurrentPath(cacheStatePayload, currentPath)) return;
  const baseSha = typeof cacheStatePayload?.base_sha256 === 'string' && cacheStatePayload.base_sha256.length === 64
    ? cacheStatePayload.base_sha256
    : null;
  const contentSha = typeof cacheStatePayload?.content_sha256 === 'string' && cacheStatePayload.content_sha256.length === 64
    ? cacheStatePayload.content_sha256
    : null;
  if (baseSha) {
    deps.setBaseSha256(baseSha);
  } else if (cacheStatePayload?.unsaved === false && contentSha) {
    deps.setBaseSha256(contentSha);
  }
  if (contentSha) deps.setLastContentSha256(contentSha);

  if (isCacheStateClean(cacheStatePayload)) {
    handleCleanCacheState({
      payload: cacheStatePayload,
      clearDraftDiffDecorationsFn: deps.clearDraftDiffDecorations,
      getAutoSaveFn: deps.getAutoSave,
      shouldSkipAutosaveFn: deps.shouldSkipAutosave,
      diffEditor: deps.getDiffEditor(),
      gitHeadModel: deps.getGitHeadModel(),
      model: deps.getModel(),
      requestGitBaselinesFn: deps.requestGitBaselines,
      resnapshotDraftBaselineFn: deps.resnapshotDraftBaseline,
      monacoRef: deps.getMonaco(),
      setUnsavedTraceFn: deps.setUnsavedTrace,
    });
    return;
  }

  if (isCacheStateUnsaved(cacheStatePayload)) {
    handleUnsavedCacheState(cacheStatePayload, deps.setUnsavedTrace, deps.requestDraftDiff);
  }
}

function handleEditorSaveSnapshotRequestEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: unknown,
): void {
  handleSaveSnapshotRequest(
    asSaveSnapshotRequestPayload(payload),
    deps.getCurrentPath(),
    deps.getModel(),
    deps.getBaseSha256(),
    deps.emitToHost,
  );
}

export function registerEditorSaveMirrorSocketHandlers(
  socket: EditorSocketLike,
  deps: SaveMirrorSocketHandlerDeps,
): void {
  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.mirrorUpdated, (payload) => {
      try {
        handleEditorMirrorEvent(deps, payload);
      } catch (error) {
        console.warn('[Monaco] mirror apply failed', error);
      }
    });

    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.cacheState, (payload) => {
      try {
        handleEditorCacheStateEvent(deps, payload);
      } catch (_) {}
    });
  } else {
    socket.on('editor:mirror', (payload: unknown) => {
      try {
        handleEditorMirrorEvent(deps, payload);
      } catch (error) {
        console.warn('[Monaco] mirror apply failed', error);
      }
    });

    socket.on('editor:cache_state', (payload: unknown) => {
      try {
        handleEditorCacheStateEvent(deps, payload);
      } catch (_) {}
    });
  }

  socket.on('editor:save_snapshot_request', (payload: unknown) => {
    try {
      handleEditorSaveSnapshotRequestEvent(deps, payload);
    } catch (error) {
      console.warn('[Monaco] save snapshot response failed', error);
    }
  });
}
