/** Transitional page owner: providers/models are still realm-scoped. */
export class EditorBootOwner {
  private root: object | null = null;
  private ready: Promise<void> | null = null;
  private controller: AbortController | null = null;

  mount(root: object, start: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.root === root && this.controller?.signal.aborted) {
      return Promise.reject(new Error('Working editor disposed; reload before remounting'));
    }
    if (this.root && this.root !== root) {
      return Promise.reject(new Error('Working editors still require separate realms until shared provider/model ownership is implemented.'));
    }
    if (this.ready) return this.ready;
    this.root = root;
    const controller = new AbortController();
    this.controller = controller;
    // Publish ownership before invoking async boot, including synchronous errors.
    this.ready = new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(new Error('Working editor disposed'));
      controller.signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return start(controller.signal);
      }).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    });
    // Retain failures: boot may already have installed non-disposable providers.
    // Retrying against partly initialized state requires a page reload today.
    return this.ready;
  }

  dispose(root: object): boolean {
    if (this.root !== root || !this.controller) return false;
    this.controller.abort();
    // Keep the realm reservation: not every outer/window service is scoped yet.
    return true;
  }

  isDisposed(root: object): boolean {
    return this.root === root && this.controller?.signal.aborted === true;
  }
}
