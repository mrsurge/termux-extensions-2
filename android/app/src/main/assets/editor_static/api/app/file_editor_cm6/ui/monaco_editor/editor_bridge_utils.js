export function monacoRangeFromProtoRange(monacoObj, range) {
  try {
    if (!range || !monacoObj || !monacoObj.Range) return null;
    var sl = Math.max(1, Number(range.startLineNumber || 1));
    var sc = Math.max(1, Number(range.startColumn || 1));
    var el = Math.max(1, Number(range.endLineNumber || sl));
    var ec = Math.max(1, Number(range.endColumn || sc));
    return new monacoObj.Range(sl, sc, el, ec);
  } catch (_) {
    return null;
  }
}

export function toMonacoHoverContents(raw) {
  var out = [];
  if (!Array.isArray(raw)) return out;
  for (var i = 0; i < raw.length; i++) {
    var c = raw[i];
    if (typeof c === 'string') {
      out.push({ value: c });
    } else if (c && typeof c === 'object') {
      if (typeof c.value === 'string') out.push({ value: c.value });
      else if (typeof c.language === 'string' && typeof c.value === 'string') out.push({ value: '```' + c.language + '\n' + c.value + '\n```' });
    }
  }
  return out;
}

export function isLanguageContextCurrent(ctx, nowCtx) {
  try {
    if (!ctx || !nowCtx) return false;
    return String(nowCtx.uri) === String(ctx.uri) && Number(nowCtx.version || 0) === Number(ctx.version || -1);
  } catch (_) {
    return false;
  }
}

export function monacoRangeFromCompletionRange(monacoObj, range, pos) {
  if (!range || !monacoObj) return undefined;
  if (range.insert || range.replace) {
    return {
      insert: monacoRangeFromProtoRange(monacoObj, range.insert) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      replace: monacoRangeFromProtoRange(monacoObj, range.replace) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
    };
  }
  return monacoRangeFromProtoRange(monacoObj, range) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
}

export function mapCompletionItemKind(monacoObj, kind) {
  if (!monacoObj || !monacoObj.languages || !monacoObj.languages.CompletionItemKind) return kind || 0;
  return kind || 0;
}
