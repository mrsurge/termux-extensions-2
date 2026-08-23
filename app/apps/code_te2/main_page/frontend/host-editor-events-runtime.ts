import {
  recordDiagnosticsOpenStage,
} from '../../src/diagnostics/latency-probe.ts';
import {
  acceptDocumentProjection,
  resetDocumentRevisionRuntime,
} from '../../monaco_editor/editor_document_revision_runtime.ts';
import { renderDiagnosticIssuePills } from './ui/diagnostic-issue-pills.ts';

export interface CacheIndicatorPayload {
  state?: unknown;
  unsaved?: unknown;
  reason?: unknown;
  restoredActive: boolean;
}

export interface HostEditorEventsRuntimeDeps {
  applyCacheIndicator: (info: CacheIndicatorPayload) => void;
  triggerExternalRefresh: (path: string) => void | Promise<void>;
  applyAutosavePreference: (autoSave: boolean) => void;
  setLastSha256: (sha: string) => void;
  getCurrentPath: () => string | null;
  getRestoredSessionActive: () => boolean;
  setRestoredSessionActive: (flag: boolean) => void;
  setRestoredSessionPath: (path: string) => void;
  issuesBadgesEl: HTMLElement;
  setIssuesButtonsEnabled: (enabled: boolean) => void;
  toast: (message: string, timeoutMs?: number) => void;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface HostEditorEventsRuntime {
  install: () => void;
  ensureEditorFrameReady: () => Promise<boolean>;
  awaitEditorOpen: (requestId: string, path?: string, timeoutMs?: number) => Promise<unknown>;
}

interface EditorOpenWaiter {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: number;
  path: string;
}

interface ScrollState {
  path: string | null;
  line: number;
  column: number | null;
  top: number | null;
}

interface HostEditorEventsWindow extends Window {
  __feLastScrollState?: ScrollState | null;
  __codeTe2CacheState?: unknown;
}

function hostWindow(): HostEditorEventsWindow {
  return window as HostEditorEventsWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function eventDetail(event: Event): unknown {
  return event instanceof CustomEvent ? event.detail : {};
}

function stringField(source: Record<string, unknown> | null | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
}

function boolField(source: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === 'boolean' ? value : null;
}

function shaField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length === 64 ? value : null;
}

function timeoutMs(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function openRequestId(payload: unknown): string {
  const p = isRecord(payload) ? payload : {};
  const rawRequestId = p.requestId || p.request_id;
  return rawRequestId ? String(rawRequestId) : '';
}

export function createHostEditorEventsRuntime(deps: HostEditorEventsRuntimeDeps): HostEditorEventsRuntime {
  let installed = false;
  let editorFrameReady = false;
  let editorFrameReadyResolver: ((ready: boolean) => void) | null = null;
  let editorFrameReadyPromise: Promise<boolean> | null = null;
  const editorOpenWaiters = new Map<string, EditorOpenWaiter>();
  const recentEditorOpenCompletions = new Map<string, unknown>();
  const warn = deps.warn || console.warn.bind(console);

  function ensureEditorFrameReady(): Promise<boolean> {
    if (editorFrameReady) return Promise.resolve(true);
    if (editorFrameReadyPromise) return editorFrameReadyPromise;
    editorFrameReadyPromise = new Promise((resolve) => {
      editorFrameReadyResolver = resolve;
    });
    return editorFrameReadyPromise;
  }

  function markEditorFrameReady(): void {
    if (editorFrameReady) return;
    editorFrameReady = true;
    const resolve = editorFrameReadyResolver;
    editorFrameReadyResolver = null;
    if (resolve) {
      try { resolve(true); } catch {}
    }
  }

  function rememberEditorOpenCompletion(requestId: string, payload: unknown): void {
    recentEditorOpenCompletions.set(requestId, payload);
    window.setTimeout(() => {
      recentEditorOpenCompletions.delete(requestId);
    }, 15000);
  }

  function resolveEditorOpenWaiter(payload: unknown): void {
    const requestId = openRequestId(payload);
    if (!requestId) return;
    const waiter = editorOpenWaiters.get(requestId);
    recordDiagnosticsOpenStage(requestId, 'host_open_complete_arrived', {
      waiterPresent: Boolean(waiter),
    });
    if (!waiter) {
      rememberEditorOpenCompletion(requestId, payload);
      return;
    }
    editorOpenWaiters.delete(requestId);
    try { clearTimeout(waiter.timer); } catch {}
    try { waiter.resolve(payload || {}); } catch {}
  }

  function awaitEditorOpen(requestId: string, path = '', openTimeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!requestId) {
        reject(new Error('Missing open request id'));
        return;
      }
      if (recentEditorOpenCompletions.has(requestId)) {
        const payload = recentEditorOpenCompletions.get(requestId);
        recentEditorOpenCompletions.delete(requestId);
        resolve(payload || {});
        return;
      }
      const timer = setTimeout(() => {
        editorOpenWaiters.delete(requestId);
        reject(new Error(`Editor open timed out for ${path || requestId}`));
      }, timeoutMs(openTimeoutMs, 10000));
      editorOpenWaiters.set(requestId, { resolve, reject, timer, path: path || '' });
    });
  }

  function applyEditorCacheState(data: unknown): void {
    if (!isRecord(data)) return;

    const normalizedPath = stringField(data, 'path') || null;
    const currentPath = deps.getCurrentPath();
    if (!normalizedPath || !currentPath || normalizedPath !== currentPath) return;
    if (!acceptDocumentProjection(normalizedPath, data.document_revision)) return;
    const contentSha = shaField(data, 'content_sha256');
    const baseSha = shaField(data, 'base_sha256');
    const state = stringField(data, 'state');
    const unsaved = boolField(data, 'unsaved');
    const reason = stringField(data, 'reason');
    const isCleanState = state === 'clean' || unsaved === false;

    if (baseSha) {
      deps.setLastSha256(baseSha);
    } else if (isCleanState && contentSha) {
      deps.setLastSha256(contentSha);
    }

    let restoredActive = deps.getRestoredSessionActive();
    if (reason === 'restore') {
      restoredActive = true;
      deps.setRestoredSessionActive(true);
    } else if (state === 'clean') {
      restoredActive = false;
      deps.setRestoredSessionActive(false);
    }

    if (reason === 'watcher_external' && normalizedPath) {
      void deps.triggerExternalRefresh(normalizedPath);
    }

    deps.applyCacheIndicator({
      state: data.state,
      unsaved: data.unsaved,
      reason: data.reason,
      restoredActive,
    });

    const autoSave = boolField(data, 'auto_save') ?? boolField(data, 'autoSave');
    if (typeof autoSave === 'boolean') {
      deps.applyAutosavePreference(autoSave);
    }

    if (normalizedPath) {
      window.dispatchEvent(new CustomEvent('code-te2:draft-updated', {
        detail: {
          path: normalizedPath,
          unsaved: unsaved === true,
          document_revision: data.document_revision,
        },
      }));
    }
    hostWindow().__codeTe2CacheState = data;
  }

  function handleEditorScrollState(payload: unknown): void {
    const data = isRecord(payload) ? payload : {};
    const line = typeof data.line === 'number' ? data.line : 0;
    if (line < 1) return;

    const win = hostWindow();
    win.__feLastScrollState = {
      path: typeof data.path === 'string' && data.path ? data.path : null,
      line,
      column: (typeof data.column === 'number' && data.column >= 0) ? data.column : null,
      top: (typeof data.top === 'number' && data.top >= 0) ? data.top : null,
    };
  }

  function applyDiagnosticsCounts(payload: unknown): void {
    try {
      const counts = renderDiagnosticIssuePills(deps.issuesBadgesEl, payload);
      deps.setIssuesButtonsEnabled(counts.total !== 0);
    } catch {}
  }

  function install(): void {
    if (installed) return;
    installed = true;
    window.addEventListener('code-te2:editor-ready', () => {
      markEditorFrameReady();
    });
    window.addEventListener('code-te2:editor-cache-state', (event) => {
      applyEditorCacheState(eventDetail(event));
    });
    window.addEventListener('code-te2:editor-open-complete', (event) => {
      resolveEditorOpenWaiter(eventDetail(event));
    });
    window.addEventListener('code-te2:editor-draft-state', (event) => {
      const p = isRecord(eventDetail(event)) ? eventDetail(event) as Record<string, unknown> : {};
      if (
        p.has_draft
        && typeof p.path === 'string'
        && p.path
        && p.path === deps.getCurrentPath()
        && acceptDocumentProjection(p.path, p.document_revision)
      ) {
        deps.setRestoredSessionActive(true);
        deps.setRestoredSessionPath(p.path);
      }
    });
    window.addEventListener('code-te2:project-switching', () => {
      resetDocumentRevisionRuntime();
    });
    window.addEventListener('code-te2:editor-scroll-state', (event) => {
      handleEditorScrollState(eventDetail(event));
    });
    window.addEventListener('code-te2:editor-notify', (event) => {
      const p = isRecord(eventDetail(event)) ? eventDetail(event) as Record<string, unknown> : {};
      const message = stringField(p, 'message') || null;
      if (message) deps.toast(message, timeoutMs(p.timeout, 3000));
    });
    window.addEventListener('code-te2:editor-diagnostics-counts', (event) => {
      applyDiagnosticsCounts(eventDetail(event));
    });
  }

  return {
    install,
    ensureEditorFrameReady,
    awaitEditorOpen,
  };
}
