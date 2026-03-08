export function te2DumpTextmateScopesForLine(tmGrammarByLang, textmateObj, lang, text, ruleStack) {
  try {
    var grammar = tmGrammarByLang[lang];
    if (!grammar) return null;
    var rs = ruleStack || textmateObj.INITIAL;
    var res = grammar.tokenizeLine(String(text || ''), rs);
    var out = [];
    for (var i = 0; i < res.tokens.length; i++) {
      var t = res.tokens[i];
      out.push({
        startIndex: t.startIndex,
        endIndex: t.endIndex,
        scopes: (t.scopes || []).slice(),
      });
    }
    return { tokens: out, ruleStack: res.ruleStack };
  } catch (_) {
    return null;
  }
}

export function te2GetActiveEditorAndModel(diffEditor, editor) {
  try {
    if (diffEditor && diffEditor.getModifiedEditor) {
      var me = diffEditor.getModifiedEditor();
      if (me && me.getModel) return { editor: me, model: me.getModel(), side: 'diff:modified' };
    }
  } catch (_) {}
  try {
    if (editor && editor.getModel) return { editor: editor, model: editor.getModel(), side: 'single' };
  } catch (_) {}
  return { editor: null, model: null, side: 'none' };
}

export function te2AdvanceRuleStackToLine(textmateObj, grammar, model, targetLine) {
  try {
    var maxLines = Math.min(Math.max(1, targetLine | 0), model.getLineCount());
    var rs = textmateObj.INITIAL;
    for (var ln = 1; ln < maxLines; ln++) {
      var line = model.getLineContent(ln);
      var step = grammar.tokenizeLine(String(line || ''), rs);
      rs = step.ruleStack;
    }
    return rs;
  } catch (_) {
    return textmateObj.INITIAL;
  }
}
