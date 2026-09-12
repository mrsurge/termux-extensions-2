import type { HistoryRow, HistoryTreeInput } from './pane-platform.ts';

// Narrow structural surface of the real upstream CompressibleAsyncDataTree.
// The DOM integration test supplies that actual class, not a replacement tree.
export interface TreeDisposable { dispose(): void; }
export interface HistoryTreeRenderer {
  readonly templateId: string;
  renderTemplate(container: HTMLElement): unknown;
  renderElement(node: { readonly element: HistoryRow }, index: number, template: unknown): void;
  renderCompressedElements(): never;
  disposeTemplate(template: unknown): void;
}
export interface HistoryTree {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly renderHeight: number;
  onDidScroll(listener: (event: { readonly scrollTopChanged: boolean }) => void): TreeDisposable;
  setInput(input: HistoryTreeInput): Promise<void>;
  updateChildren(input: HistoryTreeInput | HistoryRow, recursive: boolean, rerender: boolean): Promise<void>;
  layout(height: number, width: number): void;
  expand(element: HistoryRow): Promise<boolean>;
  collapse(element: HistoryRow): boolean;
  isCollapsed(element: HistoryRow): boolean;
  setFocus(elements: HistoryRow[]): void;
  getFocus(): HistoryRow[];
  setSelection(elements: HistoryRow[]): void;
  getSelection(): HistoryRow[];
  cancelAllRefreshPromises(includeSubTrees: boolean): void;
  onPointer(listener: (event: { readonly element: HistoryRow | null; readonly browserEvent: UIEvent }) => void): TreeDisposable;
  onKeyDown(listener: (event: KeyboardEvent) => void): TreeDisposable;
  dispose(): void;
}
export interface HistoryTreeConstructor {
  new (
    user: string,
    container: HTMLElement,
    delegate: { getHeight(): number; getTemplateId(element: HistoryRow): string },
    compression: { isIncompressible(element: HistoryRow): boolean },
    renderers: HistoryTreeRenderer[],
    dataSource: {
      hasChildren(element: HistoryTreeInput | HistoryRow): boolean;
      getChildren(element: HistoryTreeInput | HistoryRow): Promise<HistoryRow[]>;
    },
    options: {
      compressionEnabled: boolean;
      expandOnlyOnTwistieClick: boolean;
      identityProvider: { getId(element: HistoryRow): string };
      accessibilityProvider: { getWidgetAriaLabel(): string; getAriaLabel(element: HistoryRow): string };
    },
  ): HistoryTree;
}
