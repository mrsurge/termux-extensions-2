import { setUnsavedTrace, noteGitBaselineRequest } from './editor_trace_utils.ts';
import { setDebugPart, syncTraceDebug as syncTraceDebugState, syncMirrorDebug as syncMirrorDebugState } from './editor_debug_utils.ts';
import { buildDebugMessage } from './editor_debug_message_utils.ts';

interface EditorDebugRuntimeDeps {
  getDocument(): Document;
  getEditor(): unknown;
}

export function createEditorDebugRuntime(deps: EditorDebugRuntimeDeps) {
  let debugElement: HTMLElement | null = null;
  const debugParts = { git: null, draft: null, diag: null, flags: null, mirror: null, trace: null, extra: null };
  const mirrorState = {
    rx: 0,
    ap: 0,
    drop_self: 0,
    drop_path: 0,
    drop_no_model: 0,
    drop_sha: 0,
    drop_hot: 0,
  };
  const trace = {
    mirror_bind_total: 0,
    mirror_active: 0,
    unsaved_reason: '-',
    gb_req_total: 0,
    gb_req_immediate: 0,
    gb_req_debounced: 0,
    gb_last_source: '-',
  };

  function updateDebug(extra?: string | null) {
    try {
      if (!debugElement) debugElement = deps.getDocument().getElementById('fh-debug');
      if (!debugElement) return;
      debugElement.textContent = buildDebugMessage(debugElement, deps.getEditor(), debugParts, extra || '');
    } catch (_) {}
  }

  function setDebugGit(value: string) {
    setDebugPart(debugParts, 'git', value, updateDebug);
  }

  function setDebugDraft(value: string) {
    setDebugPart(debugParts, 'draft', value, updateDebug);
  }

  function setDebugDiag(value: string) {
    setDebugPart(debugParts, 'diag', value, updateDebug);
  }

  function setDebugFlags(value: string) {
    setDebugPart(debugParts, 'flags', value, updateDebug);
  }

  function setDebugMirror(value: string) {
    setDebugPart(debugParts, 'mirror', value, updateDebug);
  }

  function setDebugTrace(value: string) {
    setDebugPart(debugParts, 'trace', value, updateDebug);
  }

  function syncTraceDebug() {
    syncTraceDebugState(trace, setDebugTrace);
  }

  function syncMirrorDebug() {
    syncMirrorDebugState(mirrorState, setDebugMirror);
  }

  function setUnsavedTraceRuntime(reason: string, unsaved: boolean) {
    setUnsavedTrace(trace, reason, unsaved, syncTraceDebug);
  }

  function noteGitBaselineRequestRuntime(source: string, immediate: boolean) {
    noteGitBaselineRequest(trace, source, immediate, syncTraceDebug);
  }

  function incrementMirrorState(metric: string) {
    if (!Object.prototype.hasOwnProperty.call(mirrorState, metric)) return;
    const key = metric as keyof typeof mirrorState;
    mirrorState[key] += 1;
  }

  function setMirrorActive(value: number) {
    trace.mirror_active = value;
    syncTraceDebug();
  }

  function incrementMirrorBindTotal() {
    trace.mirror_bind_total += 1;
    syncTraceDebug();
  }

  return {
    updateDebug,
    setDebugGit,
    setDebugDraft,
    setDebugDiag,
    setDebugFlags,
    setDebugMirror,
    setDebugTrace,
    syncTraceDebug,
    syncMirrorDebug,
    setUnsavedTrace: setUnsavedTraceRuntime,
    noteGitBaselineRequest: noteGitBaselineRequestRuntime,
    incrementMirrorState,
    setMirrorActive,
    incrementMirrorBindTotal,
    getTrace() { return trace; },
    getMirrorState() { return mirrorState; },
    getDebugParts() { return debugParts; },
  };
}
