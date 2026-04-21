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
  EditorMirrorPayload,
  EditorMirrorState,
  EditorSaveSnapshotRequestPayload,
  EditorSocketLike,
} from './editor_save_mirror_contract.ts';

interface SaveMirrorSocketHandlerDeps {
  getCurrentPath(): string | null;
  getModel(): unknown;
  getDiffEditor(): unknown;
  getGitHeadModel(): unknown;
  getBaseSha256(): string | null;
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

function handleEditorMirrorEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: EditorMirrorPayload | null | undefined,
): void {
  deps.incrementMirrorState('rx');
  if (!isMirrorPayloadValid(payload)) return;
  if (shouldDropMirrorForSource(payload, deps.getEditorSocketId())) {
    deps.incrementMirrorState('drop_self');
    deps.syncMirrorDebug();
    return;
  }
  if (shouldDropMirrorForPath(payload && payload.path, deps.getCurrentPath())) {
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
  if (shouldDropMirrorForSha(payload && payload.content_sha256, deps.getLastContentSha256(), model, payload && payload.content)) {
    deps.incrementMirrorState('drop_sha');
    deps.syncMirrorDebug();
    return;
  }
  if (shouldDropMirrorForHotWindow(deps.getLastLocalEditAt(), Date.now(), deps.getMirrorHotWindowMs())) {
    deps.incrementMirrorState('drop_hot');
    deps.syncMirrorDebug();
    return;
  }

  applyMirrorContentToModel(model, payload && payload.content, (value: boolean) => {
    deps.setApplyingRemote(!!value);
  });

  const contentSha = payload && typeof payload.content_sha256 === 'string'
    ? payload.content_sha256
    : null;
  if (contentSha) deps.setLastContentSha256(contentSha);

  deps.incrementMirrorState('ap');
  deps.syncMirrorDebug();
  deps.applyLineNumberSizing();

  const mirrorUnsaved = payload != null && payload.unsaved === true;
  deps.setUnsavedTrace('mirror', mirrorUnsaved);
  emitMirrorCacheState(deps.emitToHost, payload, mirrorUnsaved);
  if (mirrorUnsaved) {
    deps.requestDraftDiff('mirror');
    return;
  }
  deps.clearDraftDiffDecorations();
}

function handleEditorCacheStateEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: EditorCacheStatePayload | null | undefined,
): void {
  const currentPath = deps.getCurrentPath();
  if (!isCacheStatePayloadForCurrentPath(payload, currentPath)) return;

  if (isCacheStateClean(payload)) {
    handleCleanCacheState({
      payload: payload,
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

  if (isCacheStateUnsaved(payload)) {
    handleUnsavedCacheState(payload, deps.setUnsavedTrace, deps.requestDraftDiff);
  }
}

function handleEditorSaveSnapshotRequestEvent(
  deps: SaveMirrorSocketHandlerDeps,
  payload: EditorSaveSnapshotRequestPayload | null | undefined,
): void {
  handleSaveSnapshotRequest(
    payload,
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
  socket.on('editor:mirror', (payload: unknown) => {
    try {
      handleEditorMirrorEvent(deps, payload as EditorMirrorPayload | null | undefined);
    } catch (error) {
      console.warn('[Monaco] mirror apply failed', error);
    }
  });

  socket.on('editor:cache_state', (payload: unknown) => {
    try {
      handleEditorCacheStateEvent(deps, payload as EditorCacheStatePayload | null | undefined);
    } catch (_) {}
  });

  socket.on('editor:save_snapshot_request', (payload: unknown) => {
    try {
      handleEditorSaveSnapshotRequestEvent(
        deps,
        payload as EditorSaveSnapshotRequestPayload | null | undefined,
      );
    } catch (error) {
      console.warn('[Monaco] save snapshot response failed', error);
    }
  });
}
