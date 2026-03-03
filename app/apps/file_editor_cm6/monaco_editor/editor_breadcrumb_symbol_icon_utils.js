export function breadcrumbSymbolIcon(kind, symbolMap) {
  var entry = symbolMap[kind];
  var cls = entry ? entry[0] : 'codicon-symbol-misc';
  var col = entry ? entry[1] : '#8b949e';
  return '<span class="codicon ' + cls + '" style="color:' + col + ';font-size:14px;line-height:1"></span>';
}
