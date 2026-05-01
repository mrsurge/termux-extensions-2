import { toMonacoColorHex } from './editor_parse_utils.ts';

interface TokenColorSettings {
  foreground?: unknown;
  background?: unknown;
  fontStyle?: unknown;
}

interface TokenColorEntry {
  scope?: string | string[];
  settings?: TokenColorSettings | null;
}

interface MonacoTokenRuleLike {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export function vscodeTokenColorsToMonacoRules(tokenColors: TokenColorEntry[]): MonacoTokenRuleLike[] {
  const rules: MonacoTokenRuleLike[] = [];
  if (!Array.isArray(tokenColors)) return rules;
  for (let index = 0; index < tokenColors.length; index += 1) {
    const tokenColor = tokenColors[index];
    if (!tokenColor || !tokenColor.settings) continue;
    const foreground = toMonacoColorHex(tokenColor.settings.foreground as string | null | undefined);
    const background = toMonacoColorHex(tokenColor.settings.background as string | null | undefined);
    const fontStyle = typeof tokenColor.settings.fontStyle === 'string'
      ? tokenColor.settings.fontStyle.trim()
      : null;
    const scopes = tokenColor.scope;
    const scopeList = Array.isArray(scopes)
      ? scopes
      : (typeof scopes === 'string' ? scopes.split(',') : []);
    for (let scopeIndex = 0; scopeIndex < scopeList.length; scopeIndex += 1) {
      const rawScope = scopeList[scopeIndex];
      if (rawScope == null) continue;
      const scopeParts = String(rawScope || '').trim().split(/\s+/g);
      for (let partIndex = 0; partIndex < scopeParts.length; partIndex += 1) {
        const scope = String(scopeParts[partIndex] || '').trim();
        if (!scope) continue;
        const rule: MonacoTokenRuleLike = { token: scope };
        if (foreground) rule.foreground = foreground;
        if (background) rule.background = background;
        if (fontStyle) rule.fontStyle = fontStyle;
        if (rule.foreground || rule.background || rule.fontStyle) rules.push(rule);
      }
    }
  }
  return rules;
}
