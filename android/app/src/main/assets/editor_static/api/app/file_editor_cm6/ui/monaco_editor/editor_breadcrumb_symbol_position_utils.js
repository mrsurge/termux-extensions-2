export function getBreadcrumbSymbolPosition(symRange) {
  if (!symRange) return { line: 1, col: 1 };
  var sl = symRange.startLineNumber || symRange.startLine || (symRange.start && typeof symRange.start.line === 'number' ? symRange.start.line + 1 : null) || 1;
  var sc = symRange.startColumn || (symRange.start && typeof symRange.start.character === 'number' ? symRange.start.character + 1 : null) || 1;
  if (Array.isArray(symRange) && symRange.length >= 2) { sl = symRange[0] + 1; sc = symRange[1] + 1; }
  return { line: sl, col: sc };
}
