import {
  dispatchMobileEditorKey,
  isMobileUserAgent,
} from './editor_mobile_special_keys_utils.ts';

interface MentionPayload {
  path: string;
  lineNo?: number;
  col?: number;
  endLineNo?: number;
  endCol?: number;
  content?: string;
}

export type CodeInspectorMode = 'callHierarchy' | 'references' | 'implementations' | 'symbols';

interface MentionRequestDeps {
  getEditor(): MonacoRuntimeEditorLike | null;
  getDiffEditor?(): MonacoRuntimeDiffEditorLike | null;
  getCurrentPath(): string | null;
  sendEditorMentionRequest(payload: Record<string, unknown>): boolean;
  goToDefinition?(): void;
  inspectCode?(mode: CodeInspectorMode): void;
  getExtensionNavigationTools?(controls: {
    closeMenu(): void;
  }): MonacoTouchSelectionTool[];
  updateDebug(extra?: string): void;
}

import { touchMenuIcon } from './touch_menu_icon.ts';
const GO_TO_DEFINITION_ICON = touchMenuIcon('M19 5v6h-6 M18.5 10.5C16.8 7.8 13.8 6 10.5 6 6.4 6 3 9.1 3 13s3.4 7 7.5 7H13');

function buildMentionPayload(
  editorInstance: MonacoRuntimeEditorLike | null,
  currentPath: string | null,
): MentionPayload | null {
  if (!editorInstance || !currentPath) return null;
  const selection = editorInstance.getSelection ? editorInstance.getSelection() : null;
  const payload: MentionPayload = { path: currentPath };
  if (selection && !(selection.isEmpty && selection.isEmpty())) {
    payload.lineNo = selection.startLineNumber;
    payload.col = selection.startColumn;
    payload.endLineNo = selection.endLineNumber;
    payload.endCol = selection.endColumn;
    const model = editorInstance.getModel ? editorInstance.getModel() : null;
    let content = model && model.getValueInRange ? model.getValueInRange(selection) : '';
    if (content) {
      const lines = content.split('\n');
      if (lines.length > 20) {
        content = lines.slice(0, 20).join('\n') + '\n... (truncated, ' + lines.length + ' total lines)';
      }
      payload.content = content;
    }
  } else {
    const pos = editorInstance.getPosition ? editorInstance.getPosition() : null;
    if (pos) {
      payload.lineNo = pos.lineNumber;
      payload.col = pos.column;
    }
  }
  return payload;
}

export function sendMentionRequest(deps: MentionRequestDeps): void {
  let editor = deps.getEditor();
  const diff = deps.getDiffEditor ? deps.getDiffEditor() : null;
  if (diff && diff.getModifiedEditor) editor = diff.getModifiedEditor();
  const path = deps.getCurrentPath();
  const payload = buildMentionPayload(editor, path);
  if (!payload) return;
  const sent = deps.sendEditorMentionRequest({
    path: payload.path,
    lineNo: payload.lineNo,
    col: payload.col,
    endLineNo: payload.endLineNo,
    endCol: payload.endCol,
    content: payload.content,
  });
  if (!sent) {
    console.warn('[mention] editor RPC socket not connected');
  }
}

import { getHandleFeedback } from '../src/mobile-input/handle-feedback.ts';
const mentionBoundDoms = typeof WeakSet !== 'undefined' ? new WeakSet<HTMLElement>() : null;

export function ensureTouchSelection(reason: string, deps: MentionRequestDeps): void {
  try {
    const lib = window['monaco-touch-selection'];
    if (!lib || !lib.editorTouchSelectionHelp) return;
    const editor = deps.getEditor();
    const diff = deps.getDiffEditor ? deps.getDiffEditor() : null;
    const target = diff && diff.getModifiedEditor ? diff.getModifiedEditor() : editor;
    if (!target || !target.getDomNode) return;
    const dom = target.getDomNode();
    if (!dom) return;
    const hasUi = !!dom.querySelector('.monaco-editor-touch-selections');
    if (!hasUi) {
      const mobile = isMobileUserAgent(window.navigator);
      lib.editorTouchSelectionHelp(target, {
        mobile,
        getHandleFeedback,
        leadingTools: mobile
          ? ({ openMenu }) => [
              {
                name: 'tab left',
                innerHTML: touchMenuIcon('M4 5v14 M20 12H8 m5-5-5 5 5 5'),
                action: () => {
                  dispatchMobileEditorKey(target, {
                    key: 'Tab',
                    code: 'Tab',
                    keyCode: 9,
                    shiftKey: true,
                  }, window, { useStickyModifiers: false });
                  openMenu();
                },
              },
              {
                name: 'tab right',
                innerHTML: touchMenuIcon('M20 5v14 M4 12h12 m-5-5 5 5-5 5'),
                action: () => {
                  dispatchMobileEditorKey(target, {
                    key: 'Tab',
                    code: 'Tab',
                    keyCode: 9,
                  }, window, { useStickyModifiers: false });
                  openMenu();
                },
              },
            ]
          : undefined,
        navigationTools: deps.inspectCode || deps.goToDefinition || deps.getExtensionNavigationTools
          ? ({ closeMenu }) => [
              ...(deps.goToDefinition
                ? [{
                    name: 'go to definition',
                    innerHTML: GO_TO_DEFINITION_ICON,
                    action: () => {
                      closeMenu();
                      deps.goToDefinition?.();
                    },
                  }]
                : []),
              {
                name: 'call hierarchy',
                innerHTML: touchMenuIcon('M9 3h6v5H9z M12 8v4 M5 16v-4h14v4 M2 16h6v5H2z M16 16h6v5h-6z'),
                action: () => {
                  closeMenu();
                  deps.inspectCode?.('callHierarchy');
                },
              },
              {
                name: 'document symbols',
                innerHTML: touchMenuIcon('M3 3h6v6H3z M6 9v11 M6 14h7 M6 20h7 M13 11h8v5h-8z M13 18h8v4h-8z'),
                action: () => {
                  closeMenu();
                  deps.inspectCode?.('symbols');
                },
              },
              {
                name: 'find all references',
                innerHTML: touchMenuIcon('M8 4H4v16h12v-3 M9 2h11v14H9z M12 6h5 M12 10h5'),
                action: () => {
                  closeMenu();
                  deps.inspectCode?.('references');
                },
              },
              {
                name: 'find all implementations',
                innerHTML: touchMenuIcon('M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8z M12 12l9-9'),
                action: () => {
                  closeMenu();
                  deps.inspectCode?.('implementations');
                },
              },
              ...(deps.getExtensionNavigationTools?.({ closeMenu }) ?? []),
            ]
          : undefined,
      });
      deps.updateDebug('touch=reinit' + (reason ? ':' + reason : ''));
    }
    if (mentionBoundDoms && !mentionBoundDoms.has(dom)) {
      mentionBoundDoms.add(dom);
      dom.addEventListener('te2:mention-request', () => {
        sendMentionRequest(deps);
      });
    }
  } catch (error) {
    console.warn('[MonacoTouchSelection] ensure failed', error);
  }
}
