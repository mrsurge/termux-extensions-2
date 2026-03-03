import { toMonacoColorHex } from './editor_parse_utils.js';

export function vscodeTokenColorsToMonacoRules(tokenColors) {
  var rules = [];
  if (!Array.isArray(tokenColors)) return rules;
  for (var i = 0; i < tokenColors.length; i++) {
    var tc = tokenColors[i];
    if (!tc || !tc.settings) continue;
    var fg = toMonacoColorHex(tc.settings.foreground);
    var bg = toMonacoColorHex(tc.settings.background);
    var fontStyle = null;
    if (typeof tc.settings.fontStyle === 'string') {
      fontStyle = tc.settings.fontStyle.trim();
    }
    var scopes = tc.scope;
    var scopeList = [];
    if (Array.isArray(scopes)) {
      scopeList = scopes;
    } else if (typeof scopes === 'string') {
      scopeList = scopes.split(',');
    } else {
      continue;
    }
    for (var j = 0; j < scopeList.length; j++) {
      var rawScope = scopeList[j];
      if (rawScope == null) continue;
      var scopeStr = String(rawScope || '').trim();
      if (!scopeStr) continue;
      var parts = scopeStr.split(/\s+/g);
      for (var p = 0; p < parts.length; p++) {
        var scope = String(parts[p] || '').trim();
        if (!scope) continue;
        var rule = { token: scope };
        if (fg) rule.foreground = fg;
        if (bg) rule.background = bg;
        if (fontStyle) rule.fontStyle = fontStyle;
        if (rule.foreground || rule.background || rule.fontStyle) rules.push(rule);
      }
    }
  }
  return rules;
}
