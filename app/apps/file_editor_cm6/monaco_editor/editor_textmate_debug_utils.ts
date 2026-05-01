interface TextmateDumpToken {
  startIndex: number;
  endIndex: number;
  scopes: string[];
}

interface TextmateDumpResult {
  tokens: TextmateDumpToken[];
  ruleStack: unknown;
}

export function te2DumpTextmateScopesForLine(
  tmGrammarByLang: Record<string, MonacoTextmateGrammarLike | undefined>,
  textmateObj: MonacoTextmateGlobal,
  lang: string,
  text: string,
  ruleStack: unknown,
): TextmateDumpResult | null {
  try {
    const grammar = tmGrammarByLang[lang];
    if (!grammar || !grammar.tokenizeLine) return null;
    const ruleState = ruleStack || textmateObj.INITIAL;
    const result = grammar.tokenizeLine(String(text || ''), ruleState);
    const tokens: TextmateDumpToken[] = [];
    for (let index = 0; index < result.tokens.length; index += 1) {
      const token = result.tokens[index];
      tokens.push({
        startIndex: token.startIndex,
        endIndex: token.endIndex,
        scopes: (token.scopes || []).slice(),
      });
    }
    return { tokens, ruleStack: result.ruleStack };
  } catch (_) {
    return null;
  }
}

export function te2GetActiveEditorAndModel(
  diffEditor: MonacoRuntimeDiffEditorLike | null | unknown,
  editor: MonacoRuntimeEditorLike | null | unknown,
): { editor: MonacoRuntimeEditorLike | null; model: MonacoRuntimeModelLike | null; side: string } {
  try {
    const diffEditorInstance = diffEditor as MonacoRuntimeDiffEditorLike | null;
    if (diffEditorInstance && diffEditorInstance.getModifiedEditor) {
      const modifiedEditor = diffEditorInstance.getModifiedEditor();
      if (modifiedEditor && modifiedEditor.getModel) return { editor: modifiedEditor, model: modifiedEditor.getModel(), side: 'diff:modified' };
    }
  } catch (_) {}
  try {
    const editorInstance = editor as MonacoRuntimeEditorLike | null;
    if (editorInstance && editorInstance.getModel) return { editor: editorInstance, model: editorInstance.getModel(), side: 'single' };
  } catch (_) {}
  return { editor: null, model: null, side: 'none' };
}

export function te2AdvanceRuleStackToLine(
  textmateObj: MonacoTextmateGlobal,
  grammar: MonacoTextmateGrammarLike,
  model: MonacoRuntimeModelLike,
  targetLine: number,
): unknown {
  try {
    if (!grammar.tokenizeLine || !model.getLineCount || !model.getLineContent) return textmateObj.INITIAL;
    const maxLines = Math.min(Math.max(1, targetLine | 0), model.getLineCount());
    let ruleStack: unknown = textmateObj.INITIAL;
    for (let lineNumber = 1; lineNumber < maxLines; lineNumber += 1) {
      const line = model.getLineContent(lineNumber);
      const step = grammar.tokenizeLine(String(line || ''), ruleStack);
      ruleStack = step.ruleStack;
    }
    return ruleStack;
  } catch (_) {
    return textmateObj.INITIAL;
  }
}
