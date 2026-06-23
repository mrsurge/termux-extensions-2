import { EDITOR_RPC_METHODS } from "./editor_rpc_contract.ts";

interface EditorBreadcrumbRuntimeDeps {
  getDocument(): Document | null;
  getEditor(): BreadcrumbEditorLike | null;
  getCurrentPath(): string | null;
  getModel(): unknown;
  notifyEditorRpc(method: string, payload: Record<string, unknown>): boolean;
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

interface BreadcrumbDisposableLike {
  dispose?(): void;
}

interface BreadcrumbEditorLike {
  getPosition?(): { lineNumber?: unknown; column?: unknown } | null;
  getModel?(): unknown;
  onDidChangeModelContent?(listener: () => void): BreadcrumbDisposableLike;
}

interface BreadcrumbIconModule {
  ensureLoaded(): void;
  getIcon: (...args: unknown[]) => unknown;
}

interface BreadcrumbIconResult {
  svg?: string;
  color?: string;
}

interface BreadcrumbLineBounds {
  startLine: number;
  endLine: number;
}

interface BreadcrumbLspPointLike {
  line?: unknown;
  character?: unknown;
}

interface BreadcrumbSymbolRangeObjectLike {
  startLineNumber?: unknown;
  endLineNumber?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  startColumn?: unknown;
  start?: BreadcrumbLspPointLike | null;
  end?: BreadcrumbLspPointLike | null;
  [key: string]: unknown;
}

type BreadcrumbSymbolRangeLike =
  | BreadcrumbSymbolRangeObjectLike
  | unknown[]
  | null
  | undefined;

interface BreadcrumbSymbolLike {
  kind?: unknown;
  name?: unknown;
  selectionRange?: BreadcrumbSymbolRangeLike;
  range?: BreadcrumbSymbolRangeLike;
  children?: BreadcrumbSymbolLike[] | null;
  location?: { range?: BreadcrumbSymbolRangeLike } | null;
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

interface BreadcrumbModelLike {
  uri?: { toString(): string };
  getLanguageId?(): string;
  getVersionId?(): number;
  isDisposed?(): boolean;
  [key: string]: unknown;
}

interface BreadcrumbRuntime {
  init(): void;
  bindEditor(): void;
  updatePath(absPath: string | null | undefined, deferSymbols?: boolean): void;
  requestSymbols(
    absPath: string,
    opts?: { generation?: number; fromQueue?: boolean; reason?: string },
  ): void;
  updateCursor(line?: number): void;
}

const SYMBOL_ICON_MAP: Record<number, [string, string]> = {
  1: ["codicon-symbol-file", "#8b949e"],
  2: ["codicon-symbol-module", "#bc8cff"],
  3: ["codicon-symbol-namespace", "#bc8cff"],
  4: ["codicon-symbol-package", "#f0883e"],
  5: ["codicon-symbol-class", "#f0883e"],
  6: ["codicon-symbol-method", "#bc8cff"],
  7: ["codicon-symbol-property", "#4da6ff"],
  8: ["codicon-symbol-field", "#4da6ff"],
  9: ["codicon-symbol-constructor", "#bc8cff"],
  10: ["codicon-symbol-enum", "#f0883e"],
  11: ["codicon-symbol-interface", "#4da6ff"],
  12: ["codicon-symbol-function", "#bc8cff"],
  13: ["codicon-symbol-variable", "#4da6ff"],
  14: ["codicon-symbol-constant", "#4da6ff"],
  15: ["codicon-symbol-string", "#f0883e"],
  16: ["codicon-symbol-number", "#a6e22e"],
  17: ["codicon-symbol-boolean", "#4da6ff"],
  18: ["codicon-symbol-array", "#f0883e"],
  19: ["codicon-symbol-object", "#8b949e"],
  22: ["codicon-symbol-enum-member", "#f0883e"],
  23: ["codicon-symbol-struct", "#f0883e"],
  25: ["codicon-symbol-operator", "#8b949e"],
  26: ["codicon-symbol-type-parameter", "#a6e22e"],
};

const LONG_TIMEOUT_LANG_IDS = new Set([
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBreadcrumbModel(value: unknown): BreadcrumbModelLike | null {
  return value != null && typeof value === "object"
    ? (value as BreadcrumbModelLike)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getModelUri(value: unknown): string {
  const model = asBreadcrumbModel(value);
  try {
    return model?.uri?.toString ? String(model.uri.toString()) : "";
  } catch (_) {
    return "";
  }
}

function getModelVersion(value: unknown): number | null {
  const model = asBreadcrumbModel(value);
  try {
    const version = model?.getVersionId?.();
    return typeof version === "number" && Number.isFinite(version)
      ? version
      : null;
  } catch (_) {
    return null;
  }
}

function modelIsDisposed(value: unknown): boolean {
  const model = asBreadcrumbModel(value);
  try {
    return !!model?.isDisposed?.();
  } catch (_) {
    return true;
  }
}

function initBreadcrumbElement(doc: Document): HTMLElement | null {
  return doc.getElementById("te2-breadcrumbs");
}

function loadBreadcrumbIcons(
  dynamicImportFn: (path: string) => Promise<BreadcrumbIconModule>,
  onLoaded: (getIcon: (...args: unknown[]) => unknown) => void,
  onError?: ((error: unknown) => void) | null,
): Promise<void> {
  return dynamicImportFn("/static/vendor/seti-icons/seti-icons.js")
    .then((mod) => {
      mod.ensureLoaded();
      onLoaded(mod.getIcon);
    })
    .catch((error) => {
      if (typeof onError === "function") onError(error);
    });
}

function shouldUpdateBreadcrumbPath(
  absPath: string | null | undefined,
  lastPath: string | null,
  deferSymbols?: boolean,
): boolean {
  if (!absPath) return false;
  if (absPath === lastPath && !deferSymbols) return false;
  return true;
}

function resolveBreadcrumbSymbolsLangId(
  model: unknown,
  absPath: string,
  languageFromPathFn: (path: string) => string,
): string {
  const languageModel = asBreadcrumbModel(model);
  let langId = languageModel?.getLanguageId?.() || "";
  if (!langId) langId = languageFromPathFn(absPath) || "";
  return langId;
}

function getBreadcrumbSymbolsTimeoutMs(langId: string): number {
  return LONG_TIMEOUT_LANG_IDS.has(langId) ? 15000 : 8000;
}

function unwrapBreadcrumbSymbols(result: unknown): unknown[] {
  let symbols = result;
  const envelope = asRecord(symbols);
  if (envelope) {
    symbols = envelope.result ?? envelope.symbols ?? [];
  }
  return Array.isArray(symbols) ? symbols : [];
}

function symbolRangeToLineBounds(
  rangeLike: BreadcrumbSymbolRangeLike,
): BreadcrumbLineBounds | null {
  if (!rangeLike) return null;
  if (Array.isArray(rangeLike) && rangeLike.length >= 3) {
    return {
      startLine: Number(rangeLike[0]) + 1,
      endLine: Number(rangeLike[2]) + 1,
    };
  }

  const range = rangeLike as BreadcrumbSymbolRangeObjectLike;
  const startLineNumber = asFiniteNumber(range.startLineNumber);
  if (startLineNumber != null) {
    return {
      startLine: startLineNumber,
      endLine: asFiniteNumber(range.endLineNumber) ?? 999999,
    };
  }
  const startLine = asFiniteNumber(range.start?.line);
  if (startLine != null) {
    return {
      startLine: startLine + 1,
      endLine:
        asFiniteNumber(range.end?.line) != null
          ? Number(range.end?.line) + 1
          : 999999,
    };
  }
  const legacyStartLine = asFiniteNumber(range.startLine);
  if (legacyStartLine != null) {
    return {
      startLine: legacyStartLine,
      endLine: asFiniteNumber(range.endLine) ?? 999999,
    };
  }
  return null;
}

function breadcrumbSymbolIcon(
  kind: unknown,
  symbolMap: Record<string | number, [string, string]>,
): string {
  const entry =
    typeof kind === "string" || typeof kind === "number"
      ? symbolMap[kind]
      : undefined;
  const cls = entry ? entry[0] : "codicon-symbol-misc";
  const color = entry ? entry[1] : "#8b949e";
  return `<span class="codicon ${cls}" style="color:${color};font-size:14px;line-height:1"></span>`;
}

function findBreadcrumbSymbolChain(
  sourceSymbols: BreadcrumbSymbolLike[] | null | undefined,
  line: number | undefined,
): BreadcrumbSymbolLike[] {
  if (typeof line !== "number" || !Number.isFinite(line)) return [];

  const chain: BreadcrumbSymbolLike[] = [];
  let current = Array.isArray(sourceSymbols) ? sourceSymbols : [];
  while (current.length > 0) {
    let found: BreadcrumbSymbolLike | null = null;
    for (const symbol of current) {
      const range = symbol.range || symbol.location?.range;
      if (!range) continue;
      const bounds = symbolRangeToLineBounds(range);
      if (!bounds) continue;
      if (line >= bounds.startLine && line <= bounds.endLine) {
        found = symbol;
        break;
      }
    }
    if (!found) break;
    chain.push(found);
    current = Array.isArray(found.children) ? found.children : [];
  }
  return chain;
}

function splitBreadcrumbPathParts(path: string | null | undefined): string[] {
  return String(path || "")
    .split("/")
    .filter(Boolean);
}

function appendBreadcrumbSeparator(doc: Document, parentEl: HTMLElement): void {
  const sep = doc.createElement("span");
  sep.className = "te2-bc-sep";
  sep.textContent = "\u203A";
  parentEl.appendChild(sep);
}

function isBreadcrumbFileSegment(index: number, total: number): boolean {
  return index === total - 1;
}

function createBreadcrumbPathItem(
  doc: Document,
  accumPath: string,
  isFile: boolean,
): HTMLSpanElement {
  const item = doc.createElement("span");
  item.className = "te2-bc-item";
  item.dataset.path = accumPath;
  item.dataset.isFile = isFile ? "1" : "0";
  return item;
}

function getBreadcrumbIconTheme(): Record<string, string> {
  return {
    blue: "#4da6ff",
    green: "#a6e22e",
    red: "#f85149",
    orange: "#f0883e",
    yellow: "#e3b341",
    purple: "#bc8cff",
    pink: "#f778ba",
    white: "#e6edf3",
    grey: "#8b949e",
    "grey-light": "#b1bac4",
    ignore: "#6e7681",
  };
}

function applyBreadcrumbFileIcon(
  getIconFn: (name: string, theme: Record<string, string>) => unknown,
  iconSpan: HTMLElement,
  name: string,
  theme: Record<string, string>,
): void {
  Promise.resolve(getIconFn(name, theme))
    .then((icon) => {
      const result =
        icon && typeof icon === "object"
          ? (icon as BreadcrumbIconResult)
          : null;
      if (result?.svg) iconSpan.innerHTML = result.svg;
      if (result?.color) iconSpan.style.color = result.color;
    })
    .catch(() => {});
}

function shouldRenderBreadcrumbSymbolChain(
  sourceSymbols: unknown[] | null | undefined,
  cursorLine: number | undefined,
): boolean {
  return !!(
    Array.isArray(sourceSymbols) &&
    sourceSymbols.length > 0 &&
    typeof cursorLine === "number" &&
    cursorLine > 0
  );
}

function getBreadcrumbSymbolPosition(symRange: BreadcrumbSymbolRangeLike): {
  line: number;
  col: number;
} {
  if (!symRange) return { line: 1, col: 1 };
  if (Array.isArray(symRange) && symRange.length >= 2) {
    return {
      line: Number(symRange[0]) + 1,
      col: Number(symRange[1]) + 1,
    };
  }

  const range = symRange as BreadcrumbSymbolRangeObjectLike;
  const startLine =
    asFiniteNumber(range.startLineNumber) ??
    asFiniteNumber(range.startLine) ??
    (asFiniteNumber(range.start?.line) != null
      ? Number(range.start?.line) + 1
      : null) ??
    1;
  const startCol =
    asFiniteNumber(range.startColumn) ??
    (asFiniteNumber(range.start?.character) != null
      ? Number(range.start?.character) + 1
      : null) ??
    1;
  return { line: startLine, col: startCol };
}

function createBreadcrumbSymbolItem(
  doc: Document,
  chainItem: BreadcrumbSymbolLike,
  idx: number,
  iconHtml: string,
): HTMLSpanElement {
  const item = doc.createElement("span");
  item.className = "te2-bc-item";

  const icon = doc.createElement("span");
  icon.className = "te2-bc-sym-icon";
  icon.innerHTML = iconHtml;
  item.appendChild(icon);

  const label = doc.createElement("span");
  label.textContent = typeof chainItem.name === "string" ? chainItem.name : "";
  item.appendChild(label);

  item.dataset.symIdx = String(idx);
  return item;
}

function finalizeBreadcrumbScroll(el: HTMLElement): void {
  el.scrollLeft = el.scrollWidth;
}

function getBreadcrumbPathClickTarget(event: Event): BreadcrumbPathClickTarget {
  const el =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  return {
    isFile: el?.dataset.isFile === "1",
    absDir: el?.dataset.path || "",
  };
}

function getBreadcrumbSymbolClickPosition(
  event: Event,
): BreadcrumbSymbolClickPosition {
  const el =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const line = Number.parseInt(el?.dataset.line || "", 10);
  const col = Number.parseInt(el?.dataset.col || "", 10) || 1;
  return { line, col };
}

export function createEditorBreadcrumbRuntime(
  deps: EditorBreadcrumbRuntimeDeps,
): BreadcrumbRuntime {
  let element: HTMLElement | null = null;
  let symbols: BreadcrumbSymbolLike[] = [];
  let lastPath: string | null = null;
  let lastCursorLine: number | undefined;
  let symbolsSeq = 0;
  let contentRefreshInFlight = false;
  let contentRefreshQueued = false;
  let boundEditor: BreadcrumbEditorLike | null = null;
  let contentDisposable: BreadcrumbDisposableLike | null = null;
  let getIcon:
    | ((
        name: string,
        theme: Record<string, string>,
      ) => Promise<unknown> | unknown)
    | null = null;

  function renderSymbolIcon(kind: unknown): string {
    return breadcrumbSymbolIcon(kind, SYMBOL_ICON_MAP);
  }

  function currentCursorLine(): number | undefined {
    const line = deps.getEditor()?.getPosition?.()?.lineNumber;
    return typeof line === "number" && Number.isFinite(line)
      ? line
      : lastCursorLine;
  }

  function render(cursorLine: number | undefined = currentCursorLine()): void {
    if (!element) return;
    element.innerHTML = "";
    if (!lastPath) return;

    const doc = deps.getDocument();
    if (!doc) return;

    const parts = splitBreadcrumbPathParts(lastPath);
    let accum = "";
    for (let index = 0; index < parts.length; index += 1) {
      accum += "/" + parts[index];
      if (index > 0) {
        appendBreadcrumbSeparator(doc, element);
      }
      const isFile = isBreadcrumbFileSegment(index, parts.length);
      const item = createBreadcrumbPathItem(doc, accum, isFile);
      if (isFile && getIcon) {
        const iconSpan = doc.createElement("span");
        iconSpan.className = "te2-bc-icon";
        item.appendChild(iconSpan);
        applyBreadcrumbFileIcon(
          getIcon,
          iconSpan,
          parts[index],
          getBreadcrumbIconTheme(),
        );
      }
      const label = doc.createElement("span");
      label.textContent = parts[index];
      item.appendChild(label);
      item.addEventListener("click", onPathClick);
      element.appendChild(item);
    }

    if (shouldRenderBreadcrumbSymbolChain(symbols, cursorLine)) {
      const chain = findBreadcrumbSymbolChain(symbols, cursorLine);
      for (let index = 0; index < chain.length; index += 1) {
        appendBreadcrumbSeparator(doc, element);
        const symbolItem = createBreadcrumbSymbolItem(
          doc,
          chain[index],
          index,
          renderSymbolIcon(chain[index].kind),
        );
        const symbolRange = chain[index].selectionRange || chain[index].range;
        if (symbolRange) {
          const pos = getBreadcrumbSymbolPosition(symbolRange);
          symbolItem.dataset.line = String(pos.line);
          symbolItem.dataset.col = String(pos.col);
        }
        symbolItem.addEventListener("click", onSymbolClick);
        element.appendChild(symbolItem);
      }
    }

    finalizeBreadcrumbScroll(element);
  }

  function onPathClick(event: Event): void {
    try {
      const target = getBreadcrumbPathClickTarget(event);
      if (target.isFile) return;
      const sent = deps.notifyEditorRpc(EDITOR_RPC_METHODS.breadcrumbNavigate, {
        path: target.absDir,
        open_drawer: true,
      });
      console.log("[BC] path click:", target.absDir, "rpc sent:", sent);
    } catch (_) {}
  }

  function onSymbolClick(event: Event): void {
    try {
      const pos = getBreadcrumbSymbolClickPosition(event);
      const line = asNumber(pos.line, NaN);
      const col = asNumber(pos.col, 1);
      if (Number.isFinite(line)) {
        deps.applyJumpToLine(line, col);
      }
    } catch (_) {}
  }

  function queueContentRefresh(): void {
    const currentPath = asString(deps.getCurrentPath());
    if (!currentPath || currentPath !== lastPath) return;
    if (contentRefreshInFlight) {
      contentRefreshQueued = true;
      return;
    }

    contentRefreshInFlight = true;
    requestSymbolsNow(currentPath, {
      generation: deps.wbCurrentGeneration(),
      reason: "content",
    }).finally(() => {
      contentRefreshInFlight = false;
      if (!contentRefreshQueued) return;
      contentRefreshQueued = false;
      queueContentRefresh();
    });
  }

  function bindEditor(): void {
    const nextEditor = deps.getEditor();
    if (nextEditor === boundEditor) return;
    try {
      contentDisposable?.dispose?.();
    } catch (_) {}
    contentDisposable = null;
    boundEditor = nextEditor || null;
    if (
      !boundEditor ||
      typeof boundEditor.onDidChangeModelContent !== "function"
    )
      return;
    contentDisposable = boundEditor.onDidChangeModelContent(() => {
      queueContentRefresh();
    });
  }

  function init(): void {
    const doc = deps.getDocument();
    if (!doc) return;
    element = initBreadcrumbElement(doc);
    bindEditor();
    loadBreadcrumbIcons(
      (path: string) => import(path),
      (nextGetIcon: (...args: unknown[]) => unknown) => {
        getIcon = (name: string, theme: Record<string, string>) =>
          nextGetIcon(name, theme);
        if (lastPath) render();
      },
      (error: unknown) => {
        console.warn("[BC] seti-icons load failed:", error);
      },
    );
  }

  function updatePath(
    absPath: string | null | undefined,
    deferSymbols?: boolean,
  ): void {
    if (!element) return;
    bindEditor();
    const nextPath = asString(absPath);
    if (!shouldUpdateBreadcrumbPath(nextPath, lastPath, deferSymbols)) return;
    lastPath = nextPath;
    symbols = [];
    contentRefreshQueued = false;
    render();
    if (!deferSymbols && nextPath) {
      requestSymbols(nextPath);
    }
  }

  function requestSymbols(
    absPath: string,
    opts?: { generation?: number; fromQueue?: boolean; reason?: string },
  ): void {
    void requestSymbolsNow(absPath, opts);
  }

  function requestSymbolsNow(
    absPath: string,
    opts?: { generation?: number; fromQueue?: boolean; reason?: string },
  ): Promise<void> {
    bindEditor();
    const generation =
      opts && Number.isFinite(Number(opts.generation))
        ? Number(opts.generation)
        : deps.wbCurrentGeneration();
    if (!deps.wbIsBarrierOpen(absPath, generation)) {
      deps.wbQueueSymbols(absPath, generation);
      return Promise.resolve();
    }

    const seq = ++symbolsSeq;
    const requestModel = deps.getModel();
    const requestModelUri = getModelUri(requestModel);
    const requestModelVersion = getModelVersion(requestModel);
    const reason = String(opts?.reason || "");
    const langId = resolveBreadcrumbSymbolsLangId(
      requestModel,
      absPath,
      deps.languageFromPath,
    );
    if (langId === "plaintext") {
      symbols = [];
      render();
      return Promise.resolve();
    }

    const timeoutMs = getBreadcrumbSymbolsTimeoutMs(langId);
    return deps
      .editorWorkbenchCall(
        "symbols",
        {
          path: absPath,
          languageId: langId,
          generation,
        },
        { timeoutMs },
      )
      .then((result) => {
        if (seq !== symbolsSeq) return;
        if (generation !== deps.wbCurrentGeneration()) return;
        if (String(absPath || "") !== String(deps.getCurrentPath() || ""))
          return;
        const currentModel = deps.getModel();
        if (!currentModel) return;
        if (requestModel && requestModel !== currentModel) return;
        if (requestModelUri && requestModelUri !== getModelUri(currentModel))
          return;
        if (modelIsDisposed(currentModel)) return;
        const currentModelVersion = getModelVersion(currentModel);
        if (
          requestModelVersion != null &&
          currentModelVersion != null &&
          requestModelVersion !== currentModelVersion
        ) {
          queueContentRefresh();
          return;
        }
        symbols = asArray<BreadcrumbSymbolLike>(
          unwrapBreadcrumbSymbols(result),
        );
        console.log(
          "[BC] symbols received:",
          symbols.length,
          symbols.slice(0, 2),
        );
        render(currentCursorLine());
      })
      .catch((error) => {
        if (reason !== "content")
          console.warn("[BC] symbols request failed:", error);
      });
  }

  function updateCursor(line?: number): void {
    if (!element || !lastPath) return;
    lastCursorLine =
      typeof line === "number" && Number.isFinite(line) ? line : lastCursorLine;
    bindEditor();
    render(lastCursorLine);
  }

  return {
    init,
    bindEditor,
    updatePath,
    requestSymbols,
    updateCursor,
  };
}
