import { initBreadcrumbElement } from './editor_breadcrumb_init_utils.ts';
import { loadBreadcrumbIcons } from './editor_breadcrumb_icons_loader_utils.ts';
import { shouldUpdateBreadcrumbPath } from './editor_breadcrumb_update_path_utils.ts';
import { resolveBreadcrumbSymbolsLangId } from './editor_breadcrumb_symbols_lang_utils.ts';
import { getBreadcrumbSymbolsTimeoutMs } from './editor_breadcrumb_symbols_timeout_utils.ts';
import { unwrapBreadcrumbSymbols } from './editor_breadcrumb_symbols_unwrap_utils.ts';
import { symbolRangeToLineBounds } from './editor_breadcrumb_symbol_range_utils.ts';
import { breadcrumbSymbolIcon } from './editor_breadcrumb_symbol_icon_utils.ts';
import { findBreadcrumbSymbolChain } from './editor_breadcrumb_find_symbol_chain_utils.ts';
import { splitBreadcrumbPathParts } from './editor_breadcrumb_split_parts_utils.ts';
import { appendBreadcrumbSeparator } from './editor_breadcrumb_append_sep_utils.ts';
import { isBreadcrumbFileSegment } from './editor_breadcrumb_is_file_segment_utils.ts';
import { createBreadcrumbPathItem } from './editor_breadcrumb_create_path_item_utils.ts';
import { getBreadcrumbIconTheme } from './editor_breadcrumb_icon_theme_utils.ts';
import { applyBreadcrumbFileIcon } from './editor_breadcrumb_apply_icon_utils.ts';
import { shouldRenderBreadcrumbSymbolChain } from './editor_breadcrumb_should_render_symbols_utils.ts';
import { getBreadcrumbSymbolPosition } from './editor_breadcrumb_symbol_position_utils.ts';
import { createBreadcrumbSymbolItem } from './editor_breadcrumb_create_symbol_item_utils.ts';
import { finalizeBreadcrumbScroll } from './editor_breadcrumb_finalize_scroll_utils.ts';
import { getBreadcrumbPathClickTarget } from './editor_breadcrumb_path_click_utils.ts';
import { getBreadcrumbSymbolClickPosition } from './editor_breadcrumb_symbol_click_utils.ts';

interface EditorSocketLike {
  connected?: boolean;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface EditorBreadcrumbRuntimeDeps {
  getDocument(): Document | null;
  getCurrentPath(): string | null;
  getModel(): unknown;
  getEditorSocket(): EditorSocketLike | null;
  wbCurrentGeneration(): number;
  wbIsBarrierOpen(path: string, generation: number): boolean;
  wbQueueSymbols(path: string, generation: number): void;
  languageFromPath(path: string): string;
  editorWorkbenchCall(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  applyJumpToLine(line: number, col: number): void;
}

interface BreadcrumbSymbolRangeLike {
  [key: string]: unknown;
}

interface BreadcrumbSymbolLike {
  kind?: unknown;
  name?: unknown;
  selectionRange?: BreadcrumbSymbolRangeLike | null;
  range?: BreadcrumbSymbolRangeLike | null;
  children?: BreadcrumbSymbolLike[] | null;
  location?: { range?: BreadcrumbSymbolRangeLike | null } | null;
  [key: string]: unknown;
}

interface BreadcrumbPathClickTarget {
  isFile: boolean;
  absDir: string;
}

interface BreadcrumbSymbolClickPosition {
  line?: unknown;
  col?: unknown;
}

interface BreadcrumbRuntime {
  init(): void;
  updatePath(absPath: string | null | undefined, deferSymbols?: boolean): void;
  requestSymbols(absPath: string, opts?: { generation?: number }): void;
  updateCursor(line?: number): void;
}

const SYMBOL_ICON_MAP: Record<number, [string, string]> = {
  1: ['codicon-symbol-file', '#8b949e'],
  2: ['codicon-symbol-module', '#bc8cff'],
  3: ['codicon-symbol-namespace', '#bc8cff'],
  4: ['codicon-symbol-package', '#f0883e'],
  5: ['codicon-symbol-class', '#f0883e'],
  6: ['codicon-symbol-method', '#bc8cff'],
  7: ['codicon-symbol-property', '#4da6ff'],
  8: ['codicon-symbol-field', '#4da6ff'],
  9: ['codicon-symbol-constructor', '#bc8cff'],
  10: ['codicon-symbol-enum', '#f0883e'],
  11: ['codicon-symbol-interface', '#4da6ff'],
  12: ['codicon-symbol-function', '#bc8cff'],
  13: ['codicon-symbol-variable', '#4da6ff'],
  14: ['codicon-symbol-constant', '#4da6ff'],
  15: ['codicon-symbol-string', '#f0883e'],
  16: ['codicon-symbol-number', '#a6e22e'],
  17: ['codicon-symbol-boolean', '#4da6ff'],
  18: ['codicon-symbol-array', '#f0883e'],
  19: ['codicon-symbol-object', '#8b949e'],
  22: ['codicon-symbol-enum-member', '#f0883e'],
  23: ['codicon-symbol-struct', '#f0883e'],
  25: ['codicon-symbol-operator', '#8b949e'],
  26: ['codicon-symbol-type-parameter', '#a6e22e'],
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function createEditorBreadcrumbRuntime(
  deps: EditorBreadcrumbRuntimeDeps,
): BreadcrumbRuntime {
  let element: HTMLElement | null = null;
  let symbols: BreadcrumbSymbolLike[] = [];
  let lastPath: string | null = null;
  let symbolsSeq = 0;
  let getIcon:
    | ((name: string, theme: Record<string, string>) => Promise<unknown> | unknown)
    | null = null;

  function renderSymbolIcon(kind: unknown): string {
    return breadcrumbSymbolIcon(kind, SYMBOL_ICON_MAP);
  }

  function render(cursorLine?: number): void {
    if (!element) return;
    element.innerHTML = '';
    if (!lastPath) return;

    const doc = deps.getDocument();
    if (!doc) return;

    const parts = splitBreadcrumbPathParts(lastPath);
    let accum = '';
    for (let index = 0; index < parts.length; index += 1) {
      accum += '/' + parts[index];
      if (index > 0) {
        appendBreadcrumbSeparator(doc, element);
      }
      const isFile = isBreadcrumbFileSegment(index, parts.length);
      const item = createBreadcrumbPathItem(doc, accum, isFile);
      if (isFile && getIcon) {
        const iconSpan = doc.createElement('span');
        iconSpan.className = 'te2-bc-icon';
        item.appendChild(iconSpan);
        applyBreadcrumbFileIcon(getIcon, iconSpan, parts[index], getBreadcrumbIconTheme());
      }
      const label = doc.createElement('span');
      label.textContent = parts[index];
      item.appendChild(label);
      item.addEventListener('click', onPathClick);
      element.appendChild(item);
    }

    if (shouldRenderBreadcrumbSymbolChain(symbols, cursorLine)) {
      const chain = findBreadcrumbSymbolChain(symbols, cursorLine, symbolRangeToLineBounds);
      for (let index = 0; index < chain.length; index += 1) {
        appendBreadcrumbSeparator(doc, element);
        const symbolItem = createBreadcrumbSymbolItem(doc, chain[index], index, renderSymbolIcon(chain[index].kind));
        const symbolRange = chain[index].selectionRange || chain[index].range;
        if (symbolRange) {
          const pos = getBreadcrumbSymbolPosition(symbolRange);
          symbolItem.dataset.line = String(pos.line);
          symbolItem.dataset.col = String(pos.col);
        }
        symbolItem.addEventListener('click', onSymbolClick);
        element.appendChild(symbolItem);
      }
    }

    finalizeBreadcrumbScroll(element);
  }

  function onPathClick(event: Event): void {
    try {
      const target = getBreadcrumbPathClickTarget(event) as BreadcrumbPathClickTarget;
      if (target.isFile) return;
      const socket = deps.getEditorSocket();
      console.log('[BC] path click:', target.absDir, 'socket connected:', !!(socket && socket.connected));
      if (socket && socket.connected && typeof socket.emit === 'function') {
        socket.emit('editor_breadcrumb_navigate', { path: target.absDir, open_drawer: true });
      }
    } catch (_) {}
  }

  function onSymbolClick(event: Event): void {
    try {
      const pos = getBreadcrumbSymbolClickPosition(event) as BreadcrumbSymbolClickPosition;
      const line = asNumber(pos.line, NaN);
      const col = asNumber(pos.col, 1);
      if (Number.isFinite(line)) {
        deps.applyJumpToLine(line, col);
      }
    } catch (_) {}
  }

  function init(): void {
    const doc = deps.getDocument();
    if (!doc) return;
    element = initBreadcrumbElement(doc);
    loadBreadcrumbIcons(
      (path: string) => import(path),
      (nextGetIcon: (...args: unknown[]) => unknown) => {
        getIcon = (name: string, theme: Record<string, string>) => nextGetIcon(name, theme);
        if (lastPath) render();
      },
      (error: unknown) => { console.warn('[BC] seti-icons load failed:', error); },
    );
  }

  function updatePath(absPath: string | null | undefined, deferSymbols?: boolean): void {
    if (!element) return;
    const nextPath = asString(absPath);
    if (!shouldUpdateBreadcrumbPath(nextPath, lastPath, deferSymbols)) return;
    lastPath = nextPath;
    symbols = [];
    render();
    if (!deferSymbols && nextPath) {
      requestSymbols(nextPath);
    }
  }

  function requestSymbols(absPath: string, opts?: { generation?: number }): void {
    const generation = opts && Number.isFinite(Number(opts.generation))
      ? Number(opts.generation)
      : deps.wbCurrentGeneration();
    const socket = deps.getEditorSocket();
    if (!socket || !socket.connected) return;
    if (!deps.wbIsBarrierOpen(absPath, generation)) {
      deps.wbQueueSymbols(absPath, generation);
      return;
    }

    const seq = ++symbolsSeq;
    const langId = resolveBreadcrumbSymbolsLangId(deps.getModel(), absPath, deps.languageFromPath);
    if (langId === 'plaintext') {
      symbols = [];
      render();
      return;
    }

    const timeoutMs = getBreadcrumbSymbolsTimeoutMs(langId);
    deps.editorWorkbenchCall('symbols', {
      path: absPath,
      languageId: langId,
      generation,
    }, { timeoutMs }).then((result) => {
      if (seq !== symbolsSeq) return;
      if (generation !== deps.wbCurrentGeneration()) return;
      if (String(absPath || '') !== String(deps.getCurrentPath() || '')) return;
      symbols = asArray<BreadcrumbSymbolLike>(unwrapBreadcrumbSymbols(result));
      console.log('[BC] symbols received:', symbols.length, symbols.slice(0, 2));
      render();
    }).catch((error) => {
      console.warn('[BC] symbols request failed:', error);
    });
  }

  function updateCursor(line?: number): void {
    if (!element || !lastPath) return;
    render(line);
  }

  return {
    init,
    updatePath,
    requestSymbols,
    updateCursor,
  };
}
