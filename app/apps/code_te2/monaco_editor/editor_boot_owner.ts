/** Transitional page owner: providers/models are still realm-scoped. */
export class EditorBootOwner {
  private root: object | null = null;
  private ready: Promise<void> | null = null;

  mount(root: object, start: () => Promise<void>): Promise<void> {
    if (this.root && this.root !== root) {
      return Promise.reject(new Error('Working editors still require separate realms until shared provider/model ownership is implemented.'));
    }
    if (this.ready) return this.ready;
    this.root = root;
    // Publish ownership before invoking async boot, including synchronous errors.
    this.ready = Promise.resolve().then(start);
    // Retain failures: boot may already have installed non-disposable providers.
    // Retrying against partly initialized state requires a page reload today.
    return this.ready;
  }
}
