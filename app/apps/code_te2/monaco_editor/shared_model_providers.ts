import type { LanguageContext, MonacoLanguagesLike, MonacoModelLike } from './editor_language_bridge_providers.ts';

interface Disposable { dispose(): void }
interface ProviderContext {
  context(): LanguageContext | null;
  focused(): boolean;
}
interface Participant<Provider> {
  provider: Provider;
  context: ProviderContext;
}
interface Entry<Provider> {
  participants: Set<Participant<Provider>>;
  registration: Disposable | null;
}

function isDisposable(value: unknown): value is Disposable {
  return value !== null && typeof value === 'object' &&
    'dispose' in value && typeof value.dispose === 'function';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' &&
    'then' in value && typeof value.then === 'function';
}

function fenceResult(result: unknown, current: () => boolean): unknown {
  return isThenable(result)
    ? Promise.resolve(result).then(value => current() ? value : undefined, (error: unknown) => {
      if (current()) throw error;
      return undefined;
    })
    : current() ? result : undefined;
}

function selectorKey(selector: unknown): string {
  if (typeof selector === 'string') return JSON.stringify(selector);
  if (selector !== null && typeof selector === 'object' && !Array.isArray(selector) &&
    'language' in selector && typeof selector.language === 'string' &&
    'scheme' in selector && typeof selector.scheme === 'string' &&
    'exclusive' in selector && typeof selector.exclusive === 'boolean' &&
    Object.keys(selector).every(key => key === 'language' || key === 'scheme' || key === 'exclusive')) {
    return JSON.stringify([selector.language, selector.scheme, selector.exclusive]);
  }
  // These seven owned producers use language strings or exact file selectors.
  // Do not collapse future selector forms into an ambiguous shared identity.
  throw new Error('Unsupported shared model-provider selector.');
}

class ModelProviderRouter<Provider> {
  private readonly entries = new Map<string, Entry<Provider>>();

  acquire(
    selector: unknown, provider: Provider, context: ProviderContext,
    install: (invoke: (model: MonacoModelLike, call: (provider: Provider) => unknown) => unknown) => unknown,
  ): Disposable {
    const key = selectorKey(selector);
    let entry = this.entries.get(key);
    const participant = { provider, context };
    if (!entry) {
      const created: Entry<Provider> = { participants: new Set([participant]), registration: null };
      entry = created;
      this.entries.set(key, created);
      try {
        const registration = install((model, call) => {
          const uri = model?.uri?.toString();
          if (!uri || model.isDisposed?.()) return undefined;
          const version = model.getVersionId?.();
          let selected: Participant<Provider> | undefined;
          let snapshot: LanguageContext | null = null;
          for (const candidate of created.participants) {
            const current = candidate.context.context();
            if (!current || current.uri !== uri) continue;
            if (typeof version === 'number' && current.version !== version) continue;
            const focused = candidate.context.focused();
            if (!selected || focused) {
              selected = candidate;
              snapshot = { ...current };
            }
            if (focused) break;
          }
          if (!selected || !snapshot) return undefined;
          const producer = selected, initial = snapshot;
          return fenceResult(call(producer.provider), () => {
            if (!created.participants.has(producer) || model.isDisposed?.()) return false;
            const now = producer.context.context();
            return !!now && now.uri === initial.uri && now.path === initial.path &&
              now.languageId === initial.languageId && now.version === initial.version &&
              (model.getVersionId?.() ?? initial.version) === initial.version;
          });
        });
        if (!isDisposable(registration)) throw new Error('Monaco provider registration has no disposal handle.');
        created.registration = registration;
      } catch (error) {
        created.participants.clear();
        this.entries.delete(key);
        throw error;
      }
    } else entry.participants.add(participant);
    const owned = entry;
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        owned.participants.delete(participant);
        if (!owned.participants.size) {
          this.entries.delete(key);
          owned.registration?.dispose();
        }
      },
    };
  }
}

type Hover = Parameters<NonNullable<MonacoLanguagesLike['registerHoverProvider']>>[1];
type Symbols = Parameters<NonNullable<MonacoLanguagesLike['registerDocumentSymbolProvider']>>[1];
type Folding = Parameters<NonNullable<MonacoLanguagesLike['registerFoldingRangeProvider']>>[1];
type Highlights = Parameters<NonNullable<MonacoLanguagesLike['registerDocumentHighlightProvider']>>[1];
type Definition = Parameters<NonNullable<MonacoLanguagesLike['registerDefinitionProvider']>>[1];
type References = Parameters<NonNullable<MonacoLanguagesLike['registerReferenceProvider']>>[1];
type Implementation = Parameters<NonNullable<MonacoLanguagesLike['registerImplementationProvider']>>[1];

interface NamespaceRouters {
  hover: ModelProviderRouter<Hover>;
  symbols: ModelProviderRouter<Symbols>;
  folding: ModelProviderRouter<Folding>;
  highlights: ModelProviderRouter<Highlights>;
  definition: ModelProviderRouter<Definition>;
  references: ModelProviderRouter<References>;
  implementation: ModelProviderRouter<Implementation>;
}
const namespaces = new WeakMap<MonacoLanguagesLike, NamespaceRouters>();

/** Leave retained-result providers untouched until producer affinity is wired. */
export function sharedModelProviders(languages: MonacoLanguagesLike, context: ProviderContext): MonacoLanguagesLike {
  let shared = namespaces.get(languages);
  if (!shared) {
    shared = {
      hover: new ModelProviderRouter(), symbols: new ModelProviderRouter(),
      folding: new ModelProviderRouter(), highlights: new ModelProviderRouter(),
      definition: new ModelProviderRouter(), references: new ModelProviderRouter(),
      implementation: new ModelProviderRouter(),
    };
    namespaces.set(languages, shared);
  }
  const routers = shared;
  return {
    ...languages,
    registerHoverProvider: languages.registerHoverProvider ? (selector, provider) =>
      routers.hover.acquire(selector, provider, context, invoke => languages.registerHoverProvider?.(selector, {
        provideHover: (model, position, token) => invoke(model, source => source.provideHover(model, position, token)),
      })) : undefined,
    registerDocumentSymbolProvider: languages.registerDocumentSymbolProvider ? (selector, provider) =>
      routers.symbols.acquire(selector, provider, context, invoke => languages.registerDocumentSymbolProvider?.(selector, {
        provideDocumentSymbols: (model, token) => invoke(model, source => source.provideDocumentSymbols(model, token)),
      })) : undefined,
    registerFoldingRangeProvider: languages.registerFoldingRangeProvider ? (selector, provider) =>
      routers.folding.acquire(selector, provider, context, invoke => languages.registerFoldingRangeProvider?.(selector, {
        provideFoldingRanges: (model, foldingContext, token) => invoke(model, source => source.provideFoldingRanges(model, foldingContext, token)),
      })) : undefined,
    registerDocumentHighlightProvider: languages.registerDocumentHighlightProvider ? (selector, provider) =>
      routers.highlights.acquire(selector, provider, context, invoke => languages.registerDocumentHighlightProvider?.(selector, {
        provideDocumentHighlights: (model, position, token) => invoke(model, source => source.provideDocumentHighlights(model, position, token)),
      })) : undefined,
    registerDefinitionProvider: languages.registerDefinitionProvider ? (selector, provider) =>
      routers.definition.acquire(selector, provider, context, invoke => languages.registerDefinitionProvider?.(selector, {
        provideDefinition: (model, position, token) => invoke(model, source => source.provideDefinition(model, position, token)),
      })) : undefined,
    registerReferenceProvider: languages.registerReferenceProvider ? (selector, provider) =>
      routers.references.acquire(selector, provider, context, invoke => languages.registerReferenceProvider?.(selector, {
        provideReferences: (model, position, referenceContext, token) => invoke(model, source => source.provideReferences(model, position, referenceContext, token)),
      })) : undefined,
    registerImplementationProvider: languages.registerImplementationProvider ? (selector, provider) =>
      routers.implementation.acquire(selector, provider, context, invoke => languages.registerImplementationProvider?.(selector, {
        provideImplementation: (model, position, token) => invoke(model, source => source.provideImplementation(model, position, token)),
      })) : undefined,
  };
}
