import { toMonacoColorHex } from './editor_parse_utils.ts';

interface TokenColorSettings {
  foreground?: unknown;
  fontStyle?: unknown;
}

interface TokenColorEntry {
  scope?: string | string[];
  settings?: TokenColorSettings | null;
}

interface MonacoTokenRuleLike {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

const SEMANTIC_TO_TM_SCOPES: Record<string, string[]> = {
  comment: ['comment'],
  string: ['string'],
  keyword: ['keyword.control', 'keyword'],
  number: ['constant.numeric', 'constant'],
  regexp: ['constant.regexp', 'constant'],
  operator: ['keyword.operator', 'keyword'],
  namespace: ['entity.name.namespace', 'entity.name', 'entity'],
  type: ['entity.name.type', 'support.type', 'entity.name', 'entity'],
  struct: ['entity.name.type.struct', 'entity.name.type', 'entity.name', 'entity'],
  class: ['entity.name.type.class', 'entity.name.type', 'support.class', 'entity.name', 'entity'],
  interface: ['entity.name.type.interface', 'entity.name.type', 'entity.name', 'entity'],
  enum: ['entity.name.type.enum', 'entity.name.type', 'entity.name', 'entity'],
  typeParameter: ['entity.name.type.parameter', 'entity.name.type', 'entity.name', 'entity'],
  function: ['entity.name.function', 'support.function', 'entity.name', 'entity'],
  method: ['entity.name.function.member', 'entity.name.function', 'support.function', 'entity.name', 'entity'],
  macro: ['entity.name.function.preprocessor', 'entity.name.function', 'entity.name', 'entity'],
  variable: ['variable.other.readwrite', 'entity.name.variable', 'variable.other', 'variable'],
  parameter: ['variable.parameter', 'variable'],
  property: ['variable.other.property', 'variable.other', 'variable'],
  enumMember: ['variable.other.enummember', 'variable.other', 'variable'],
  event: ['variable.other.event', 'variable.other', 'variable'],
  decorator: ['entity.name.decorator', 'entity.name.function', 'entity.name', 'entity'],
};

const SEMANTIC_MOD_TO_TM_SCOPES: Record<string, string[]> = {
  'variable.readonly': ['variable.other.constant', 'variable.other', 'variable'],
  'property.readonly': ['variable.other.constant.property', 'variable.other.constant', 'variable.other', 'variable'],
  'variable.defaultLibrary': ['support.variable', 'support'],
  'variable.defaultLibrary.readonly': ['support.constant', 'support'],
  'property.defaultLibrary': ['support.variable.property', 'support.variable', 'support'],
  'function.defaultLibrary': ['support.function', 'support'],
};

export function buildSemanticTokenRules(tokenColors: TokenColorEntry[]): MonacoTokenRuleLike[] {
  const scopeSettings: Record<string, TokenColorSettings> = {};
  if (!Array.isArray(tokenColors)) return [];
  for (let index = 0; index < tokenColors.length; index += 1) {
    const tokenColor = tokenColors[index];
    if (!tokenColor || !tokenColor.settings) continue;
    const scopes = tokenColor.scope;
    const scopeList = Array.isArray(scopes) ? scopes : typeof scopes === 'string' ? scopes.split(',') : [];
    for (let scopeIndex = 0; scopeIndex < scopeList.length; scopeIndex += 1) {
      const scope = String(scopeList[scopeIndex] || '').trim();
      if (scope) scopeSettings[scope] = tokenColor.settings;
    }
  }

  function resolve(tmScopes: string[]): TokenColorSettings | null {
    for (let index = 0; index < tmScopes.length; index += 1) {
      const settings = scopeSettings[tmScopes[index]];
      if (settings) return settings;
    }
    return null;
  }

  const rules: MonacoTokenRuleLike[] = [];
  function addRule(token: string, settings: TokenColorSettings | null): void {
    if (!settings) return;
    const rule: MonacoTokenRuleLike = { token };
    const foreground = toMonacoColorHex(settings.foreground as string | null | undefined);
    if (foreground) rule.foreground = foreground;
    if (typeof settings.fontStyle === 'string') rule.fontStyle = settings.fontStyle.trim();
    if (rule.foreground || rule.fontStyle) rules.push(rule);
  }

  for (const semanticType of Object.keys(SEMANTIC_TO_TM_SCOPES)) {
    addRule(semanticType, resolve(SEMANTIC_TO_TM_SCOPES[semanticType]));
  }
  for (const semanticModifier of Object.keys(SEMANTIC_MOD_TO_TM_SCOPES)) {
    addRule(semanticModifier, resolve(SEMANTIC_MOD_TO_TM_SCOPES[semanticModifier]));
  }
  return rules;
}
