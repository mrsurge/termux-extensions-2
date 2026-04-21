interface ActiveEditorModelContext {
  editor: { getPosition?(): { lineNumber?: number } | null } | null;
  model: {
    getLanguageId?(): string;
    getLineCount?(): number;
    getLineContent?(lineNumber: number): string;
    uri?: unknown;
  } | null;
  side?: unknown;
}

interface TextmateDebugWindow extends Window {
  vscodetextmate?: { INITIAL?: unknown };
  __te2DumpTextmateLine?: (lineNumber: number) => void;
  __te2DumpTextmateAtCursor?: () => void;
  __te2DumpTextmateScopes?: () => void;
}

interface TextmateDebugRuntimeDeps {
  getWindow(): TextmateDebugWindow;
  getCurrentPath(): string | null;
  getActiveEditorAndModel(): ActiveEditorModelContext;
  normalizeLanguage(value: unknown): string;
  languageFromPath(path: string | null): string;
  getGrammarForLanguage(languageId: string): unknown;
  advanceRuleStackToLine(grammar: unknown, model: ActiveEditorModelContext['model'], targetLine: number): unknown;
  dumpTextmateScopesForLine(languageId: string, text: string, ruleStack: unknown): { tokens?: unknown; ruleStack?: unknown } | null;
}

export function installTextmateDebugHooks(deps: TextmateDebugRuntimeDeps): void {
  const win = deps.getWindow();

  function dumpTextmateLine(lineNumber: number): void {
    try {
      const ctx = deps.getActiveEditorAndModel();
      if (!ctx.model) return;
      const activeModel = ctx.model;
      const lang = deps.normalizeLanguage(
        activeModel.getLanguageId ? activeModel.getLanguageId() : deps.languageFromPath(deps.getCurrentPath()),
      );
      if (!lang) return;
      const grammar = deps.getGrammarForLanguage(lang);
      if (!grammar) {
        console.warn('[TextMate][Debug] no grammar loaded for', lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
        return;
      }

      const maxLine = activeModel.getLineCount ? activeModel.getLineCount() : 1;
      const normalizedLine = Math.min(Math.max(1, lineNumber | 0), maxLine);
      const ruleStack = deps.advanceRuleStackToLine(grammar, activeModel, normalizedLine);
      const line = activeModel.getLineContent ? activeModel.getLineContent(normalizedLine) : '';
      const dump = deps.dumpTextmateScopesForLine(lang, line, ruleStack);
      console.log('[TextMate][Debug]', {
        side: ctx.side,
        uri: String(activeModel && activeModel.uri),
        lang,
        ln: normalizedLine,
        line,
        tokens: dump ? dump.tokens : null,
      });
    } catch (error) {
      console.warn('[TextMate][Debug] failed', error);
    }
  }

  win.__te2DumpTextmateLine = dumpTextmateLine;
  win.__te2DumpTextmateAtCursor = function() {
    try {
      const ctx = deps.getActiveEditorAndModel();
      if (!ctx.editor || !ctx.model) return;
      const pos = ctx.editor.getPosition ? ctx.editor.getPosition() : null;
      const lineNumber = pos && pos.lineNumber ? pos.lineNumber : 1;
      dumpTextmateLine(lineNumber);
    } catch (error) {
      console.warn('[TextMate][Debug] failed', error);
    }
  };

  win.__te2DumpTextmateScopes = function() {
    try {
      const ctx = deps.getActiveEditorAndModel();
      if (!ctx.model) return;
      const activeModel = ctx.model;
      const lang = deps.normalizeLanguage(
        activeModel.getLanguageId ? activeModel.getLanguageId() : deps.languageFromPath(deps.getCurrentPath()),
      );
      if (!lang) return;
      const grammar = deps.getGrammarForLanguage(lang);
      if (!grammar) {
        console.warn('[TextMate][Debug] no grammar loaded for', lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
        return;
      }

      const maxLines = Math.min(activeModel.getLineCount ? activeModel.getLineCount() : 0, 200);
      let ruleStack = win.vscodetextmate && Object.prototype.hasOwnProperty.call(win.vscodetextmate, 'INITIAL')
        ? win.vscodetextmate.INITIAL
        : null;
      let printed = 0;
      for (let lineNumber = 1; lineNumber <= maxLines; lineNumber += 1) {
        const line = activeModel.getLineContent ? activeModel.getLineContent(lineNumber) : '';
        const isImport = /^(\s*from\s+\S+\s+import\s+|\s*import\s+\S+)/.test(line);
        const isDef = /^\s*def\s+\w+|^\s*class\s+\w+/.test(line);
        if (!isImport && !isDef) {
          try {
            const step = grammar && typeof (grammar as { tokenizeLine?: (text: string, stack: unknown) => { ruleStack?: unknown } }).tokenizeLine === 'function'
              ? (grammar as { tokenizeLine: (text: string, stack: unknown) => { ruleStack?: unknown } }).tokenizeLine(String(line || ''), ruleStack)
              : null;
            ruleStack = step && Object.prototype.hasOwnProperty.call(step, 'ruleStack') ? step.ruleStack : ruleStack;
          } catch (_) {}
          continue;
        }
        const dump = deps.dumpTextmateScopesForLine(lang, line, ruleStack);
        if (!dump) continue;
        ruleStack = dump.ruleStack;
        console.log('[TextMate][Debug]', {
          side: ctx.side,
          uri: String(activeModel && activeModel.uri),
          lang,
          ln: lineNumber,
          line,
          tokens: dump.tokens,
        });
        printed += 1;
        if (printed >= 12) break;
      }
      if (!printed) console.log('[TextMate][Debug] no import/def/class lines found in first', maxLines, 'lines');
    } catch (error) {
      console.warn('[TextMate][Debug] failed', error);
    }
  };
}
