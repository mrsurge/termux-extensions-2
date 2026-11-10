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

interface OwnedEditorSocket { disconnect?(): unknown }

/** Runtime-created namespace sockets, not a shared manager or external socket. */
export function createEditorSocketConnectionOwner() {
  const sockets = new Set<OwnedEditorSocket>();
  let disposed = false;
  const disconnect = (socket: OwnedEditorSocket): void => {
    try { socket.disconnect?.(); } catch (_) { /* Release all owned namespaces. */ }
  };
  return {
    own<T extends OwnedEditorSocket>(socket: T): T {
      if (disposed) disconnect(socket); else sockets.add(socket);
      return socket;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const socket of sockets) disconnect(socket);
      sockets.clear();
    },
  };
}
