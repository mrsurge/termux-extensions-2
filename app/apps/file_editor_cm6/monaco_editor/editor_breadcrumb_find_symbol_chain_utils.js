export function findBreadcrumbSymbolChain(symbols, line, symbolRangeToLineBoundsFn) {
  var chain = [];
  var cur = symbols;
  while (cur && cur.length) {
    var found = null;
    for (var i = 0; i < cur.length; i++) {
      var s = cur[i];
      var r = s.range || (s.location && s.location.range);
      if (!r) continue;
      var bounds = symbolRangeToLineBoundsFn(r);
      if (!bounds) continue;
      if (line >= bounds.startLine && line <= bounds.endLine) { found = s; break; }
    }
    if (!found) break;
    chain.push(found);
    cur = found.children || [];
  }
  return chain;
}
