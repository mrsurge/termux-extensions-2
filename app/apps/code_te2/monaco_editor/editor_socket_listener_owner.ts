export interface EditorSocketEventSource {
  on?(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
}

/** Remove only this transport's subscriptions; never clear a shared socket. */
export function createEditorSocketListenerOwner() {
  const cleanups = new Set<() => void>();
  let disposed = false;
  return {
    listen(source: EditorSocketEventSource | undefined, event: string, handler: (payload: unknown) => void): void {
      if (disposed || !source?.on) return;
      const owned = (payload: unknown): void => { if (!disposed) handler(payload); };
      source.on(event, owned);
      cleanups.add(() => source.off?.(event, owned));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) {
        try { cleanup(); } catch (_) { /* Other owned listeners still need cleanup. */ }
      }
      cleanups.clear();
    },
  };
}
