type RecoveryReason = 'control' | 'resume' | 'stream' | 'resync';

interface RecoveryOptions {
  windowRef: Window;
  documentRef: Document;
  getKey(): string | null;
  refresh(reconnectStream: boolean): Promise<boolean>;
  debounceMs?: number;
}

export function bindTranscriptRecovery(options: RecoveryOptions) {
  let pending: Promise<void> | null = null;
  let reconnectStream = false;
  let running = false;
  let hiddenAt: number | null = options.documentRef.hidden ? Date.now() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (() => void) | null = null;
  let hiddenRecovery = false;
  let followup = false;

  function request(reason: RecoveryReason): Promise<void> {
    if (!options.getKey()) return Promise.resolve();
    if (options.documentRef.hidden) {
      hiddenRecovery = true;
      return Promise.resolve();
    }
    if (pending) {
      if (!running) reconnectStream ||= reason === 'control' || reason === 'resume';
      else if (reason === 'control' || reason === 'resume') followup = true;
      return pending;
    }
    const key = options.getKey();
    reconnectStream = reason === 'control' || reason === 'resume';
    pending = new Promise<void>((resolve) => { finish = resolve; });
    timer = setTimeout(() => {
      timer = null;
      running = true;
      void (async () => {
        try {
          if (options.documentRef.hidden || options.getKey() !== key) return;
          const restored = await options.refresh(reconnectStream);
          // A pin change or overlapping window load can invalidate the first try.
          if (!restored && options.getKey() === key && !options.documentRef.hidden) {
            await options.refresh(false);
          }
        } catch (error) {
          console.warn('transcript recovery failed', error);
        } finally {
          running = false;
          pending = null;
          finish?.();
          finish = null;
          if (followup) {
            followup = false;
            void request('control');
          }
        }
      })();
    }, options.debounceMs ?? 150);
    return pending;
  }

  function onVisibility(): void {
    if (options.documentRef.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenRecovery || (hiddenAt !== null && Date.now() - hiddenAt >= 1000)) void request('resume');
      hiddenRecovery = false;
      hiddenAt = null;
    }
  }
  function onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) void request('resume');
  }
  function onResume(): void { void request('resume'); }
  options.documentRef.addEventListener('visibilitychange', onVisibility);
  options.documentRef.addEventListener('resume', onResume);
  options.windowRef.addEventListener('pageshow', onPageShow);

  return {
    request,
    dispose(): void {
      options.documentRef.removeEventListener('visibilitychange', onVisibility);
      options.documentRef.removeEventListener('resume', onResume);
      options.windowRef.removeEventListener('pageshow', onPageShow);
      if (timer !== null) {
        clearTimeout(timer);
        finish?.();
        pending = null;
      }
    },
  };
}
