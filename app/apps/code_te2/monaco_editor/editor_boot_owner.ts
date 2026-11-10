interface EditorBootRecord {
  ready: Promise<void>;
  controller: AbortController;
  rendererId?: string;
}

export class EditorBootAdmissionError extends Error {}

/** Per-root boot admission; distinct mounts must not share a renderer identity. */
export class EditorBootOwner {
  private readonly records = new WeakMap<object, EditorBootRecord>();
  private readonly rendererRoots = new Map<string, object>();

  mount(root: object, start: (signal: AbortSignal) => Promise<void>, rendererId?: string): Promise<void> {
    const existing = this.records.get(root);
    if (existing?.controller.signal.aborted) {
      return Promise.reject(new EditorBootAdmissionError('Working editor disposed; use a fresh mount root'));
    }
    if (existing) {
      if (existing.rendererId !== rendererId) return Promise.reject(new EditorBootAdmissionError('Working editor root identity cannot change'));
      return existing.ready;
    }
    if (rendererId && this.rendererRoots.has(rendererId)) {
      return Promise.reject(new EditorBootAdmissionError('Working editor renderer identity is already mounted'));
    }
    const controller = new AbortController();
    // Publish ownership before invoking async boot, including synchronous errors.
    const ready = new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(new Error('Working editor disposed'));
      controller.signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return start(controller.signal);
      }).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    });
    this.records.set(root, { ready, controller, rendererId });
    if (rendererId) this.rendererRoots.set(rendererId, root);
    // Failed roots retain their result until explicitly disposed; they never
    // silently retry against partially initialized state.
    return ready;
  }

  dispose(root: object): boolean {
    const record = this.records.get(root);
    if (!record) return false;
    record.controller.abort();
    if (record.rendererId && this.rendererRoots.get(record.rendererId) === root) {
      this.rendererRoots.delete(record.rendererId);
    }
    return true;
  }

  isDisposed(root: object): boolean {
    return this.records.get(root)?.controller.signal.aborted === true;
  }
}
