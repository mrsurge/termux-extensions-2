type JsonTextmateValue =
  | string
  | number
  | boolean
  | null
  | JsonTextmateValue[]
  | {
      [key: string]: JsonTextmateValue;
    };

type UnknownRecord = Record<string, unknown>;

interface Cm6Module {
  Decoration: {
    mark(spec: UnknownRecord): unknown;
  };
  EditorState: {
    create(spec: UnknownRecord): unknown;
  };
  EditorView: {
    new (spec: UnknownRecord): Cm6EditorView;
    decorations: { from(field: unknown): unknown };
    lineWrapping: unknown;
    theme(spec: UnknownRecord, options?: UnknownRecord): unknown;
    updateListener: { of(listener: (update: Cm6Update) => void): unknown };
  };
  RangeSetBuilder: new () => {
    add(from: number, to: number, value: unknown): void;
    finish(): unknown;
  };
  StateField: {
    define(spec: UnknownRecord): unknown;
  };
  bracketMatching?: () => unknown;
  defaultKeymap?: unknown[];
  history?: () => unknown;
  historyKeymap?: unknown[];
  highlightActiveLine?: () => unknown;
  highlightActiveLineGutter?: () => unknown;
  indentOnInput?: () => unknown;
  indentWithTab?: unknown;
  json?: () => unknown;
  keymap?: { of(bindings: unknown[]): unknown };
  lineNumbers?: () => unknown;
  search?: () => unknown;
  searchKeymap?: unknown[];
}

interface Cm6EditorView {
  state: {
    doc: {
      length: number;
      toString(): string;
    };
  };
  dispatch(spec: UnknownRecord): void;
  destroy(): void;
  focus(): void;
  setRoot?(root: Document | ShadowRoot): void;
}

interface Cm6Update {
  docChanged: boolean;
  state: {
    doc: {
      toString(): string;
    };
  };
}

interface TextmateToken {
  startIndex: number;
  endIndex: number;
  scopes?: string[];
}

interface TextmateGrammar {
  tokenizeLine(
    line: string,
    ruleStack: unknown,
  ): {
    tokens: TextmateToken[];
    ruleStack: unknown;
  };
}

interface TextmateGlobal {
  INITIAL: unknown;
  Registry: new (spec: UnknownRecord) => {
    loadGrammar(scopeName: string): Promise<TextmateGrammar | null>;
  };
}

interface OnigGlobal {
  loadWASM(data: ArrayBuffer): Promise<void>;
  createOnigScanner(sources: string[]): unknown;
  createOnigString(value: string): unknown;
}

interface JsonTextmateWindow extends Window {
  vscodetextmate?: TextmateGlobal;
  onig?: OnigGlobal;
}

interface ThemeRule {
  selector: string;
  className: string;
  specificity: number;
  index: number;
}

export interface JsonTextmateFieldHandle {
  element: HTMLElement;
  getValue: () => string;
  setValue: (value: unknown) => void;
  setInvalid: (invalid: boolean) => void;
  focus: () => void;
  destroy: () => void;
}

export interface JsonTextmateFieldOptions {
  value: unknown;
  rows?: number;
  placeholder?: string;
  className?: string;
  validateJson?: boolean;
  onChange?: (raw: string) => void;
  onJsonChange?: (value: JsonTextmateValue) => void;
  onValidityChange?: (valid: boolean, message?: string) => void;
}

const CM6_MODULE_URL = "/static/vendor/codemirror.1/codemirror.bundle.js";
const APP_ASSET_BASE = "/apps/code_te2";
const TEXTMATE_UI_BASE = "/api/app/code_te2/ui/monaco_editor/textmate";
const TEXTMATE_SCRIPT_URL = `${APP_ASSET_BASE}/vendor/vscode-textmate/release/main.js`;
const ONIG_SCRIPT_URL = `${APP_ASSET_BASE}/vendor/vscode-oniguruma/release/main.js`;
const JSON_GRAMMAR_URL = `${TEXTMATE_UI_BASE}/grammars/json.JSON.tmLanguage.json`;
const GITHUB_DARK_THEME_URL = `${TEXTMATE_UI_BASE}/themes/github-dark-default.vscode.json`;
const ONIG_WASM_URL = `${TEXTMATE_UI_BASE}/onig.wasm`;
const TOKEN_STYLE_ID = "cm6-json-textmate-token-styles";
const MODAL_REPARENT_EVENT = "te2:modal-surface-reparented";

let cm6Promise: Promise<Cm6Module> | null = null;
let textmatePromise: Promise<{
  grammar: TextmateGrammar;
  textmate: TextmateGlobal;
  theme: UnknownRecord;
  tokenRules: ThemeRule[];
}> | null = null;
const scriptPromises = new Map<string, Promise<void>>();
let tokenStyleCss = "";

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceEditorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function nextAnimationFrame(targetWindow: Window = window): Promise<void> {
  return new Promise((resolve) =>
    targetWindow.requestAnimationFrame(() => resolve()),
  );
}

async function waitForStableEditorRect(
  host: HTMLElement,
  shouldStop: () => boolean,
): Promise<boolean> {
  while (!shouldStop()) {
    if (shouldStop()) return false;
    const rect = host.getBoundingClientRect();
    if (host.isConnected && rect.width > 0 && rect.height > 0) {
      const targetWindow = host.ownerDocument.defaultView || window;
      await nextAnimationFrame(targetWindow);
      if (shouldStop()) return false;
      const settled = host.getBoundingClientRect();
      return settled.width > 0 && settled.height > 0;
    }
    const targetWindow = host.ownerDocument.defaultView || window;
    await new Promise((resolve) => targetWindow.setTimeout(resolve, 80));
  }
  return false;
}

function hasFiniteMeasurement(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasPositiveMeasurement(value: unknown): boolean {
  return hasFiniteMeasurement(value) && value > 0;
}

function editorMeasurementLooksValid(view: Cm6EditorView): boolean {
  const candidate = view as unknown as {
    viewState?: {
      visibleTop?: unknown;
      visibleBottom?: unknown;
      heightMap?: { height?: unknown };
      heightOracle?: { textHeight?: unknown; charWidth?: unknown };
    };
    requestMeasure?: () => void;
  };
  const viewState = candidate.viewState;
  if (!viewState) return true;
  const oracle = viewState.heightOracle;
  const heightMap = viewState.heightMap;
  return (
    hasFiniteMeasurement(viewState.visibleTop) &&
    hasFiniteMeasurement(viewState.visibleBottom) &&
    hasFiniteMeasurement(heightMap?.height) &&
    hasPositiveMeasurement(oracle?.textHeight) &&
    hasPositiveMeasurement(oracle?.charWidth)
  );
}

async function waitForValidEditorMeasurement(
  view: Cm6EditorView,
  host: HTMLElement,
  shouldStop: () => boolean,
): Promise<boolean> {
  const measurableView = view as unknown as { requestMeasure?: () => void };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (shouldStop()) return false;
    measurableView.requestMeasure?.();
    await nextAnimationFrame(host.ownerDocument.defaultView || window);
    if (shouldStop()) return false;
    if (editorMeasurementLooksValid(view)) return true;
  }
  return false;
}

function editorMeasurementSnapshot(view: Cm6EditorView): UnknownRecord {
  const candidate = view as unknown as {
    viewState?: {
      visibleTop?: unknown;
      visibleBottom?: unknown;
      heightMap?: { height?: unknown };
      heightOracle?: { textHeight?: unknown; charWidth?: unknown };
    };
  };
  const viewState = candidate.viewState;
  return {
    visibleTop: viewState?.visibleTop,
    visibleBottom: viewState?.visibleBottom,
    height: viewState?.heightMap?.height,
    textHeight: viewState?.heightOracle?.textHeight,
    charWidth: viewState?.heightOracle?.charWidth,
  };
}

function dynamicImport(specifier: string): Promise<unknown> {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<unknown>;
  return importer(specifier);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const previous = document.querySelector<HTMLScriptElement>(
      `script[data-cm6-json-textmate="${src}"]`,
    );
    if (previous) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.cm6JsonTextmate = src;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

async function loadCm6(): Promise<Cm6Module> {
  if (!cm6Promise) {
    cm6Promise = dynamicImport(CM6_MODULE_URL).then((mod) => mod as Cm6Module);
  }
  return cm6Promise;
}

function colorFromTheme(
  theme: UnknownRecord,
  key: string,
  fallback: string,
): string {
  const colors = isRecord(theme.colors) ? theme.colors : {};
  return asString(colors[key]) || fallback;
}

function parseThemeRules(theme: UnknownRecord): ThemeRule[] {
  const rules: ThemeRule[] = [];
  const classByStyle = new Map<string, string>();
  const cssRules: string[] = [];
  asArray(theme.tokenColors).forEach((item, index) => {
    if (!isRecord(item) || !isRecord(item.settings)) return;
    const foreground = asString(item.settings.foreground);
    const background = asString(item.settings.background);
    const fontStyle = asString(item.settings.fontStyle);
    if (!foreground && !background && !fontStyle) return;
    const rawScope = item.scope;
    const scopes =
      typeof rawScope === "string"
        ? rawScope
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : Array.isArray(rawScope)
          ? rawScope.map((scope) => String(scope).trim()).filter(Boolean)
          : [];
    if (!scopes.length) return;

    const styleKey = `${foreground}|${background}|${fontStyle}`;
    let className = classByStyle.get(styleKey);
    if (!className) {
      className = `cm6-json-tm-${classByStyle.size}`;
      classByStyle.set(styleKey, className);
      const declarations: string[] = [];
      if (foreground) declarations.push(`color: ${foreground}`);
      if (background) declarations.push(`background-color: ${background}`);
      if (fontStyle.includes("italic")) declarations.push("font-style: italic");
      if (fontStyle.includes("bold")) declarations.push("font-weight: 700");
      if (fontStyle.includes("underline"))
        declarations.push("text-decoration: underline");
      cssRules.push(
        `.cm6-json-textmate .${className}{${declarations.join(";")}}`,
      );
    }

    scopes.forEach((selector) => {
      rules.push({
        selector,
        className,
        specificity: selector.replace(/\s+/g, "").length,
        index,
      });
    });
  });

  tokenStyleCss = cssRules.join("\n");
  ensureTokenStyle(tokenStyleCss);
  return rules;
}

function ensureTokenStyle(
  cssText: string,
  targetDocument: Document = document,
): void {
  if (!cssText) return;
  let styleEl = targetDocument.getElementById(
    TOKEN_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = targetDocument.createElement("style");
    styleEl.id = TOKEN_STYLE_ID;
    targetDocument.head.appendChild(styleEl);
  }
  styleEl.textContent = cssText;
}

export function syncJsonTextmateEditorRoot(
  view: { setRoot?: (root: Document | ShadowRoot) => void } | null,
  host: HTMLElement,
  cssText: string = tokenStyleCss,
): void {
  ensureTokenStyle(cssText, host.ownerDocument);
  view?.setRoot?.(host.ownerDocument);
}

async function loadTextmate(): Promise<{
  grammar: TextmateGrammar;
  textmate: TextmateGlobal;
  theme: UnknownRecord;
  tokenRules: ThemeRule[];
}> {
  if (!textmatePromise) {
    textmatePromise = (async () => {
      const win = window as JsonTextmateWindow;
      if (!win.vscodetextmate) await loadScript(TEXTMATE_SCRIPT_URL);
      if (!win.onig) await loadScript(ONIG_SCRIPT_URL);
      const textmate = win.vscodetextmate;
      const onig = win.onig;
      if (!textmate?.Registry || !onig?.loadWASM) {
        throw new Error("TextMate runtime did not register browser globals");
      }

      const [wasmResponse, grammarJson, themeJson] = await Promise.all([
        fetch(ONIG_WASM_URL, { cache: "force-cache" }),
        fetchJson(JSON_GRAMMAR_URL),
        fetchJson(GITHUB_DARK_THEME_URL),
      ]);
      if (!wasmResponse.ok)
        throw new Error(`onig.wasm HTTP ${wasmResponse.status}`);
      await onig.loadWASM(await wasmResponse.arrayBuffer());

      const registry = new textmate.Registry({
        onigLib: Promise.resolve({
          createOnigScanner(sources: string[]) {
            return onig.createOnigScanner(sources);
          },
          createOnigString(value: string) {
            return onig.createOnigString(value);
          },
        }),
        loadGrammar(scopeName: string) {
          return Promise.resolve(
            scopeName === "source.json" ? grammarJson : null,
          );
        },
      });
      const grammar = await registry.loadGrammar("source.json");
      if (!grammar) throw new Error("JSON TextMate grammar unavailable");
      const theme = isRecord(themeJson) ? themeJson : {};
      return {
        grammar,
        textmate,
        theme,
        tokenRules: parseThemeRules(theme),
      };
    })();
  }
  const loaded = textmatePromise;
  if (!loaded) throw new Error("TextMate runtime failed to initialize");
  return loaded;
}

function selectorMatches(scopes: string[], selector: string): boolean {
  const selectorParts = selector.split(/\s+/).filter(Boolean);
  if (!selectorParts.length) return false;
  let offset = 0;
  for (const part of selectorParts) {
    let matched = false;
    for (let index = offset; index < scopes.length; index += 1) {
      const scope = scopes[index] || "";
      if (scope === part || scope.startsWith(`${part}.`)) {
        offset = index + 1;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function fallbackClass(scopes: string[]): string {
  const joined = scopes.join(" ");
  if (joined.includes("support.type.property-name.json"))
    return "cm6-json-fallback-property";
  if (joined.includes("string")) return "cm6-json-fallback-string";
  if (
    joined.includes("constant.numeric") ||
    joined.includes("constant.language")
  ) {
    return "cm6-json-fallback-constant";
  }
  if (joined.includes("invalid")) return "cm6-json-fallback-invalid";
  return "";
}

function classForScopes(
  scopes: string[] | undefined,
  tokenRules: ThemeRule[],
): string {
  if (!scopes?.length) return "";
  let best: ThemeRule | null = null;
  for (const rule of tokenRules) {
    if (!selectorMatches(scopes, rule.selector)) continue;
    if (
      !best ||
      rule.specificity > best.specificity ||
      (rule.specificity === best.specificity && rule.index > best.index)
    ) {
      best = rule;
    }
  }
  return best ? best.className : fallbackClass(scopes);
}

function createTextmateDecorations(
  CM: Cm6Module,
  grammar: TextmateGrammar,
  initialRuleStack: unknown,
  tokenRules: ThemeRule[],
): unknown {
  function build(doc: string): unknown {
    const builder = new CM.RangeSetBuilder();
    let offset = 0;
    let ruleStack = initialRuleStack;
    const lines = doc.split("\n");
    for (const line of lines) {
      const result = grammar.tokenizeLine(line, ruleStack);
      result.tokens.forEach((token) => {
        if (token.endIndex <= token.startIndex) return;
        const className = classForScopes(token.scopes, tokenRules);
        if (!className) return;
        builder.add(
          offset + token.startIndex,
          offset + token.endIndex,
          CM.Decoration.mark({ class: className }),
        );
      });
      ruleStack = result.ruleStack;
      offset += line.length + 1;
    }
    return builder.finish();
  }

  return CM.StateField.define({
    create(state: { doc: { toString(): string } }) {
      return build(state.doc.toString());
    },
    update(
      value: unknown,
      tr: { docChanged: boolean; newDoc: { toString(): string } },
    ) {
      return tr.docChanged ? build(tr.newDoc.toString()) : value;
    },
    provide(field: unknown) {
      return CM.EditorView.decorations.from(field);
    },
  });
}

function createGithubDarkTheme(
  CM: Cm6Module,
  theme: UnknownRecord,
  rows: number,
): unknown {
  const background = colorFromTheme(theme, "editor.background", "#0d1117");
  const foreground = colorFromTheme(theme, "editor.foreground", "#e6edf3");
  const border = colorFromTheme(theme, "dropdown.border", "#30363d");
  const gutter = colorFromTheme(
    theme,
    "editorLineNumber.foreground",
    "#6e7681",
  );
  const activeGutter = colorFromTheme(
    theme,
    "editorLineNumber.activeForeground",
    "#e6edf3",
  );
  const cursor = colorFromTheme(theme, "editorCursor.foreground", "#2f81f7");
  const selection = colorFromTheme(
    theme,
    "editor.selectionBackground",
    "#388bfd66",
  );
  const lineHighlight = colorFromTheme(
    theme,
    "editor.lineHighlightBackground",
    "#6e76811a",
  );
  const minHeight = `${Math.max(120, rows * 21)}px`;

  return CM.EditorView.theme(
    {
      "&": {
        backgroundColor: background,
        color: foreground,
        border: `1px solid ${border}`,
        borderRadius: "6px",
        fontSize: "12px",
        overflow: "hidden",
      },
      "&.cm-focused": {
        outline: "1px solid #1f6feb",
      },
      ".cm-scroller": {
        fontFamily:
          '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
        lineHeight: "1.45",
        minHeight,
      },
      ".cm-content": {
        caretColor: cursor,
        minHeight,
        padding: "8px 0",
      },
      ".cm-cursor": {
        borderLeftColor: cursor,
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: selection,
      },
      ".cm-activeLine": {
        backgroundColor: lineHighlight,
      },
      ".cm-gutters": {
        backgroundColor: background,
        borderRight: `1px solid ${border}`,
        color: gutter,
      },
      ".cm-activeLineGutter": {
        backgroundColor: lineHighlight,
        color: activeGutter,
      },
      ".cm-line": {
        padding: "0 8px",
      },
      ".cm6-json-fallback-property": { color: "#7ee787" },
      ".cm6-json-fallback-string": { color: "#a5d6ff" },
      ".cm6-json-fallback-constant": { color: "#79c0ff" },
      ".cm6-json-fallback-invalid": { color: "#ffa198" },
    },
    { dark: true },
  );
}

function validateJson(raw: string):
  | { ok: true; value: JsonTextmateValue }
  | {
      ok: false;
      message: string;
    } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonTextmateValue };
  } catch (error) {
    return {
      ok: false,
      message: (error as { message?: string })?.message || "Invalid JSON",
    };
  }
}

export function createJsonTextmateField(
  options: JsonTextmateFieldOptions,
): JsonTextmateFieldHandle {
  let currentValue = coerceEditorText(options.value);
  let view: Cm6EditorView | null = null;
  let destroyed = false;
  let suppressChange = false;
  const lifecycleWindow = window;

  const host = document.createElement("div");
  host.className = "cm6-json-textmate-field";
  if (options.className) host.classList.add(options.className);

  const textarea = document.createElement("textarea");
  textarea.className =
    "declarative-input declarative-monospace cm6-json-textmate-fallback";
  textarea.rows = options.rows || 8;
  textarea.spellcheck = false;
  textarea.placeholder = options.placeholder || "";
  textarea.value = currentValue;
  host.appendChild(textarea);

  const handleModalReparent = (event: Event): void => {
    const detail = (event as CustomEvent<{ element?: Element }>).detail;
    const surface = detail?.element;
    if (!surface || (surface !== host && !surface.contains(host))) return;
    syncJsonTextmateEditorRoot(view, host);
  };
  lifecycleWindow.addEventListener(MODAL_REPARENT_EVENT, handleModalReparent);

  function setInvalid(invalid: boolean): void {
    host.classList.toggle("is-invalid", invalid);
    textarea.classList.toggle("declarative-field-invalid", invalid);
  }

  function emitValue(raw: string): void {
    currentValue = raw;
    options.onChange?.(raw);
    if (!options.validateJson) return;
    const parsed = validateJson(raw);
    setInvalid(!parsed.ok);
    options.onValidityChange?.(
      parsed.ok,
      parsed.ok ? undefined : parsed.message,
    );
    if (parsed.ok) options.onJsonChange?.(parsed.value);
  }

  textarea.addEventListener("input", () => emitValue(textarea.value));
  if (options.validateJson) {
    const parsed = validateJson(currentValue);
    setInvalid(!parsed.ok);
    options.onValidityChange?.(
      parsed.ok,
      parsed.ok ? undefined : parsed.message,
    );
  }

  // Lazy-load the editor system only when a JSON modal field actually mounts.
  void (async () => {
    try {
      const hasStableRect = await waitForStableEditorRect(host, () => destroyed);
      if (!hasStableRect) return;
      const [CM, tm] = await Promise.all([loadCm6(), loadTextmate()]);
      if (destroyed) return;
      ensureTokenStyle(tokenStyleCss, host.ownerDocument);
      const extensions: unknown[] = [
        CM.history?.(),
        CM.search?.(),
        CM.keymap?.of([
          ...(CM.indentWithTab ? [CM.indentWithTab] : []),
          ...asArray(CM.defaultKeymap),
          ...asArray(CM.historyKeymap),
          ...asArray(CM.searchKeymap),
        ]),
        CM.lineNumbers?.(),
        CM.highlightActiveLine?.(),
        CM.highlightActiveLineGutter?.(),
        CM.bracketMatching?.(),
        CM.indentOnInput?.(),
        CM.json?.(),
        CM.EditorView.lineWrapping,
        createGithubDarkTheme(CM, tm.theme, options.rows || 8),
        createTextmateDecorations(
          CM,
          tm.grammar,
          tm.textmate.INITIAL,
          tm.tokenRules,
        ),
        CM.EditorView.updateListener.of((update: Cm6Update) => {
          if (!update.docChanged) return;
          const raw = update.state.doc.toString();
          if (suppressChange) {
            suppressChange = false;
            currentValue = raw;
            return;
          }
          emitValue(raw);
        }),
      ].filter(Boolean);

      host.classList.add("cm6-json-textmate");
      host.innerHTML = "";
      view = new CM.EditorView({
        state: CM.EditorState.create({
          doc: currentValue,
          extensions,
        }),
        parent: host,
      });
      const measurementsSettled = await waitForValidEditorMeasurement(
        view,
        host,
        () => destroyed,
      );
      if (destroyed || !view) return;
      if (!measurementsSettled) {
        console.warn(
          "[cm6-json-textmate] falling back after unstable editor measurement",
          editorMeasurementSnapshot(view),
        );
        view.destroy();
        view = null;
        host.classList.remove("cm6-json-textmate");
        host.innerHTML = "";
        host.appendChild(textarea);
      }
    } catch (error) {
      console.warn("[cm6-json-textmate] falling back to textarea", error);
    }
  })();

  return {
    element: host,
    getValue: () => (view ? view.state.doc.toString() : textarea.value),
    setValue(value: unknown) {
      currentValue = coerceEditorText(value);
      textarea.value = currentValue;
      if (view) {
        suppressChange = true;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: currentValue,
          },
        });
      }
      if (options.validateJson) {
        const parsed = validateJson(currentValue);
        setInvalid(!parsed.ok);
        options.onValidityChange?.(
          parsed.ok,
          parsed.ok ? undefined : parsed.message,
        );
      }
    },
    setInvalid,
    focus() {
      if (view) view.focus();
      else textarea.focus();
    },
    destroy() {
      destroyed = true;
      lifecycleWindow.removeEventListener(
        MODAL_REPARENT_EVENT,
        handleModalReparent,
      );
      view?.destroy();
      view = null;
      host.remove();
    },
  };
}
