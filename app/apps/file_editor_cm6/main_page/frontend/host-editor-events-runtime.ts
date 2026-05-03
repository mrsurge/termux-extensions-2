type JsonObject = Record<string, unknown>;

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
  getRestoredSessionActive: () => boolean;
  setRestoredSessionActive: (flag: boolean) => void;
  setRestoredSessionPath: (path: string) => void;
  getCurrentPath: () => string;
  queueSessionStateUpdate: (partial: { scrollLine: number; scrollTop: number | null }) => void;
  apiPost: (path: string, body?: JsonObject) => Promise<unknown>;
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
  __feScrollStateTimer?: number | null;
  __feCursorStateDebounceMs?: number;
  __cm6CacheState?: unknown;
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

function numberOrZero(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
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
      window.dispatchEvent(new CustomEvent('cm6:draft-updated', {
        detail: {
          path: normalizedPath,
          unsaved: unsaved === true,
        },
      }));
    }
    hostWindow().__cm6CacheState = data;
  }

  function handleEditorScrollState(payload: unknown): void {
    const data = isRecord(payload) ? payload : {};
    const line = typeof data.line === 'number' ? data.line : 0;
    if (line < 1) return;

    const win = hostWindow();
    win.__feLastScrollState = {
      path: deps.getCurrentPath() || null,
      line,
      column: (typeof data.column === 'number' && data.column >= 0) ? data.column : null,
      top: (typeof data.top === 'number' && data.top >= 0) ? data.top : null,
    };

    if (win.__feScrollStateTimer) clearTimeout(win.__feScrollStateTimer);
    win.__feScrollStateTimer = setTimeout(async () => {
      win.__feScrollStateTimer = null;
      const lastScrollState = win.__feLastScrollState || null;
      if (!lastScrollState || !lastScrollState.path) return;
      try {
        try {
          deps.queueSessionStateUpdate({
            scrollLine: lastScrollState.line,
            scrollTop: lastScrollState.top != null ? lastScrollState.top : null,
          });
        } catch {}

        if (lastScrollState.line && lastScrollState.line > 0) {
          await deps.apiPost('state/file_scroll', {
            path: lastScrollState.path,
            scroll_line: lastScrollState.line,
          });
        }
      } catch (err) {
        warn('Failed to persist scroll state:', err);
      }
    }, typeof win.__feCursorStateDebounceMs === 'number' ? win.__feCursorStateDebounceMs : 1000);
  }

  function applyDiagnosticsCounts(payload: unknown): void {
    try {
      const p = isRecord(payload) ? payload : {};
      const errors = numberOrZero(p.errors);
      const warnings = numberOrZero(p.warnings);
      const hints = numberOrZero(p.hints);
      const total = errors + warnings + hints;
      const el = deps.issuesBadgesEl;
      el.innerHTML = '';
      if (errors > 0) {
        const d = document.createElement('span');
        d.className = 'fe-issues-dot error';
        d.textContent = String(errors);
        d.title = `${errors} error${errors !== 1 ? 's' : ''}`;
        el.appendChild(d);
      }
      if (warnings > 0) {
        const d = document.createElement('span');
        d.className = 'fe-issues-dot warning';
        d.textContent = String(warnings);
        d.title = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
        el.appendChild(d);
      }
      deps.setIssuesButtonsEnabled(total !== 0);
    } catch {}
  }

  function install(): void {
    if (installed) return;
    installed = true;
    window.addEventListener('cm6:editor-ready', () => {
      markEditorFrameReady();
    });
    window.addEventListener('cm6:editor-cache-state', (event) => {
      applyEditorCacheState(eventDetail(event));
    });
    window.addEventListener('cm6:editor-open-complete', (event) => {
      resolveEditorOpenWaiter(eventDetail(event));
    });
    window.addEventListener('cm6:editor-draft-state', (event) => {
      const p = isRecord(eventDetail(event)) ? eventDetail(event) as Record<string, unknown> : {};
      if (p.has_draft && typeof p.path === 'string' && p.path) {
        deps.setRestoredSessionActive(true);
        deps.setRestoredSessionPath(p.path);
      }
    });
    window.addEventListener('cm6:editor-scroll-state', (event) => {
      handleEditorScrollState(eventDetail(event));
    });
    window.addEventListener('cm6:editor-notify', (event) => {
      const p = isRecord(eventDetail(event)) ? eventDetail(event) as Record<string, unknown> : {};
      const message = stringField(p, 'message') || null;
      if (message) deps.toast(message, timeoutMs(p.timeout, 3000));
    });
    window.addEventListener('cm6:editor-diagnostics-counts', (event) => {
      applyDiagnosticsCounts(eventDetail(event));
    });
  }

  return {
    install,
    ensureEditorFrameReady,
    awaitEditorOpen,
  };
}
