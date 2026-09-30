import { initResponsiveLayout } from '../ui/layout-manager.ts';
import { loadLayoutPreferences } from '../host-resize-manager.ts';

/** Local-only preparation. Never connect an RPC lane or create document models. */
export default function preparePage(container: HTMLElement): void {
  const root = container.querySelector<HTMLElement>('.fe-root');
  if (!root || root.dataset.te2LayoutPrepared === '1') return;
  initResponsiveLayout();
  loadLayoutPreferences();
  root.dataset.te2LayoutPrepared = '1';
}
