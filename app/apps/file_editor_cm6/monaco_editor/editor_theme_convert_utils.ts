import { expandShortHex } from './editor_parse_utils.ts';
import { vscodeTokenColorsToMonacoRules } from './editor_theme_rules_utils.ts';
import { buildSemanticTokenRules } from './editor_semantic_token_rules_utils.ts';

interface TokenColorSettings {
  foreground?: unknown;
  background?: unknown;
  fontStyle?: unknown;
}

interface TokenColorEntry {
  scope?: string | string[];
  settings?: TokenColorSettings | null;
}

interface VscodeThemeJsonLike {
  uiTheme?: string;
  tokenColors?: TokenColorEntry[];
  colors?: Record<string, unknown>;
}

export function vscodeThemeToMonacoTheme(
  themeId: string,
  vscodeJson: unknown,
): { base: string; inherit: boolean; rules: unknown[]; colors: Record<string, string> } {
  const themeJson = vscodeJson as VscodeThemeJsonLike | null | undefined;
  const themeKey = String(themeId || '');
  let uiTheme: string | null = null;
  try { uiTheme = themeJson && typeof themeJson.uiTheme === 'string' ? themeJson.uiTheme : null; } catch (_) {}
  let isLight = false;
  try {
    if (uiTheme) isLight = uiTheme.toLowerCase().includes('light');
    else isLight = themeKey.toLowerCase().includes('light');
  } catch (_) {
    isLight = themeKey.toLowerCase().includes('light');
  }
  const tokenColors = themeJson && Array.isArray(themeJson.tokenColors) ? themeJson.tokenColors : [];
  const colorsIn = themeJson && themeJson.colors ? themeJson.colors : {};
  const colors: Record<string, string> = {};
  try {
    for (const key of Object.keys(colorsIn)) {
      const value = colorsIn[key];
      if (typeof value === 'string') {
        const expanded = expandShortHex(value);
        colors[key] = typeof expanded === 'string' ? expanded : value;
      }
    }
  } catch (_) {}
  return {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: vscodeTokenColorsToMonacoRules(tokenColors).concat(buildSemanticTokenRules(tokenColors)),
    colors,
  };
}
