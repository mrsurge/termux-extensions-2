/*
 * Vendored and adapted from VS Code workbench TextMate source.
 * Source lineage:
 * - vs/workbench/services/textMate/common/TMGrammarFactory.ts
 */

import { Disposable } from '../../../../static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';
import { URI } from '../../../../static/vendor/monaco-editor-core/esm/vs/base/common/uri.js';
import { IValidEmbeddedLanguagesMap, IValidGrammarDefinition, TMScopeRegistry } from './TMScopeRegistry.js';

interface TextmateOnigLibLike {
  createOnigScanner(sources: string[]): unknown;
  createOnigString(str: string): unknown;
}

interface TextmateGrammarLike {
  tokenizeLine(lineText: string, prevState: unknown, timeLimit?: number): {
    tokens: Array<{ startIndex: number; endIndex: number; scopes?: string[] }>;
    ruleStack: unknown;
    stoppedEarly?: boolean;
  };
  tokenizeLine2(lineText: string, prevState: unknown, timeLimit?: number): {
    tokens: Uint32Array;
    ruleStack: unknown;
    stoppedEarly?: boolean;
  };
}

interface TextmateRegistryLike {
  setTheme(theme: Record<string, unknown>, colorMap?: string[]): void;
  getColorMap(): string[];
  loadGrammarWithConfiguration(
    scopeName: string,
    encodedLanguageId: number,
    configuration: Record<string, unknown>,
  ): Promise<TextmateGrammarLike | null>;
}

interface TextmateModuleLike {
  INITIAL: unknown;
  Registry: new (options: {
    onigLib: Promise<TextmateOnigLibLike>;
    loadGrammar(scopeName: string): Promise<unknown>;
    getInjections?(scopeName: string): string[];
  }) => TextmateRegistryLike;
  parseRawGrammar(content: string, filePath: string): unknown;
}

interface ITMGrammarFactoryHost {
  logTrace(msg: string): void;
  logError(msg: string, err: unknown): void;
  readFile(resource: URI): Promise<string>;
}

export interface ICreateGrammarResult {
  languageId: string;
  grammar: TextmateGrammarLike | null;
  initialState: unknown;
  containsEmbeddedLanguages: boolean;
  sourceExtensionId?: string;
}

export const missingTMGrammarErrorMessage = 'No TM Grammar registered for this language.';

export class TMGrammarFactory extends Disposable {
  private readonly _host: ITMGrammarFactoryHost;
  private readonly _initialState: unknown;
  private readonly _scopeRegistry: TMScopeRegistry;
  private readonly _injections: Record<string, string[]>;
  private readonly _injectedEmbeddedLanguages: Record<string, IValidEmbeddedLanguagesMap[]>;
  private readonly _languageToScope: Map<string, string>;
  private readonly _grammarRegistry: TextmateRegistryLike;

  constructor(
    host: ITMGrammarFactoryHost,
    grammarDefinitions: IValidGrammarDefinition[],
    vscodeTextmate: TextmateModuleLike,
    onigLib: Promise<TextmateOnigLibLike>,
  ) {
    super();
    this._host = host;
    this._initialState = vscodeTextmate.INITIAL;
    this._scopeRegistry = new TMScopeRegistry();
    this._injections = Object.create(null);
    this._injectedEmbeddedLanguages = Object.create(null);
    this._languageToScope = new Map<string, string>();
    this._grammarRegistry = new vscodeTextmate.Registry({
      onigLib,
      loadGrammar: async (scopeName: string) => {
        const grammarDefinition = this._scopeRegistry.getGrammarDefinition(scopeName);
        if (!grammarDefinition) {
          this._host.logTrace(`No grammar found for scope ${scopeName}`);
          return null;
        }
        const location = grammarDefinition.location;
        try {
          const content = await this._host.readFile(location);
          return vscodeTextmate.parseRawGrammar(content, location.path);
        } catch (error) {
          this._host.logError(`Unable to load and parse grammar for scope ${scopeName} from ${location}`, error);
          return null;
        }
      },
      getInjections: (scopeName: string) => {
        const scopeParts = scopeName.split('.');
        let injections: string[] = [];
        for (let i = 1; i <= scopeParts.length; i += 1) {
          const subScopeName = scopeParts.slice(0, i).join('.');
          injections = injections.concat(this._injections[subScopeName] || []);
        }
        return injections;
      },
    });

    for (const validGrammar of grammarDefinitions) {
      this._scopeRegistry.register(validGrammar);

      if (validGrammar.injectTo) {
        for (const injectScope of validGrammar.injectTo) {
          const injections = this._injections[injectScope] || (this._injections[injectScope] = []);
          injections.push(validGrammar.scopeName);
        }

        if (validGrammar.embeddedLanguages) {
          for (const injectScope of validGrammar.injectTo) {
            const embedded = this._injectedEmbeddedLanguages[injectScope] || (this._injectedEmbeddedLanguages[injectScope] = []);
            embedded.push(validGrammar.embeddedLanguages);
          }
        }
      }

      if (validGrammar.language) {
        this._languageToScope.set(validGrammar.language, validGrammar.scopeName);
      }
    }
  }

  public has(languageId: string): boolean {
    return this._languageToScope.has(languageId);
  }

  public setTheme(theme: Record<string, unknown>, colorMap?: string[]): void {
    this._grammarRegistry.setTheme(theme, colorMap);
  }

  public getColorMap(): string[] {
    return this._grammarRegistry.getColorMap();
  }

  public async createGrammar(languageId: string, encodedLanguageId: number): Promise<ICreateGrammarResult> {
    const scopeName = this._languageToScope.get(languageId);
    if (typeof scopeName !== 'string') {
      throw new Error(missingTMGrammarErrorMessage);
    }

    const grammarDefinition = this._scopeRegistry.getGrammarDefinition(scopeName);
    if (!grammarDefinition) {
      throw new Error(missingTMGrammarErrorMessage);
    }

    const embeddedLanguages: IValidEmbeddedLanguagesMap = { ...grammarDefinition.embeddedLanguages };
    const injected = this._injectedEmbeddedLanguages[scopeName] || [];
    for (const injectedLanguages of injected) {
      for (const scope of Object.keys(injectedLanguages)) {
        embeddedLanguages[scope] = injectedLanguages[scope];
      }
    }

    const containsEmbeddedLanguages = Object.keys(embeddedLanguages).length > 0;

    try {
      const grammar = await this._grammarRegistry.loadGrammarWithConfiguration(scopeName, encodedLanguageId, {
        embeddedLanguages,
        tokenTypes: grammarDefinition.tokenTypes,
        balancedBracketSelectors: grammarDefinition.balancedBracketSelectors,
        unbalancedBracketSelectors: grammarDefinition.unbalancedBracketSelectors,
      });
      return {
        languageId,
        grammar,
        initialState: this._initialState,
        containsEmbeddedLanguages,
        sourceExtensionId: grammarDefinition.sourceExtensionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('No grammar provided for')) {
        throw new Error(missingTMGrammarErrorMessage);
      }
      throw error;
    }
  }
}
