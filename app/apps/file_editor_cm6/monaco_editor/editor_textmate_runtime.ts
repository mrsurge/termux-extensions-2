/*
 * Workbench-based TextMate runtime for TE2.
 * Source lineage:
 * - VS Code workbench TextMate grammar factory and tokenization support
 * - TE2 WBA grammar transport
 */

import { URI } from '../../../static/vendor/monaco-editor-core/esm/vs/base/common/uri.js';
import * as vscodeTextmate from '../vendor/vscode-textmate';
import * as vscodeOniguruma from '../vendor/vscode-oniguruma';
import { resolveMonacoLanguageId } from './editor_language_utils.ts';
import { TMGrammarFactory, missingTMGrammarErrorMessage } from './vscode_workbench_textmate_vendor/TMGrammarFactory.js';
import {
  IValidEmbeddedLanguagesMap,
  IValidGrammarDefinition,
  IValidTokenTypeMap,
  standardTokenTypeFromString,
} from './vscode_workbench_textmate_vendor/TMScopeRegistry.js';

interface WindowTextmateLike extends Window {
  onig?: {
    loadWASM?(buffer: ArrayBuffer): Promise<void>;
    OnigScanner?: new (sources: string[]) => unknown;
    OnigString?: new (value: string) => unknown;
  };
  vscodetextmate?: {
    INITIAL?: unknown;
  };
  monaco?: {
    editor?: {
      getModels?(): Array<{ resetTokenization?(): void }>;
    };
    languages?: {
      setColorMap?(colorMap: string[]): void;
      getLanguages?(): Array<{ id?: string; aliases?: string[] }>;
      register?(desc: Record<string, unknown>): void;
      setTokensProvider?(languageId: string, provider: Record<string, unknown>): void;
      getEncodedLanguageId?(languageId: string): number;
    };
  };
}

interface VscodeGrammarListItem {
  id: string;
  scopeName: string;
  language: string | null;
  extensionId?: string;
  embeddedLanguages?: Record<string, string>;
  tokenTypes?: Record<string, string>;
  injectTo?: string[];
  balancedBracketScopes?: string[];
  unbalancedBracketScopes?: string[];
}

interface VscodeGrammarByScopeEntry extends VscodeGrammarListItem {
  location: URI;
}

interface VscodeGrammarByLanguageEntry {
  preferred: string | null;
  scopes: string[];
}

interface VscodeGrammarIndexLike {
  byScope: Record<string, VscodeGrammarByScopeEntry>;
  byLanguage: Record<string, VscodeGrammarByLanguageEntry>;
  byLocation: Record<string, string>;
}

interface TextmateRuntimeDeps {
  getWindow(): WindowTextmateLike;
  getApiBase(): string;
  fetchFn(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  fetchJsonWithBase(path: string, init?: RequestInit): Promise<unknown>;
  buildUiUrl(path: string): string;
  normalizeLanguage(languageId: unknown): string;
  editorWorkbenchCall(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
}

interface TextmateGrammarLike {
  tokenizeLine(lineText: string, prevState: unknown, timeLimit?: number): {
    tokens: Array<{ startIndex: number; endIndex: number; scopes?: string[]; _te2_scopeStack?: string[] }>;
    ruleStack: unknown;
    stoppedEarly?: boolean;
  };
  tokenizeLine2(lineText: string, prevState: unknown, timeLimit?: number): {
    tokens: Uint32Array;
    ruleStack: unknown;
    stoppedEarly?: boolean;
  };
}

interface TextmateRegistryLike {
  setTheme(theme: Record<string, unknown>, colorMap?: string[]): void;
  getColorMap(): string[];
  loadGrammarWithConfiguration(
    scopeName: string,
    encodedLanguageId: number,
    configuration: Record<string, unknown>,
  ): Promise<TextmateGrammarLike | null>;
}

interface TextmateModuleLike {
  INITIAL: unknown;
  Registry: new (options: {
    onigLib: Promise<{
      createOnigScanner(sources: string[]): unknown;
      createOnigString(str: string): unknown;
    }>;
    loadGrammar(scopeName: string): Promise<unknown>;
    getInjections?(scopeName: string): string[];
  }) => TextmateRegistryLike;
  parseRawGrammar(content: string, filePath: string): unknown;
}

interface TextmateStateLike {
  _rs: unknown;
  clone(): TextmateStateLike;
  equals(other: unknown): boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function makeState(ruleStack: unknown): TextmateStateLike {
  return {
    _rs: ruleStack,
    clone() {
      return makeState(this._rs);
    },
    equals(other: unknown): boolean {
      return !!other && typeof other === 'object' && (other as { _rs?: unknown })._rs === this._rs;
    },
  };
}

function grammarLocationUri(grammarId: string): URI {
  return URI.parse(`te2-textmate://grammar/${encodeURIComponent(grammarId)}`) as unknown as URI;
}

function grammarIdFromLocation(resource: URI): string {
  const rawPath = typeof resource.path === 'string' ? resource.path.replace(/^\/+/, '') : '';
  const encoded = rawPath || '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function createEditorTextmateRuntime(deps: TextmateRuntimeDeps): {
  ensureTextmateReady(): Promise<unknown>;
  ensureTextmateTokenization(languageId: unknown, filePath: unknown): Promise<boolean>;
  refreshVscodeGrammarIndex(): Promise<VscodeGrammarIndexLike>;
  scopeNameForLanguage(languageId: unknown, filePath: unknown): Promise<string>;
  applyThemeToRegistry(vscodeThemeJson: unknown): void;
  getGrammarByLang(): Record<string, unknown>;
  getGrammarForLanguage(languageId: unknown): unknown;
} {
  let tmGrammarFactory: TMGrammarFactory | null = null;
  let tmInstalled: Record<string, boolean> = Object.create(null);
  let tmInstallInflight: Record<string, Promise<boolean> | undefined> = Object.create(null);
  let tmGrammarByLang: Record<string, unknown> = Object.create(null);
  let tmActiveThemeJson: Record<string, unknown> | null = null;
  let tmVscodeIndex: VscodeGrammarIndexLike | null = null;
  let tmVscodeIndexInflight: Promise<VscodeGrammarIndexLike> | null = null;
  let tmReadyInflight: Promise<unknown> | null = null;

  function resetTokenizationForAllModels(): void {
    try {
      const win = deps.getWindow();
      const models = win.monaco?.editor?.getModels ? win.monaco.editor.getModels() : [];
      for (const model of models || []) {
        if (model && typeof model.resetTokenization === 'function') {
          model.resetTokenization();
        }
      }
    } catch (_) {}
  }

  function installDebugGlobals(): void {
    const win = deps.getWindow();
    try {
      win.vscodetextmate = vscodeTextmate as unknown as WindowTextmateLike['vscodetextmate'];
    } catch (_) {}
    try {
      win.onig = vscodeOniguruma as unknown as WindowTextmateLike['onig'];
    } catch (_) {}
  }

  function buildThemeSettings(themeJson: Record<string, unknown>): { name: string; settings: Array<Record<string, unknown>> } {
    const colors = asRecord(themeJson.colors) || {};
    const editorFg = asString(colors['editor.foreground']) || asString(colors.foreground) || '#e6edf3';
    const editorBg = asString(colors['editor.background']) || asString(colors['editorPane.background']) || '#0d1117';
    const settings: Array<Record<string, unknown>> = [{ settings: { foreground: editorFg, background: editorBg } }];
    const tokenColors = asArray<Record<string, unknown>>(themeJson.tokenColors);
    for (const tokenColor of tokenColors) {
      settings.push(tokenColor);
    }
    return {
      name: asString(themeJson.name) || 'te2-theme',
      settings,
    };
  }

  function applyThemeToRegistry(vscodeThemeJson: unknown): void {
    const theme = asRecord(vscodeThemeJson);
    if (!theme) return;
    tmActiveThemeJson = theme;
    try {
      if (!tmGrammarFactory) return;
      const tmTheme = buildThemeSettings(theme);
      tmGrammarFactory.setTheme(tmTheme);
      const colorMap = tmGrammarFactory.getColorMap();
      const win = deps.getWindow();
      if (colorMap.length > 0 && win.monaco?.languages?.setColorMap) {
        win.monaco.languages.setColorMap(colorMap);
      }
      resetTokenizationForAllModels();
    } catch (error) {
      console.warn('[TextMate] applyThemeToRegistry failed', error);
    }
  }

  async function loadVscodeGrammarIndex(): Promise<VscodeGrammarIndexLike> {
    const idx: VscodeGrammarIndexLike = {
      byScope: Object.create(null),
      byLanguage: Object.create(null),
      byLocation: Object.create(null),
    };
    let loaded = false;

    try {
      const res = await deps.editorWorkbenchCall('grammars_list', {}, { timeoutMs: 8000 });
      const result = asRecord(res)?.result && asRecord(asRecord(res)?.result)
        ? asRecord(asRecord(res)?.result)!
        : asRecord(res);
      const grammars = asArray<Record<string, unknown>>(result?.grammars);
      loaded = true;
      const byLangScopes: Record<string, Set<string>> = Object.create(null);

      for (const rawGrammar of grammars) {
        const scopeName = asString(rawGrammar.scopeName).trim();
        const id = asString(rawGrammar.id).trim();
        if (!scopeName || !id) continue;
        const location = grammarLocationUri(id);
        const entry: VscodeGrammarByScopeEntry = {
          id,
          scopeName,
          language: asString(rawGrammar.language).trim() || null,
          extensionId: asString(rawGrammar.extensionId).trim() || undefined,
          embeddedLanguages: asRecord(rawGrammar.embeddedLanguages)
            ? Object.fromEntries(Object.entries(asRecord(rawGrammar.embeddedLanguages)!).filter(([, value]) => typeof value === 'string')) as Record<string, string>
            : undefined,
          tokenTypes: asRecord(rawGrammar.tokenTypes)
            ? Object.fromEntries(Object.entries(asRecord(rawGrammar.tokenTypes)!).filter(([, value]) => typeof value === 'string')) as Record<string, string>
            : undefined,
          injectTo: asArray<string>(rawGrammar.injectTo).filter((value) => typeof value === 'string'),
          balancedBracketScopes: asArray<string>(rawGrammar.balancedBracketScopes).filter((value) => typeof value === 'string'),
          unbalancedBracketScopes: asArray<string>(rawGrammar.unbalancedBracketScopes).filter((value) => typeof value === 'string'),
          location,
        };
        idx.byScope[scopeName] = entry;
        idx.byLocation[location.toString()] = id;

        const lang = deps.normalizeLanguage(entry.language);
        if (!lang) continue;
        const scopes = byLangScopes[lang] || (byLangScopes[lang] = new Set());
        scopes.add(scopeName);
      }

      for (const lang of Object.keys(byLangScopes)) {
        const scopes = Array.from(byLangScopes[lang]);
        idx.byLanguage[lang] = {
          preferred: scopes[0] || null,
          scopes,
        };
      }
    } catch (error) {
      console.warn('[TextMate] refreshVscodeGrammarIndex failed', error);
    }

    if (loaded) {
      tmVscodeIndex = idx;
      return idx;
    }
    return tmVscodeIndex || idx;
  }

  async function refreshVscodeGrammarIndex(): Promise<VscodeGrammarIndexLike> {
    if (tmVscodeIndexInflight) return tmVscodeIndexInflight;
    const inflight = loadVscodeGrammarIndex();
    tmVscodeIndexInflight = inflight;
    try {
      return await inflight;
    } finally {
      if (tmVscodeIndexInflight === inflight) tmVscodeIndexInflight = null;
    }
  }

  async function scopeNameForLanguage(languageId: unknown, filePath: unknown): Promise<string> {
    const lang = deps.normalizeLanguage(languageId);
    const path = asString(filePath);

    try {
      if (!tmVscodeIndex) {
        await refreshVscodeGrammarIndex();
      }
      const index = tmVscodeIndex;
      if (!index) return '';
      const entry = index.byLanguage[lang];
      if (entry) {
        if (entry.preferred) return entry.preferred;
      }
    } catch (_) {}

    return '';
  }

  function buildGrammarDefinitions(index: VscodeGrammarIndexLike): IValidGrammarDefinition[] {
    const win = deps.getWindow();
    const getEncodedLanguageId = win.monaco?.languages?.getEncodedLanguageId;
    const definitions: IValidGrammarDefinition[] = [];

    for (const scopeName of Object.keys(index.byScope)) {
      const entry = index.byScope[scopeName];
      const embeddedLanguages: IValidEmbeddedLanguagesMap = Object.create(null);
      const rawEmbedded = entry.embeddedLanguages || {};
      if (typeof getEncodedLanguageId === 'function') {
        for (const embeddedScope of Object.keys(rawEmbedded)) {
          const embeddedLanguage = deps.normalizeLanguage(rawEmbedded[embeddedScope]);
          if (!embeddedLanguage) continue;
          const encoded = Number(getEncodedLanguageId.call(win.monaco?.languages, embeddedLanguage));
          if (Number.isFinite(encoded) && encoded > 0) {
            embeddedLanguages[embeddedScope] = encoded;
          }
        }
      }

      const tokenTypes: IValidTokenTypeMap = Object.create(null);
      const rawTokenTypes = entry.tokenTypes || {};
      for (const tokenScope of Object.keys(rawTokenTypes)) {
        const mapped = standardTokenTypeFromString(rawTokenTypes[tokenScope]);
        if (mapped != null) tokenTypes[tokenScope] = mapped;
      }

      definitions.push({
        location: entry.location,
        language: deps.normalizeLanguage(entry.language) || undefined,
        scopeName: entry.scopeName,
        embeddedLanguages,
        tokenTypes,
        injectTo: entry.injectTo && entry.injectTo.length ? entry.injectTo.slice() : undefined,
        balancedBracketSelectors: entry.balancedBracketScopes && entry.balancedBracketScopes.length ? entry.balancedBracketScopes.slice() : ['*'],
        unbalancedBracketSelectors: entry.unbalancedBracketScopes && entry.unbalancedBracketScopes.length ? entry.unbalancedBracketScopes.slice() : [],
        sourceExtensionId: entry.extensionId,
      });
    }

    return definitions;
  }

  async function loadTextmateReady(): Promise<unknown> {
    installDebugGlobals();
    if (!tmVscodeIndex) {
      await refreshVscodeGrammarIndex();
    }
    if (!tmVscodeIndex) {
      throw new Error('TextMate grammar index unavailable');
    }

    const wasmResp = await deps.fetchFn(deps.buildUiUrl('monaco_editor/textmate/onig.wasm'), { cache: 'force-cache' });
    if (!wasmResp.ok) {
      throw new Error(`onig.wasm HTTP ${wasmResp.status}`);
    }
    const wasmBuf = await wasmResp.arrayBuffer();
    await vscodeOniguruma.loadWASM(wasmBuf);

    const onigLib = Promise.resolve({
      createOnigScanner(sources: string[]) {
        return vscodeOniguruma.createOnigScanner(sources);
      },
      createOnigString(str: string) {
        return vscodeOniguruma.createOnigString(str);
      },
    });

    const grammarDefinitions = buildGrammarDefinitions(tmVscodeIndex);
    tmGrammarFactory = new TMGrammarFactory(
      {
        logTrace(msg: string) {
          console.log('[TextMate]', msg);
        },
        logError(msg: string, err: unknown) {
          console.warn('[TextMate]', msg, err);
        },
        async readFile(resource: URI): Promise<string> {
          const grammarId = grammarIdFromLocation(resource) || tmVscodeIndex?.byLocation[resource.toString()] || '';
          if (!grammarId) {
            throw new Error(`Unknown grammar resource: ${resource.toString()}`);
          }
          const loadRes = await deps.editorWorkbenchCall('grammars_load', { id: grammarId }, { timeoutMs: 8000 });
          const payload = asRecord(loadRes)?.result && asRecord(asRecord(loadRes)?.result)
            ? asRecord(asRecord(loadRes)?.result)!
            : asRecord(loadRes);
          const ok = payload?.ok === true;
          const raw = asString(payload?.raw);
          if (!ok || !raw) {
            throw new Error(asString(payload?.error) || `Failed to load grammar ${grammarId}`);
          }
          return raw;
        },
      },
      grammarDefinitions,
      vscodeTextmate as unknown as TextmateModuleLike,
      onigLib,
    );

    if (tmActiveThemeJson) {
      applyThemeToRegistry(tmActiveThemeJson);
    }

    console.log('[TextMate] workbench runtime ready');
    return tmGrammarFactory;
  }

  async function ensureTextmateReady(): Promise<unknown> {
    if (tmGrammarFactory) return tmGrammarFactory;
    if (tmReadyInflight) return tmReadyInflight;
    const inflight = loadTextmateReady();
    tmReadyInflight = inflight;
    try {
      return await inflight;
    } finally {
      if (tmReadyInflight === inflight) tmReadyInflight = null;
    }
  }

  async function ensureTextmateTokenization(languageId: unknown, filePath: unknown): Promise<boolean> {
    try {
      const win = deps.getWindow();
      const monacoLanguages = win.monaco?.languages;
      if (!monacoLanguages || typeof monacoLanguages.setTokensProvider !== 'function') return false;

      const knownLangs = typeof monacoLanguages.getLanguages === 'function'
        ? monacoLanguages.getLanguages()
        : [];
      const lang = resolveMonacoLanguageId(languageId, knownLangs);
      if (!lang) return false;
      if (tmInstalled[lang]) return true;
      const inflight = tmInstallInflight[lang];
      if (inflight) return await inflight;

      tmInstallInflight[lang] = (async () => {
        const scopeName = await scopeNameForLanguage(lang, filePath);
        if (!scopeName) {
          console.warn('[TextMate] missing scope for', lang, filePath);
          return false;
        }

        if (!knownLangs.some((entry) => entry && entry.id === lang) && typeof monacoLanguages.register === 'function') {
          monacoLanguages.register({ id: lang });
        }

        const grammarFactory = await ensureTextmateReady() as TMGrammarFactory;
        const encodedLanguageId = typeof monacoLanguages.getEncodedLanguageId === 'function'
          ? Number(monacoLanguages.getEncodedLanguageId(lang))
          : 0;
        if (!Number.isFinite(encodedLanguageId) || encodedLanguageId <= 0) {
          console.warn('[TextMate] invalid encoded language id for', lang);
          return false;
        }

        const created = await grammarFactory.createGrammar(lang, encodedLanguageId);
        const grammar = created.grammar as TextmateGrammarLike | null;
        if (!grammar) {
          console.warn('[TextMate] missing grammar for', lang, scopeName);
          return false;
        }

        tmGrammarByLang[lang] = grammar;
        if (tmActiveThemeJson) {
          applyThemeToRegistry(tmActiveThemeJson);
        }

        const setTokensProvider = monacoLanguages.setTokensProvider;
        if (typeof setTokensProvider !== 'function') return false;

        setTokensProvider.call(monacoLanguages, lang, {
          getInitialState() {
            return makeState(created.initialState);
          },
          tokenizeEncoded(line: unknown, state: TextmateStateLike) {
            const currentState = state && Object.prototype.hasOwnProperty.call(state, '_rs') ? state._rs : created.initialState;
            const result = grammar.tokenizeLine2(String(line || ''), currentState, 500);
            const nextState = currentState === result.ruleStack ? currentState : result.ruleStack;
            if (result.stoppedEarly) {
              return {
                tokens: result.tokens,
                endState: makeState(currentState),
              };
            }
            return {
              tokens: result.tokens,
              endState: makeState(nextState),
            };
          },
          tokenize(line: unknown, state: TextmateStateLike) {
            const currentState = state && Object.prototype.hasOwnProperty.call(state, '_rs') ? state._rs : created.initialState;
            const result = grammar.tokenizeLine(String(line || ''), currentState, 500);
            const nextState = currentState === result.ruleStack ? currentState : result.ruleStack;
            const tokens: Array<{ startIndex: number; scopes: string }> = [];
            for (const token of result.tokens) {
              const scopes = Array.isArray(token.scopes) ? token.scopes : [];
              const last = scopes.length ? scopes[scopes.length - 1] : '';
              try {
                if ((win as WindowTextmateLike & { __debugTextmateScopes?: boolean }).__debugTextmateScopes) {
                  token._te2_scopeStack = scopes.slice();
                }
              } catch (_) {}
              tokens.push({ startIndex: token.startIndex, scopes: last });
            }
            return {
              tokens,
              endState: result.stoppedEarly ? makeState(currentState) : makeState(nextState),
            };
          },
        });

        tmInstalled[lang] = true;
        console.log('[TextMate] installed workbench tokenizer', lang, '->', scopeName);
        return true;
      })();

      try {
        return await tmInstallInflight[lang];
      } finally {
        delete tmInstallInflight[lang];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === missingTMGrammarErrorMessage) {
        return false;
      }
      console.warn('[TextMate] install failed', languageId, error);
      return false;
    }
  }

  function getGrammarByLang(): Record<string, unknown> {
    return tmGrammarByLang;
  }

  function getGrammarForLanguage(languageId: unknown): unknown {
    return tmGrammarByLang[deps.normalizeLanguage(languageId)] || null;
  }

  return {
    ensureTextmateReady,
    ensureTextmateTokenization,
    refreshVscodeGrammarIndex,
    scopeNameForLanguage,
    applyThemeToRegistry,
    getGrammarByLang,
    getGrammarForLanguage,
  };
}
