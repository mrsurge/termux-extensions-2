import { parseSecondaryHistoryContent, type SecondaryHistoryContent } from './secondary-history-content.ts';

interface DisposableView { dispose(): void }

/** One content kind per page: working boot installs non-disposable providers. */
export class SecondaryContentLifecycle {
  private kind: 'working' | 'historical' | null = null;
  private key = '';
  private controller: AbortController | null = null;
  private view: DisposableView | null = null;
  private stopped = false;
  private reloading = false;

  constructor(private readonly hooks: {
    mount(content: SecondaryHistoryContent, signal: AbortSignal): Promise<DisposableView>;
    reload(): void;
  }) {}

  get historical(): boolean { return this.kind === 'historical'; }

  async apply(raw: unknown): Promise<'working' | 'historical' | 'reload' | 'superseded'> {
    if (this.stopped || this.reloading) return 'superseded';
    // Invalid descriptors fail closed rather than reviving a working document.
    const content = raw == null ? null : parseSecondaryHistoryContent(raw);
    const next = content ? 'historical' : 'working';
    if (this.kind !== null && this.kind !== next) {
      this.reloading = true;
      this.clear();
      this.hooks.reload();
      return 'reload';
    }
    this.kind = next;
    if (!content) return 'working';
    const key = JSON.stringify([content.projectPath, content.projectGeneration, content.revision,
      content.snapshotId, content.commitId, content.fileIndex]);
    if (key === this.key) return 'historical';
    this.clear();
    this.key = key;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const view = await this.hooks.mount(content, controller.signal);
      if (controller.signal.aborted) {
        view.dispose();
        return 'superseded';
      }
      this.view = view;
      return 'historical';
    } catch (error) {
      if (controller.signal.aborted) return 'superseded';
      this.key = ''; // An explicit reconnect/snapshot can retry a failed mount.
      throw error;
    }
  }

  private clear(): void {
    this.controller?.abort();
    this.controller = null;
    this.view?.dispose();
    this.view = null;
  }

  dispose(): void { this.stopped = true; this.clear(); }
}
