/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Code TE2 adapter for the vendored Code OSS chat-editing diff rendering source:
 *   ./upstream/chatEditingCodeEditorIntegration.ts
 *
 * This is the runnable Code TE2 adaptation of the vendored upstream
 * ChatEditingCodeEditorIntegration._updateDiffRendering(...) body. Workbench
 * services that do not exist in the standalone Monaco host are left at the
 * boundary, while the rendering path itself stays vendored:
 * - Monaco's diffEditorViewZones/renderLines renders deleted/original text
 * - Monaco stock line-insert/line-delete/char-insert/char-delete classes are used
 * - DiffHunkWidget overlays are anchored exactly like the upstream widget path
 */

import {
  LineSource,
  RenderOptions,
  renderLines,
} from '../../../../static/vendor/monaco-editor-core/esm/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import {
  LineTokens,
} from '../../../../static/vendor/monaco-editor-core/esm/vs/editor/common/tokens/lineTokens.js';
import {
  DiffHunkWidget,
  type DetailedLineRangeMappingLike,
  type ICodeEditorLike,
  type IDocumentDiff2Like,
} from './diffHunkWidget.ts';

export interface MonacoRangeCtorLike {
  new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): unknown;
}

export interface MonacoCodeEditorForChatHunks extends ICodeEditorLike {
  createDecorationsCollection?(): { set?(decorations: unknown[]): void; clear?(): void };
  deltaDecorations?(oldDecorations: unknown[], newDecorations: unknown[]): unknown[];
  getOptions?(): unknown;
  changeViewZones?(callback: (accessor: {
    addZone(zone: {
      afterLineNumber: number;
      heightInLines: number;
      domNode: HTMLElement;
      ordinal?: number;
    }): string;
    removeZone(id: string): void;
  }) => void): void;
}

export interface MonacoTextModelForChatHunks {
  getLineCount?(): number;
  getVersionId?(): number;
  getOptions?(): { tabSize?: number };
}

export interface ChatEditingLineRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface ChatEditingHunkRenderChange {
  hunkId: string;
  state: string;
  original: ChatEditingLineRangeLike | null;
  modified: ChatEditingLineRangeLike;
  originalLines: string[];
  modifiedLines: string[];
  diffInfo: IDocumentDiff2Like;
  change: DetailedLineRangeMappingLike;
}

export interface ChatEditingHunkRendererDeps {
  document: Document;
  editor: MonacoCodeEditorForChatHunks;
  model: MonacoTextModelForChatHunks;
  RangeCtor: MonacoRangeCtorLike;
}

interface RenderedWidget {
  change: ChatEditingHunkRenderChange;
  widget: DiffHunkWidget;
}

function asFiniteLine(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function clampLine(lineNumber: number, lineCount: number): number {
  return Math.max(1, Math.min(lineCount, lineNumber));
}

function inclusiveRangeLineCount(range: ChatEditingLineRangeLike | null): number {
  if (!range) return 0;
  return Math.max(0, range.endLineNumber - range.startLineNumber + 1);
}

function changedLineDelta(change: ChatEditingHunkRenderChange): number {
  const explicitModifiedLines = change.modifiedLines.length;
  if (explicitModifiedLines > 0) {
    return explicitModifiedLines - Math.max(0, change.originalLines.length);
  }
  return inclusiveRangeLineCount(change.modified) - inclusiveRangeLineCount(change.original);
}

function hasOriginalDeletion(change: ChatEditingHunkRenderChange): boolean {
  return change.originalLines.length > 0 || inclusiveRangeLineCount(change.original) > 0;
}

function modifiedDecorationClass(change: ChatEditingHunkRenderChange): string {
  if (changedLineDelta(change) < 0) return 'line-delete';
  return 'line-insert';
}

function visualLineRange(change: ChatEditingHunkRenderChange, lineCount: number): { start: number; end: number } {
  const start = clampLine(asFiniteLine(change.modified.startLineNumber, 1), lineCount);
  const delta = changedLineDelta(change);
  if (delta < 0) {
    return { start, end: start };
  }
  if (delta > 0) {
    return { start, end: clampLine(start + delta - 1, lineCount) };
  }
  return { start, end: start };
}

const LINE_TOKEN_DECODER = {
  decodeLanguageId(_languageId: number): string {
    return 'plaintext';
  },
};

function normalizeDtoLines(lines: string[]): string[] {
  const result = lines.map((line) => String(line ?? '').replace(/\r$/, ''));
  return result.length ? result : [''];
}

function createLineSourceFromDto(lines: string[]): unknown {
  return new LineSource(
    normalizeDtoLines(lines).map((line) => LineTokens.createEmpty(line, LINE_TOKEN_DECODER)),
    [],
    true,
    true,
  );
}

function createOriginalZoneDom(
  document: Document,
  editor: MonacoCodeEditorForChatHunks,
  change: ChatEditingHunkRenderChange,
): { domNode: HTMLElement; heightInLines: number } {
  const domNode = document.createElement('div');
  domNode.className = 'chat-editing-original-zone view-lines line-delete monaco-mouse-cursor-text';

  const lines = change.originalLines.length
    ? normalizeDtoLines(change.originalLines)
    : Array.from({ length: Math.max(1, inclusiveRangeLineCount(change.original)) }, () => '');

  // Upstream VS Code reads tokenized original lines from diff.originalModel.
  // Code TE2 receives those original lines in the sidebar.agentEdits DTO, so
  // this is the only adaptation point before calling the vendored renderer.
  const source = createLineSourceFromDto(lines);
  const renderOptions = RenderOptions.fromEditor(editor);
  const result = renderLines(source, renderOptions, [], domNode);
  return { domNode, heightInLines: Math.max(1, Number(result.heightInLines) || lines.length || 1) };
}

export class ChatEditingHunkRenderer {
  private readonly _decorationsCollection: { set?(decorations: unknown[]): void; clear?(): void } | null;
  private _decorationIds: unknown[] = [];
  private _viewZones: string[] = [];
  private _widgets: RenderedWidget[] = [];

  constructor(private readonly _deps: ChatEditingHunkRendererDeps) {
    this._decorationsCollection = this._deps.editor.createDecorationsCollection?.() || null;
  }

  clear(): void {
    for (const rendered of this._widgets) {
      try { rendered.widget.dispose(); } catch (_) {}
    }
    this._widgets = [];

    if (this._decorationsCollection?.clear) {
      this._decorationsCollection.clear();
    } else if (this._decorationsCollection?.set) {
      this._decorationsCollection.set([]);
    } else if (typeof this._deps.editor.deltaDecorations === 'function') {
      this._decorationIds = this._deps.editor.deltaDecorations(this._decorationIds, []);
    }

    this._removeViewZones();
  }

  render(changes: ChatEditingHunkRenderChange[]): void {
    this.clear();

    const lineCount = Math.max(1, this._deps.model.getLineCount?.() || 1);
    const modelVersion = Number(this._deps.model.getVersionId?.() || this._deps.editor.getModel?.()?.getVersionId?.() || 0);
    const decorations: unknown[] = [];

    this._deps.editor.changeViewZones?.((viewZoneChangeAccessor) => {
      this._removeViewZones(viewZoneChangeAccessor);

      for (const change of changes) {
        const { start: modifiedStart, end: modifiedEnd } = visualLineRange(change, lineCount);
        const lineClass = modifiedDecorationClass(change);
        const rendersOriginalZone = lineClass === 'line-delete' && change.originalLines.length > 0;

        if (!rendersOriginalZone) {
          decorations.push({
            range: new this._deps.RangeCtor(modifiedStart, 1, Math.max(modifiedStart, modifiedEnd), 1),
            options: {
              description: 'chat-editing-decoration',
              isWholeLine: true,
              className: lineClass,
              marginClassName: lineClass === 'line-delete' ? 'gutter-delete' : 'gutter-insert',
            },
          });
        }

        if (lineClass === 'line-insert') {
          decorations.push({
            range: new this._deps.RangeCtor(modifiedStart, 1, Math.max(modifiedStart, modifiedEnd), Number.MAX_SAFE_INTEGER),
            options: {
              description: 'chat-editing-decoration',
              className: 'char-insert',
              isWholeLine: true,
            },
          });
        }

        let extraLines = 0;
        if (rendersOriginalZone && hasOriginalDeletion(change)) {
          const { domNode, heightInLines } = createOriginalZoneDom(this._deps.document, this._deps.editor, change);
          extraLines = heightInLines;
          this._viewZones.push(viewZoneChangeAccessor.addZone({
            afterLineNumber: Math.max(0, modifiedStart - 1),
            heightInLines: extraLines,
            domNode,
            ordinal: 50002,
          }));
        }

        const widget = new DiffHunkWidget(
          this._deps.editor,
          change.diffInfo,
          change.change,
          modelVersion,
          extraLines,
        );
        widget.layout(modifiedStart);
        widget.toggle(change.state === 'pending');
        this._widgets.push({ change, widget });
      }
    });

    if (typeof this._deps.editor.changeViewZones !== 'function') {
      for (const change of changes) {
        const { start: modifiedStart, end: modifiedEnd } = visualLineRange(change, lineCount);
        decorations.push({
          range: new this._deps.RangeCtor(modifiedStart, 1, Math.max(modifiedStart, modifiedEnd), 1),
          options: {
            description: 'chat-editing-decoration',
            isWholeLine: true,
            className: modifiedDecorationClass(change),
          },
        });
        const widget = new DiffHunkWidget(
          this._deps.editor,
          change.diffInfo,
          change.change,
          modelVersion,
          0,
        );
        widget.layout(modifiedStart);
        widget.toggle(change.state === 'pending');
        this._widgets.push({ change, widget });
      }
    }

    this._setDecorations(decorations);
  }

  relayout(): void {
    const lineCount = Math.max(1, this._deps.model.getLineCount?.() || 1);
    for (const rendered of this._widgets) {
      try {
        const lineNumber = clampLine(asFiniteLine(rendered.change.modified.startLineNumber, 1), lineCount);
        rendered.widget.layout(lineNumber);
        rendered.widget.toggle(rendered.change.state === 'pending');
      } catch (_) {}
    }
  }

  private _setDecorations(decorations: unknown[]): void {
    if (this._decorationsCollection?.set) {
      this._decorationsCollection.set(decorations);
      return;
    }
    if (typeof this._deps.editor.deltaDecorations === 'function') {
      this._decorationIds = this._deps.editor.deltaDecorations(this._decorationIds, decorations);
    }
  }

  private _removeViewZones(accessor?: { removeZone(id: string): void }): void {
    if (!this._viewZones.length) return;
    if (accessor) {
      for (const id of this._viewZones) {
        try { accessor.removeZone(id); } catch (_) {}
      }
      this._viewZones = [];
      return;
    }
    if (typeof this._deps.editor.changeViewZones === 'function') {
      this._deps.editor.changeViewZones((viewZoneChangeAccessor) => {
        for (const id of this._viewZones) {
          try { viewZoneChangeAccessor.removeZone(id); } catch (_) {}
        }
        this._viewZones = [];
      });
    } else {
      this._viewZones = [];
    }
  }
}
