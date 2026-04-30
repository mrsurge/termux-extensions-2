import { toMonacoColorHex } from './editor_parse_utils.ts';

var SEMANTIC_TO_TM_SCOPES = {
  'comment': ['comment'],
  'string': ['string'],
  'keyword': ['keyword.control', 'keyword'],
  'number': ['constant.numeric', 'constant'],
  'regexp': ['constant.regexp', 'constant'],
  'operator': ['keyword.operator', 'keyword'],
  'namespace': ['entity.name.namespace', 'entity.name', 'entity'],
  'type': ['entity.name.type', 'support.type', 'entity.name', 'entity'],
  'struct': ['entity.name.type.struct', 'entity.name.type', 'entity.name', 'entity'],
  'class': ['entity.name.type.class', 'entity.name.type', 'support.class', 'entity.name', 'entity'],
  'interface': ['entity.name.type.interface', 'entity.name.type', 'entity.name', 'entity'],
  'enum': ['entity.name.type.enum', 'entity.name.type', 'entity.name', 'entity'],
  'typeParameter': ['entity.name.type.parameter', 'entity.name.type', 'entity.name', 'entity'],
  'function': ['entity.name.function', 'support.function', 'entity.name', 'entity'],
  'method': ['entity.name.function.member', 'entity.name.function', 'support.function', 'entity.name', 'entity'],
  'macro': ['entity.name.function.preprocessor', 'entity.name.function', 'entity.name', 'entity'],
  'variable': ['variable.other.readwrite', 'entity.name.variable', 'variable.other', 'variable'],
  'parameter': ['variable.parameter', 'variable'],
  'property': ['variable.other.property', 'variable.other', 'variable'],
  'enumMember': ['variable.other.enummember', 'variable.other', 'variable'],
  'event': ['variable.other.event', 'variable.other', 'variable'],
  'decorator': ['entity.name.decorator', 'entity.name.function', 'entity.name', 'entity'],
};

var SEMANTIC_MOD_TO_TM_SCOPES = {
  'variable.readonly': ['variable.other.constant', 'variable.other', 'variable'],
  'property.readonly': ['variable.other.constant.property', 'variable.other.constant', 'variable.other', 'variable'],
  'variable.defaultLibrary': ['support.variable', 'support'],
  'variable.defaultLibrary.readonly': ['support.constant', 'support'],
  'property.defaultLibrary': ['support.variable.property', 'support.variable', 'support'],
  'function.defaultLibrary': ['support.function', 'support'],
};

export function buildSemanticTokenRules(tokenColors) {
  var scopeSettings = {};
  if (!Array.isArray(tokenColors)) return [];
  for (var i = 0; i < tokenColors.length; i++) {
    var tc = tokenColors[i];
    if (!tc || !tc.settings) continue;
    var scopes = tc.scope;
    var scopeList = Array.isArray(scopes) ? scopes : typeof scopes === 'string' ? scopes.split(',') : [];
    for (var j = 0; j < scopeList.length; j++) {
      var s = String(scopeList[j] || '').trim();
      if (s) scopeSettings[s] = tc.settings;
    }
  }

  function resolve(tmScopes) {
    for (var k = 0; k < tmScopes.length; k++) {
      if (scopeSettings[tmScopes[k]]) return scopeSettings[tmScopes[k]];
    }
    return null;
  }

  var rules = [];
  function addRule(token, settings) {
    if (!settings) return;
    var r = { token: token };
    var fg = toMonacoColorHex(settings.foreground);
    if (fg) r.foreground = fg;
    if (typeof settings.fontStyle === 'string') r.fontStyle = settings.fontStyle.trim();
    if (r.foreground || r.fontStyle) rules.push(r);
  }

  for (var semType in SEMANTIC_TO_TM_SCOPES) {
    if (!Object.prototype.hasOwnProperty.call(SEMANTIC_TO_TM_SCOPES, semType)) continue;
    addRule(semType, resolve(SEMANTIC_TO_TM_SCOPES[semType]));
  }
  for (var semMod in SEMANTIC_MOD_TO_TM_SCOPES) {
    if (!Object.prototype.hasOwnProperty.call(SEMANTIC_MOD_TO_TM_SCOPES, semMod)) continue;
    addRule(semMod, resolve(SEMANTIC_MOD_TO_TM_SCOPES[semMod]));
  }
  return rules;
}
