type WindowTextmateLike = Window & {
  onig?: {
    loadWASM?(buffer: ArrayBuffer): Promise<void>;
    OnigScanner?: new (sources: string[]) => unknown;
    OnigString?: new (value: string) => unknown;
  };
  vscodetextmate?: {
    INITIAL?: unknown;
    Registry?: new (options: Record<string, unknown>) => {
      setTheme?(theme: Record<string, unknown>): void;
      getColorMap?(): string[];
      loadGrammar?(scopeName: string): Promise<unknown>;
    };
    parseRawGrammar?(content: string, url: string): unknown;
  };
  monaco?: Window['monaco'] & {
    editor?: {
      getModels?(): Array<{ resetTokenization?(): void }>;
    };
    languages?: {
      setColorMap?(colorMap: string[]): void;
      getLanguages?(): Array<{ id?: string }>;
      register?(desc: Record<string, unknown>): void;
      setTokensProvider?(languageId: string, provider: Record<string, unknown>): void;
    };
  };
};

interface GrammarIndexLike {
  scopes?: Record<string, string>;
}

interface VscodeGrammarByScopeEntry {
  id: string;
  scopeName: string;
  language: string;
}

interface VscodeGrammarByLanguageEntry {
  preferred: string | null;
  scopes: string[];
}

interface VscodeGrammarIndexLike {
  byScope: Record<string, VscodeGrammarByScopeEntry>;
  byLanguage: Record<string, VscodeGrammarByLanguageEntry>;
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  let tmRegistry: {
    setTheme?(theme: Record<string, unknown>): void;
    getColorMap?(): string[];
    loadGrammar?(scopeName: string): Promise<unknown>;
  } | null = null;
  let tmGrammarIndex: GrammarIndexLike | null = null;
  let tmInstalled: Record<string, boolean> = Object.create(null);
  let tmInstallInflight: Record<string, Promise<boolean> | undefined> = Object.create(null);
  let tmGrammarByLang: Record<string, unknown> = Object.create(null);
  let tmActiveThemeJson: Record<string, unknown> | null = null;
  let tmVscodeIndex: VscodeGrammarIndexLike | null = null;

  function resetTokenizationForAllModels(): void {
    try {
      const win = deps.getWindow();
      const models = win.monaco && win.monaco.editor && typeof win.monaco.editor.getModels === 'function'
        ? win.monaco.editor.getModels()
        : [];
      for (const model of models || []) {
        if (model && typeof model.resetTokenization === 'function') {
          model.resetTokenization();
        }
      }
    } catch (_) {}
  }

  function applyThemeToRegistry(vscodeThemeJson: unknown): void {
    const theme = asRecord(vscodeThemeJson);
    if (theme) tmActiveThemeJson = theme;
    try {
      if (!tmRegistry || !theme) return;
      const settings: Array<Record<string, unknown>> = [];
      const colors = asRecord(theme.colors) || {};
      const editorFg = asString(colors['editor.foreground']) || asString(colors.foreground) || '#e6edf3';
      const editorBg = asString(colors['editor.background']) || asString(colors['editorPane.background']) || '#0d1117';
      settings.push({ settings: { foreground: editorFg, background: editorBg } });
      const tokenColors = asArray<Record<string, unknown>>(theme.tokenColors);
      for (const tokenColor of tokenColors) settings.push(tokenColor);
      tmRegistry.setTheme && tmRegistry.setTheme({ name: asString(theme.name) || 'te2-theme', settings });
      const win = deps.getWindow();
      if (win.monaco && win.monaco.languages && typeof win.monaco.languages.setColorMap === 'function') {
        const colorMap = tmRegistry.getColorMap ? tmRegistry.getColorMap() : [];
        if (colorMap && colorMap.length > 0) {
          win.monaco.languages.setColorMap(colorMap);
          const installedLangs = Object.keys(tmInstalled).filter((key) => tmInstalled[key]);
          console.log('[TextMate:DIAG] setColorMap called, colors=' + colorMap.length + ', already installed langs: [' + installedLangs.join(', ') + ']');
        }
      }
    } catch (error) {
      console.warn('[TextMate] applyThemeToRegistry failed', error);
    }
  }

  async function refreshVscodeGrammarIndex(): Promise<VscodeGrammarIndexLike> {
    const idx: VscodeGrammarIndexLike = {
      byScope: Object.create(null),
      byLanguage: Object.create(null),
    };
    try {
      const res = await deps.editorWorkbenchCall('grammars_list', {}, { timeoutMs: 8000 });
      const result = asRecord(res) && asRecord(asRecord(res)!.result) ? asRecord(res)!.result : res;
      const grammars = asArray<Record<string, unknown>>(asRecord(result) ? asRecord(result)!.grammars : []);
      const byLangScopes: Record<string, Set<string>> = Object.create(null);
      for (const grammar of grammars) {
        const scope = asString(grammar.scopeName).trim();
        const id = asString(grammar.id).trim();
        if (!scope || !id) continue;
        const grammarLanguage = asString(grammar.language).trim();
        idx.byScope[scope] = { id, scopeName: scope, language: grammarLanguage };
        const lang = deps.normalizeLanguage(grammarLanguage);
        if (!lang) continue;
        if (!byLangScopes[lang]) byLangScopes[lang] = new Set();
        byLangScopes[lang].add(scope);
      }

      const pickPreferred = (lang: string, scopes: string[]): string | null => {
        let prefer: string[] = [];
        if (lang === 'javascript') prefer = ['source.js', 'source.jsx', 'source.js.jsx'];
        else if (lang === 'typescript') prefer = ['source.ts', 'source.tsx'];
        else if (lang === 'python') prefer = ['source.python'];
        else if (lang === 'json') prefer = ['source.json', 'source.json.comments'];
        else if (lang === 'html') prefer = ['text.html.basic'];
        else if (lang === 'css') prefer = ['source.css'];
        else if (lang === 'markdown') prefer = ['text.html.markdown'];
        else if (lang === 'shell') prefer = ['source.shell'];
        else if (lang === 'c') prefer = ['source.c'];
        else if (lang === 'cpp') prefer = ['source.cpp'];
        else if (lang === 'java') prefer = ['source.java'];
        else if (lang === 'rust') prefer = ['source.rust'];
        for (const candidate of prefer) {
          if (scopes.indexOf(candidate) >= 0) return candidate;
        }
        const fallback = 'source.' + lang;
        if (scopes.indexOf(fallback) >= 0) return fallback;
        return scopes.length ? scopes[0] : null;
      };

      for (const lang of Object.keys(byLangScopes)) {
        const scopes = Array.from(byLangScopes[lang]);
        scopes.sort();
        idx.byLanguage[lang] = {
          preferred: pickPreferred(lang, scopes),
          scopes,
        };
      }
    } catch (_) {
      // keep empty fallback index
    }
    tmVscodeIndex = idx;
    return idx;
  }

  async function scopeNameForLanguage(languageId: unknown, filePath: unknown): Promise<string> {
    const lang = deps.normalizeLanguage(languageId);
    try {
      if (!tmVscodeIndex) {
        try { tmVscodeIndex = await refreshVscodeGrammarIndex(); } catch (_) {}
      }
      if (tmVscodeIndex && tmVscodeIndex.byLanguage[lang]) {
        const entry = tmVscodeIndex.byLanguage[lang];
        const path = asString(filePath);
        if (entry && entry.scopes && path) {
          if (lang === 'javascript' && /\.jsx$/i.test(path)) {
            if (entry.scopes.indexOf('source.js.jsx') >= 0) return 'source.js.jsx';
            if (entry.scopes.indexOf('source.jsx') >= 0) return 'source.jsx';
          }
          if (lang === 'typescript' && /\.tsx$/i.test(path)) {
            if (entry.scopes.indexOf('source.tsx') >= 0) return 'source.tsx';
          }
          if (lang === 'markdown' && entry.scopes.indexOf('text.html.markdown') >= 0) {
            return 'text.html.markdown';
          }
        }
        if (entry && entry.preferred) return entry.preferred;
      }
    } catch (_) {}

    const path = asString(filePath);
    if (lang === 'javascript') return /\.jsx$/i.test(path) ? 'source.js.jsx' : 'source.js';
    if (lang === 'typescript') return /\.tsx$/i.test(path) ? 'source.tsx' : 'source.ts';
    if (lang === 'python') return 'source.python';
    if (lang === 'json') return 'source.json';
    if (lang === 'jsonc') return 'source.json.comments';
    if (lang === 'html') return 'text.html.basic';
    if (lang === 'css') return 'source.css';
    if (lang === 'markdown') return 'text.html.markdown';
    if (lang === 'shell') return 'source.shell';
    if (lang === 'c') return 'source.c';
    if (lang === 'cpp') return 'source.cpp';
    if (lang === 'java') return 'source.java';
    if (lang === 'rust') return 'source.rust';
    return 'source.' + lang;
  }

  async function ensureTextmateReady(): Promise<unknown> {
    if (tmRegistry) return tmRegistry;
    const win = deps.getWindow();
    if (!win.vscodetextmate || !win.onig) {
      throw new Error('TextMate deps missing (vscodetextmate/onig)');
    }

    if (!tmVscodeIndex) {
      try { tmVscodeIndex = await refreshVscodeGrammarIndex(); } catch (_) { tmVscodeIndex = null; }
    }
    if (!tmGrammarIndex) {
      try {
        tmGrammarIndex = asRecord(await deps.fetchJsonWithBase('/ui/monaco_editor/textmate/grammar_index.json', { cache: 'no-store' })) as GrammarIndexLike;
      } catch (_) {
        tmGrammarIndex = null;
      }
    }

    try {
      const wasmResp = await deps.fetchFn(deps.buildUiUrl('monaco_editor/textmate/onig.wasm'), { cache: 'force-cache' });
      if (!wasmResp.ok) throw new Error('onig.wasm HTTP ' + wasmResp.status);
      const wasmBuf = await wasmResp.arrayBuffer();
      await (win.onig.loadWASM && win.onig.loadWASM(wasmBuf));
    } catch (error) {
      console.warn('[TextMate] loadWASM failed', error);
      throw error;
    }

    const RegistryCtor = win.vscodetextmate.Registry;
    tmRegistry = RegistryCtor
      ? new RegistryCtor({
          onigLib: Promise.resolve({
            createOnigScanner(sources: string[]) {
              return win.onig && win.onig.OnigScanner ? new win.onig.OnigScanner(sources) : null;
            },
            createOnigString(str: string) {
              return win.onig && win.onig.OnigString ? new win.onig.OnigString(str) : null;
            },
          }),
          loadGrammar: async (scopeName: string) => {
            try {
              const sn = asString(scopeName);
              try {
                if (!tmVscodeIndex) tmVscodeIndex = await refreshVscodeGrammarIndex();
                const entry = tmVscodeIndex && tmVscodeIndex.byScope ? tmVscodeIndex.byScope[sn] : null;
                if (entry && entry.id) {
                  const loadRes = await deps.editorWorkbenchCall('grammars_load', { id: entry.id }, { timeoutMs: 8000 });
                  const loadResult = asRecord(loadRes) && asRecord(asRecord(loadRes)!.result) ? asRecord(loadRes)!.result : loadRes;
                  const raw = asRecord(loadResult) ? asString(asRecord(loadResult)!.raw) : '';
                  const ok = asRecord(loadResult) ? asRecord(loadResult)!.ok === true : false;
                  if (ok && raw && win.vscodetextmate && typeof win.vscodetextmate.parseRawGrammar === 'function') {
                    const url = 'adapter://textmate/' + encodeURIComponent(entry.id);
                    console.log('[TextMate] loaded extension grammar', sn, '->', entry.id);
                    return win.vscodetextmate.parseRawGrammar(raw, url);
                  }
                }
              } catch (_) {}

              const fileName = tmGrammarIndex && tmGrammarIndex.scopes ? tmGrammarIndex.scopes[sn] : '';
              if (!fileName) return null;
              const url = deps.buildUiUrl('monaco_editor/textmate/grammars/' + fileName);
              const resp = await deps.fetchFn(url, { cache: 'force-cache' });
              if (!resp.ok || !win.vscodetextmate || typeof win.vscodetextmate.parseRawGrammar !== 'function') return null;
              const content = await resp.text();
              return win.vscodetextmate.parseRawGrammar(content, url);
            } catch (error) {
              console.warn('[TextMate] loadGrammar failed', scopeName, error);
              return null;
            }
          },
        })
      : null;

    if (tmActiveThemeJson) {
      applyThemeToRegistry(tmActiveThemeJson);
      resetTokenizationForAllModels();
    }
    console.log('[TextMate] ready');
    return tmRegistry;
  }

  async function ensureTextmateTokenization(languageId: unknown, filePath: unknown): Promise<boolean> {
    try {
      const win = deps.getWindow();
      const monacoLanguages = win.monaco && win.monaco.languages;
      if (!monacoLanguages || typeof monacoLanguages.setTokensProvider !== 'function') return false;
      let lang = deps.normalizeLanguage(languageId);
      console.log('[TextMate:DIAG] ensureTextmateTokenization called: lang=' + lang + ' filePath=' + asString(filePath) + ' alreadyInstalled=' + !!tmInstalled[lang]);
      if (tmInstalled[lang]) return true;
      const inflight = tmInstallInflight[lang];
      if (inflight) return await inflight;

      tmInstallInflight[lang] = (async () => {
        const scopeName = await scopeNameForLanguage(lang, filePath);
        console.log('[TextMate:DIAG] scopeName for ' + lang + ' = ' + scopeName);
        if (!scopeName) return false;

        const registry = await ensureTextmateReady() as { loadGrammar?(scopeName: string): Promise<unknown>; getColorMap?(): string[] };
        const cmBefore = registry && typeof registry.getColorMap === 'function' ? registry.getColorMap().length : '?';
        const grammar = registry && typeof registry.loadGrammar === 'function' ? await registry.loadGrammar(scopeName) : null;
        const cmAfter = registry && typeof registry.getColorMap === 'function' ? registry.getColorMap().length : '?';
        console.log('[TextMate:DIAG] loadGrammar(' + scopeName + ') colorMap: ' + cmBefore + ' -> ' + cmAfter);
        if (!grammar) {
          console.warn('[TextMate] missing grammar for', lang, scopeName);
          return false;
        }

        tmGrammarByLang[lang] = grammar;
        if (tmActiveThemeJson) applyThemeToRegistry(tmActiveThemeJson);

        try {
          const knownLangs = typeof monacoLanguages.getLanguages === 'function' ? monacoLanguages.getLanguages() : [];
          if (!knownLangs.some((entry) => entry && entry.id === lang) && typeof monacoLanguages.register === 'function') {
            monacoLanguages.register({ id: lang });
          }
        } catch (_) {}

        const setTokensProvider = monacoLanguages.setTokensProvider;
        if (typeof setTokensProvider !== 'function') return false;
        setTokensProvider.call(monacoLanguages, lang, {
          getInitialState() {
            return {
              _rs: win.vscodetextmate ? win.vscodetextmate.INITIAL : null,
              clone() { return { _rs: this._rs, clone: this.clone, equals: this.equals }; },
              equals(other: unknown) {
                return !!other && typeof other === 'object' && (other as { _rs?: unknown })._rs === this._rs;
              },
            };
          },
          tokenizeEncoded(line: unknown, state: { _rs?: unknown }) {
            const ruleStack = state && state._rs != null ? state._rs : (win.vscodetextmate ? win.vscodetextmate.INITIAL : null);
            const result = (grammar as { tokenizeLine2?(value: string, stack: unknown): { tokens: Uint32Array; ruleStack: unknown } }).tokenizeLine2
              ? (grammar as { tokenizeLine2(value: string, stack: unknown): { tokens: Uint32Array; ruleStack: unknown } }).tokenizeLine2(String(line || ''), ruleStack)
              : { tokens: new Uint32Array(0), ruleStack };
            return {
              tokens: result.tokens,
              endState: {
                _rs: result.ruleStack,
                clone() { return { _rs: this._rs, clone: this.clone, equals: this.equals }; },
                equals(other: unknown) { return !!other && typeof other === 'object' && (other as { _rs?: unknown })._rs === this._rs; },
              },
            };
          },
          tokenize(line: unknown, state: { _rs?: unknown }) {
            const ruleStack = state && state._rs != null ? state._rs : (win.vscodetextmate ? win.vscodetextmate.INITIAL : null);
            const result = (grammar as { tokenizeLine?(value: string, stack: unknown): { tokens: Array<{ startIndex: number; scopes?: string[]; _te2_scopeStack?: string[] }>; ruleStack: unknown } }).tokenizeLine
              ? (grammar as { tokenizeLine(value: string, stack: unknown): { tokens: Array<{ startIndex: number; scopes?: string[]; _te2_scopeStack?: string[] }>; ruleStack: unknown } }).tokenizeLine(String(line || ''), ruleStack)
              : { tokens: [], ruleStack };
            const tokens = [] as Array<{ startIndex: number; scopes: string }>;
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
              endState: {
                _rs: result.ruleStack,
                clone() { return { _rs: this._rs, clone: this.clone, equals: this.equals }; },
                equals(other: unknown) { return !!other && typeof other === 'object' && (other as { _rs?: unknown })._rs === this._rs; },
              },
            };
          },
        });

        tmInstalled[lang] = true;
        console.log('[TextMate] installed', lang, '->', scopeName);
        return true;
      })();

      try {
        return await tmInstallInflight[lang];
      } finally {
        delete tmInstallInflight[lang];
      }
    } catch (error) {
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
