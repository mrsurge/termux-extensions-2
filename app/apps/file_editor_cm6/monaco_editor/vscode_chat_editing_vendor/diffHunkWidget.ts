/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Code TE2 runtime adapter for the Code OSS source vendored at:
 *   ./upstream/chatEditingCodeEditorIntegration.ts
 *
 * This is the runnable Code TE2 adaptation of the upstream DiffHunkWidget.
 * Keep the upstream overlay-widget contract, ids, CSS class names, layout
 * algorithm, and accept/reject version guard. Workbench services that exist in
 * TE2 should be wired through this seam; only missing services should stay as
 * explicit adapter stubs.
 *
 * Upstream source:
 *   src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingCodeEditorIntegration.ts
 *
 * The current local seam is the toolbar constructor. Code TE2 does not yet
 * provide the workbench MenuWorkbenchToolBar/DI object here, so the
 * ChatEditingEditorHunk actions are rendered with the same ids, labels, and
 * Monaco action-bar DOM classes used by VS Code until that service is wired.
 */

export interface IOverlayWidgetPositionPreferenceLike {
  top: number;
  left: number;
}

export interface IOverlayWidgetPositionLike {
  stackOrdinal?: number;
  preference: IOverlayWidgetPositionPreferenceLike;
}

export interface IOverlayWidgetLike {
  getId(): string;
  getDomNode(): HTMLElement;
  getPosition(): IOverlayWidgetPositionLike | null;
}

export interface IModifiedFileEntryChangeHunk {
  accept(): Promise<boolean>;
  reject(): Promise<boolean>;
}

export interface ICodeEditorLike {
  addOverlayWidget(widget: IOverlayWidgetLike): void;
  removeOverlayWidget(widget: IOverlayWidgetLike): void;
  layoutOverlayWidget(widget: IOverlayWidgetLike): void;
  getModel?(): { getVersionId?(): number } | null;
  getOption?(option: unknown): number;
  getLayoutInfo(): { contentLeft: number; contentWidth: number; verticalScrollbarWidth: number };
  getScrollTop(): number;
  getTopForLineNumber(lineNumber: number): number;
  focus(): void;
}

export interface DetailedLineRangeMappingLike {
  modified?: {
    startLineNumber?: number;
  };
  [key: string]: unknown;
}

export interface IDocumentDiff2Like {
  keep(change: DetailedLineRangeMappingLike): Promise<boolean> | boolean;
  undo(change: DetailedLineRangeMappingLike): Promise<boolean> | boolean;
}

export interface DiffHunkWidgetToolbarAction {
  id: string;
  label: string;
  shortTitle: string;
  primary?: boolean;
  disabled?: boolean;
  run(): void;
}

export interface DiffHunkWidgetToolbarFactoryDeps {
  widget: IModifiedFileEntryChangeHunk;
  editor: ICodeEditorLike;
  container: HTMLElement;
  actions: DiffHunkWidgetToolbarAction[];
}

export type DiffHunkWidgetToolbarFactory = (deps: DiffHunkWidgetToolbarFactoryDeps) => { dispose(): void };

const CHAT_EDITOR_ACCEPT_HUNK_ID = 'chatEditor.action.acceptHunk';
const CHAT_EDITOR_UNDO_HUNK_ID = 'chatEditor.action.undoHunk';

function getTotalWidth(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (Number.isFinite(rect.width) && rect.width > 0) return rect.width;
  const style = getComputedStyle(element);
  const width = Number.parseFloat(style.width || '0');
  const marginLeft = Number.parseFloat(style.marginLeft || '0');
  const marginRight = Number.parseFloat(style.marginRight || '0');
  return Math.max(0, width + marginLeft + marginRight);
}

function editorLineHeight(editor: ICodeEditorLike): number {
  try {
    const value = editor.getOption?.(67); // EditorOption.lineHeight in Monaco's numeric enum.
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 20;
  } catch (_) {
    return 20;
  }
}

function createLocalChatEditingEditorHunkToolbar(deps: DiffHunkWidgetToolbarFactoryDeps): { dispose(): void } {
  const actionBar = document.createElement('div');
  actionBar.className = 'monaco-action-bar';
  actionBar.setAttribute('role', 'toolbar');
  actionBar.setAttribute('aria-label', 'Chat edit change actions');

  const actionsContainer = document.createElement('ul');
  actionsContainer.className = 'actions-container';
  actionBar.appendChild(actionsContainer);

  const cleanups: Array<() => void> = [];
  for (const action of deps.actions) {
    const item = document.createElement('li');
    item.className = 'action-item';
    if (action.primary) item.classList.add('primary');
    if (action.disabled) item.classList.add('disabled');

    const button = document.createElement('a');
    button.className = 'action-label';
    button.href = '#';
    button.textContent = action.shortTitle || action.label;
    button.title = action.label;
    button.setAttribute('role', 'button');
    button.dataset.actionId = action.id;
    if (action.disabled) button.setAttribute('aria-disabled', 'true');

    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.classList.contains('disabled')) return;
      deps.editor.focus();
      action.run();
    };
    button.addEventListener('click', onClick);
    cleanups.push(() => button.removeEventListener('click', onClick));

    item.appendChild(button);
    actionsContainer.appendChild(item);
  }

  deps.container.appendChild(actionBar);
  return {
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      actionBar.remove();
    },
  };
}

export class DiffHunkWidget implements IOverlayWidgetLike, IModifiedFileEntryChangeHunk {

  private static _idPool = 0;
  private readonly _id: string = `diff-change-widget-${DiffHunkWidget._idPool++}`;

  private readonly _domNode: HTMLElement;
  private readonly _toolbar: { dispose(): void };
  private _position: IOverlayWidgetPositionLike | undefined;
  private _lastStartLineNumber: number | undefined;
  private _removed: boolean = false;

  constructor(
    private readonly _editor: ICodeEditorLike,
    private _diffInfo: IDocumentDiff2Like,
    private _change: DetailedLineRangeMappingLike,
    private _versionId: number,
    private _lineDelta: number,
    toolbarFactory: DiffHunkWidgetToolbarFactory = createLocalChatEditingEditorHunkToolbar,
  ) {
    this._domNode = document.createElement('div');
    this._domNode.className = 'chat-diff-change-content-widget';

    this._toolbar = toolbarFactory({
      widget: this,
      editor: this._editor,
      container: this._domNode,
      actions: [
        {
          id: CHAT_EDITOR_ACCEPT_HUNK_ID,
          label: 'Keep this Change',
          shortTitle: 'Keep',
          primary: true,
          run: () => { void this.accept(); },
        },
        {
          id: CHAT_EDITOR_UNDO_HUNK_ID,
          label: 'Undo this Change',
          shortTitle: 'Undo',
          run: () => { void this.reject(); },
        },
      ],
    });

    this._editor.addOverlayWidget(this);
  }

  update(diffInfo: IDocumentDiff2Like, change: DetailedLineRangeMappingLike, versionId: number, lineDelta: number): void {
    this._diffInfo = diffInfo;
    this._change = change;
    this._versionId = versionId;
    this._lineDelta = lineDelta;
  }

  dispose(): void {
    this._toolbar.dispose();
    this._editor.removeOverlayWidget(this);
    this._removed = true;
  }

  getId(): string {
    return this._id;
  }

  layout(startLineNumber: number): void {

    const lineHeight = editorLineHeight(this._editor);
    const { contentLeft, contentWidth, verticalScrollbarWidth } = this._editor.getLayoutInfo();
    const scrollTop = this._editor.getScrollTop();

    this._position = {
      stackOrdinal: 1,
      preference: {
        top: this._editor.getTopForLineNumber(startLineNumber) - scrollTop - (lineHeight * this._lineDelta),
        left: contentLeft + contentWidth - (2 * verticalScrollbarWidth + getTotalWidth(this._domNode))
      }
    };

    if (this._removed) {
      this._removed = false;
      this._editor.addOverlayWidget(this);
    } else {
      this._editor.layoutOverlayWidget(this);
    }
    this._lastStartLineNumber = startLineNumber;
  }

  remove(): void {
    this._editor.removeOverlayWidget(this);
    this._removed = true;
  }

  toggle(show: boolean) {
    this._domNode.classList.toggle('hover', show);
    if (this._lastStartLineNumber) {
      this.layout(this._lastStartLineNumber);
    }
  }

  setPending(pending: boolean): void {
    const labels = Array.from(this._domNode.querySelectorAll<HTMLElement>('.action-item'));
    for (const label of labels) {
      label.classList.toggle('disabled', pending);
    }
  }

  getDomNode(): HTMLElement {
    return this._domNode;
  }

  getPosition(): IOverlayWidgetPositionLike | null {
    return this._position ?? null;
  }

  getStartLineNumber(): number | undefined {
    return this._lastStartLineNumber;
  }

  // ---

  async reject(): Promise<boolean> {
    if (this._versionId !== this._editor.getModel?.()?.getVersionId?.()) {
      return false;
    }
    return await this._diffInfo.undo(this._change);
  }

  async accept(): Promise<boolean> {
    if (this._versionId !== this._editor.getModel?.()?.getVersionId?.()) {
      return false;
    }
    return this._diffInfo.keep(this._change);
  }
}
