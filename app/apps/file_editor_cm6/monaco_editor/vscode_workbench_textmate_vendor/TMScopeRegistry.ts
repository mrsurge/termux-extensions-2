/*
 * Vendored and adapted from VS Code workbench TextMate source.
 * Source lineage:
 * - vs/workbench/services/textMate/common/TMScopeRegistry.ts
 */

import * as resources from '../../../../static/vendor/monaco-editor-core/esm/vs/base/common/resources.js';
import { URI } from '../../../../static/vendor/monaco-editor-core/esm/vs/base/common/uri.js';

const STANDARD_TOKEN_TYPE_OTHER = 0;
const STANDARD_TOKEN_TYPE_COMMENT = 1;
const STANDARD_TOKEN_TYPE_STRING = 2;

export interface IValidGrammarDefinition {
  location: URI;
  language?: string;
  scopeName: string;
  embeddedLanguages: IValidEmbeddedLanguagesMap;
  tokenTypes: IValidTokenTypeMap;
  injectTo?: string[];
  balancedBracketSelectors: string[];
  unbalancedBracketSelectors: string[];
  sourceExtensionId?: string;
}

export interface IValidTokenTypeMap {
  [selector: string]: number;
}

export interface IValidEmbeddedLanguagesMap {
  [scopeName: string]: number;
}

export function standardTokenTypeFromString(value: unknown): number | null {
  switch (value) {
    case 'string':
      return STANDARD_TOKEN_TYPE_STRING;
    case 'comment':
      return STANDARD_TOKEN_TYPE_COMMENT;
    case 'other':
      return STANDARD_TOKEN_TYPE_OTHER;
    default:
      return null;
  }
}

export class TMScopeRegistry {
  private _scopeNameToLanguageRegistration: Record<string, IValidGrammarDefinition>;

  constructor() {
    this._scopeNameToLanguageRegistration = Object.create(null);
  }

  public reset(): void {
    this._scopeNameToLanguageRegistration = Object.create(null);
  }

  public register(def: IValidGrammarDefinition): void {
    const existingRegistration = this._scopeNameToLanguageRegistration[def.scopeName];
    if (existingRegistration && !resources.isEqual(existingRegistration.location, def.location)) {
      console.warn(
        `Overwriting grammar scope name to file mapping for scope ${def.scopeName}.\n` +
        `Old grammar file: ${existingRegistration.location.toString()}.\n` +
        `New grammar file: ${def.location.toString()}`,
      );
    }
    this._scopeNameToLanguageRegistration[def.scopeName] = def;
  }

  public getGrammarDefinition(scopeName: string): IValidGrammarDefinition | null {
    return this._scopeNameToLanguageRegistration[scopeName] || null;
  }
}
