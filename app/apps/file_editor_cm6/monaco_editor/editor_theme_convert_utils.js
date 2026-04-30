import { expandShortHex } from './editor_parse_utils.ts';
import { vscodeTokenColorsToMonacoRules } from './editor_theme_rules_utils.js';
import { buildSemanticTokenRules } from './editor_semantic_token_rules_utils.js';

export function vscodeThemeToMonacoTheme(themeId, vscodeJson) {
  var themeKey = String(themeId || '');
  var uiTheme = null;
  try {
    uiTheme = vscodeJson && typeof vscodeJson.uiTheme === 'string' ? vscodeJson.uiTheme : null;
  } catch (_) {}
  var isLight = false;
  try {
    if (uiTheme) isLight = String(uiTheme).toLowerCase().includes('light');
    else isLight = themeKey.toLowerCase().includes('light');
  } catch (_) { isLight = themeKey.toLowerCase().includes('light'); }
  var tokenColors = vscodeJson && vscodeJson.tokenColors ? vscodeJson.tokenColors : [];
  var colorsIn = vscodeJson && vscodeJson.colors ? vscodeJson.colors : {};
  var colors = {};
  try {
    for (var k in colorsIn) {
      if (!Object.prototype.hasOwnProperty.call(colorsIn, k)) continue;
      var v = colorsIn[k];
      if (typeof v === 'string') colors[k] = expandShortHex(v);
    }
  } catch (_) {}
  return {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: vscodeTokenColorsToMonacoRules(tokenColors).concat(buildSemanticTokenRules(tokenColors)),
    colors: colors,
  };
}
