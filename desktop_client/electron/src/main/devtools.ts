interface InspectableContents {
  isDestroyed(): boolean;
  isDevToolsOpened(): boolean;
  closeDevTools(): void;
  openDevTools(options: { mode: 'detach' }): void;
}

export function toggleDetachedDevTools(enabled: boolean, contents: InspectableContents | null | undefined): void {
  if (!enabled) throw new Error('Enable the DevTools button in Desktop Settings first.');
  if (!contents || contents.isDestroyed()) throw new Error('No live app or launcher to inspect.');
  if (contents.isDevToolsOpened()) contents.closeDevTools();
  else contents.openDevTools({ mode: 'detach' });
}
