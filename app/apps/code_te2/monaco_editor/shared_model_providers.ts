import type { LanguageContext, MonacoLanguagesLike, MonacoModelLike } from './editor_language_bridge_providers.ts';
import { isUnknownArray } from '../src/rpc/value-types.ts';

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
  const accept = (value: unknown): unknown => {
    if (current()) return value;
    if (isDisposable(value)) value.dispose();
    return undefined;
  };
  return isThenable(result)
    ? Promise.resolve(result).then(accept, (error: unknown) => {
      if (current()) throw error;
      return undefined;
    })
    : accept(result);
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
    identity?: string,
  ): Disposable {
    const key = identity ?? selectorKey(selector);
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
type Completion = Parameters<NonNullable<MonacoLanguagesLike['registerCompletionItemProvider']>>[1];
type Inlay = Parameters<NonNullable<MonacoLanguagesLike['registerInlayHintsProvider']>>[1];
type Inline = Parameters<NonNullable<MonacoLanguagesLike['registerInlineCompletionsProvider']>>[1];
type Color = Parameters<NonNullable<MonacoLanguagesLike['registerColorProvider']>>[1];
type FullSemantic = Parameters<NonNullable<MonacoLanguagesLike['registerDocumentSemanticTokensProvider']>>[1];
type RangeSemantic = Parameters<NonNullable<MonacoLanguagesLike['registerDocumentRangeSemanticTokensProvider']>>[1];
type Legend = ReturnType<FullSemantic['getLegend']>;

interface SemanticEventsGroup {
  legend: Legend;
  listeners: Set<() => void>;
  owners: number;
}

/** Immutable legend groups prevent token indices from being decoded with another legend. */
class SemanticEvents {
  private readonly groups = new Map<string, SemanticEventsGroup>();

  acquire(selector: unknown, provider: Pick<FullSemantic, 'getLegend' | 'onDidChange'>) {
    const raw = provider.getLegend();
    const legend = { tokenTypes: [...raw.tokenTypes], tokenModifiers: [...raw.tokenModifiers] };
    const signature = JSON.stringify([legend.tokenTypes, legend.tokenModifiers]);
    const key = JSON.stringify([selectorKey(selector), signature]);
    let group = this.groups.get(key);
    if (!group) {
      group = { legend, listeners: new Set(), owners: 0 };
      this.groups.set(key, group);
    }
    const owned = group;
    owned.owners++;
    let disposed = false;
    const subscription = provider.onDidChange?.(() => {
      if (!disposed) for (const listener of [...owned.listeners]) listener();
    });
    return {
      key,
      current: () => JSON.stringify([provider.getLegend().tokenTypes, provider.getLegend().tokenModifiers]) === signature,
      getLegend: () => owned.legend,
      event: (listener: () => void): Disposable => {
        owned.listeners.add(listener);
        return { dispose: () => { owned.listeners.delete(listener); } };
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        subscription?.dispose();
        if (--owned.owners === 0) {
          owned.listeners.clear(); this.groups.delete(key);
        } else for (const listener of [...owned.listeners]) listener();
      },
    };
  }
}

interface SemanticResultOwner {
  source: FullSemantic;
  id: string;
  uri: string;
  release(): void;
}

class FullSemanticRouter {
  private readonly router = new ModelProviderRouter<FullSemantic>();
  private readonly events = new SemanticEvents();
  private readonly results = new Map<string, SemanticResultOwner>();
  private sequence = 0;

  acquire(languages: MonacoLanguagesLike, selector: unknown, provider: FullSemantic, context: ProviderContext): Disposable {
    const register = languages.registerDocumentSemanticTokensProvider;
    if (!register) throw new Error('Semantic token registration is unavailable.');
    const events = this.events.acquire(selector, provider);
    const guardedContext = { ...context, context: () => events.current() ? context.context() : null };
    let lease: Disposable;
    try {
      lease = this.router.acquire(selector, provider, guardedContext, invoke => register.call(languages, selector, {
        getLegend: events.getLegend, onDidChange: events.event,
        provideDocumentSemanticTokens: (model, lastResultId, token) => invoke(model, source => {
          const previous = lastResultId ? this.results.get(lastResultId) : undefined;
          const uri = model.uri?.toString() ?? '';
          // A different producer cannot consume this runtime's delta cache.
          const originalId = previous?.source === source && previous.uri === uri ? previous.id : undefined;
          return mapResult(source.provideDocumentSemanticTokens(model, originalId, token), result => {
            if (!isRecord(result) || typeof result.resultId !== 'string') return result;
            const id = result.resultId, alias = `te2.semantic.${++this.sequence}`;
            let released = false;
            const release = (): void => {
              if (released) return;
              released = true;
              this.results.delete(alias);
              source.releaseDocumentSemanticTokens(id);
            };
            this.results.set(alias, { source, id, uri, release });
            return { ...result, resultId: alias, dispose: release };
          });
        }),
        releaseDocumentSemanticTokens: id => this.results.get(id)?.release(),
      }), events.key);
    } catch (error) { events.dispose(); throw error; }
    return { dispose: () => {
      lease.dispose(); events.dispose();
      for (const owner of [...this.results.values()]) if (owner.source === provider) owner.release();
    } };
  }
}

class RangeSemanticRouter {
  private readonly router = new ModelProviderRouter<RangeSemantic>();
  private readonly events = new SemanticEvents();

  acquire(languages: MonacoLanguagesLike, selector: unknown, provider: RangeSemantic, context: ProviderContext): Disposable {
    const register = languages.registerDocumentRangeSemanticTokensProvider;
    if (!register) throw new Error('Range semantic token registration is unavailable.');
    const events = this.events.acquire(selector, provider);
    const guardedContext = { ...context, context: () => events.current() ? context.context() : null };
    let lease: Disposable;
    try {
      lease = this.router.acquire(selector, provider, guardedContext, invoke => register.call(languages, selector, {
        getLegend: events.getLegend, onDidChange: events.event,
        provideDocumentRangeSemanticTokens: (model, range, token) => invoke(model,
          source => source.provideDocumentRangeSemanticTokens(model, range, token)),
      }), events.key);
    } catch (error) { events.dispose(); throw error; }
    return { dispose: () => { lease.dispose(); events.dispose(); } };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class CompletionRouter {
  private readonly router = new ModelProviderRouter<Completion>();
  private readonly owners = new WeakMap<Record<string, unknown>, Completion>();
  private readonly active = new Set<Completion>();

  acquire(languages: MonacoLanguagesLike, selector: unknown, provider: Completion, context: ProviderContext): Disposable {
    const register = languages.registerCompletionItemProvider;
    if (!register) throw new Error('Completion registration is unavailable.');
    const key = provider.__te2ProviderKey;
    if (!key) throw new Error('Shared completion provider has no producer identity.');
    const lease = this.router.acquire(selector, provider, context, invoke => register.call(languages, selector, {
      __te2WorkbenchProvider: true,
      triggerCharacters: provider.triggerCharacters,
      provideCompletionItems: (model, position, completionContext, token) => invoke(model, source => {
        const retain = (result: unknown): unknown => {
          if (!isRecord(result) || !isUnknownArray(result.suggestions)) return result;
          const suggestions = result.suggestions.filter(isRecord);
          for (const suggestion of suggestions) this.owners.set(suggestion, source);
          let disposed = false;
          return { ...result, dispose: () => {
            if (disposed) return;
            disposed = true;
            for (const suggestion of suggestions) this.owners.delete(suggestion);
            if (isDisposable(result)) result.dispose();
          } };
        };
        const result = source.provideCompletionItems(model, position, completionContext, token);
        return isThenable(result) ? Promise.resolve(result).then(retain) : retain(result);
      }),
      ...(provider.resolveCompletionItem ? {
        resolveCompletionItem: (suggestion, token) => {
          const owner = this.owners.get(suggestion);
          return owner && this.active.has(owner)
            ? owner.resolveCompletionItem?.(suggestion, token) ?? suggestion : suggestion;
        },
      } : {}),
    }), key);
    this.active.add(provider);
    return { dispose: () => { this.active.delete(provider); lease.dispose(); } };
  }
}

function mapResult(result: unknown, map: (value: unknown) => unknown): unknown {
  return isThenable(result) ? Promise.resolve(result).then(map) : map(result);
}

class InlayRouter {
  private readonly router = new ModelProviderRouter<Inlay>();
  private readonly owners = new WeakMap<Record<string, unknown>, Inlay>();
  private readonly active = new Set<Inlay>();

  acquire(languages: MonacoLanguagesLike, selector: unknown, provider: Inlay, context: ProviderContext): Disposable {
    const register = languages.registerInlayHintsProvider;
    if (!register || !provider.__te2ProviderKey) throw new Error('Shared inlay provider has no registration/identity.');
    const lease = this.router.acquire(selector, provider, context, invoke => register.call(languages, selector, {
      displayName: provider.displayName,
      provideInlayHints: (model, range, token) => invoke(model, source => mapResult(
        source.provideInlayHints(model, range, token), result => {
          if (!isRecord(result) || !isUnknownArray(result.hints)) return result;
          const hints = result.hints.filter(isRecord);
          for (const hint of hints) this.owners.set(hint, source);
          let disposed = false;
          return { ...result, dispose: () => {
            if (disposed) return;
            disposed = true;
            for (const hint of hints) this.owners.delete(hint);
            if (isDisposable(result)) result.dispose();
          } };
        },
      )),
      resolveInlayHint: (hint, token) => {
        const owner = this.owners.get(hint);
        return owner && this.active.has(owner) ? owner.resolveInlayHint?.(hint, token) ?? hint : hint;
      },
    }), provider.__te2ProviderKey);
    this.active.add(provider);
    return { dispose: () => { this.active.delete(provider); lease.dispose(); } };
  }
}

interface InlineOwner {
  source: Inline;
  original: Record<string, unknown>;
  free(reason: Record<string, unknown>): void;
  freed(): boolean;
}

class InlineRouter {
  private readonly router = new ModelProviderRouter<Inline>();
  private readonly owners = new WeakMap<Record<string, unknown>, InlineOwner>();
  private readonly active = new Set<Inline>();

  acquire(languages: MonacoLanguagesLike, selector: unknown, provider: Inline, context: ProviderContext): Disposable {
    const register = languages.registerInlineCompletionsProvider;
    if (!register || !provider.__te2ProviderKey) throw new Error('Shared inline provider has no registration/identity.');
    const lease = this.router.acquire(selector, provider, context, invoke => register.call(languages, selector, {
      groupId: provider.groupId, yieldsToGroupIds: provider.yieldsToGroupIds,
      excludesGroupIds: provider.excludesGroupIds, displayName: provider.displayName,
      debounceDelayMs: provider.debounceDelayMs,
      toString: () => provider.toString?.() ?? 'InlineCompletionsProvider',
      provideInlineCompletions: (model, position, completionContext, token) => invoke(model, source => mapResult(
        source.provideInlineCompletions(model, position, completionContext, token), result => {
          if (!isRecord(result)) return result;
          let freed = false;
          const free = (reason: Record<string, unknown>): void => {
            if (freed) return;
            freed = true;
            source.disposeInlineCompletions(result, reason);
          };
          const retained = { ...result, dispose: () => free({ kind: 'other' }) };
          this.owners.set(retained, { source, original: result, free, freed: () => freed });
          return retained;
        },
      )),
      handleItemDidShow: (list, item, text, delta) => {
        const owner = this.owners.get(list);
        if (owner && !owner.freed() && this.active.has(owner.source)) {
          return owner.source.handleItemDidShow?.(owner.original, item, text, delta);
        }
        return undefined;
      },
      disposeInlineCompletions: (list, reason) => this.owners.get(list)?.free(reason),
    }), provider.__te2ProviderKey);
    this.active.add(provider);
    return { dispose: () => { this.active.delete(provider); lease.dispose(); } };
  }
}

interface NamespaceRouters {
  hover: ModelProviderRouter<Hover>;
  symbols: ModelProviderRouter<Symbols>;
  folding: ModelProviderRouter<Folding>;
  highlights: ModelProviderRouter<Highlights>;
  definition: ModelProviderRouter<Definition>;
  references: ModelProviderRouter<References>;
  implementation: ModelProviderRouter<Implementation>;
  completion: CompletionRouter;
  inlay: InlayRouter;
  inline: InlineRouter;
  color: ModelProviderRouter<Color>;
  fullSemantic: FullSemanticRouter;
  rangeSemantic: RangeSemanticRouter;
}
const namespaces = new WeakMap<MonacoLanguagesLike, NamespaceRouters>();

/** Shared model routing; retained completions preserve their producing provider. */
export function sharedModelProviders(languages: MonacoLanguagesLike, context: ProviderContext): MonacoLanguagesLike {
  let shared = namespaces.get(languages);
  if (!shared) {
    shared = {
      hover: new ModelProviderRouter(), symbols: new ModelProviderRouter(),
      folding: new ModelProviderRouter(), highlights: new ModelProviderRouter(),
      definition: new ModelProviderRouter(), references: new ModelProviderRouter(),
      implementation: new ModelProviderRouter(),
      completion: new CompletionRouter(),
      inlay: new InlayRouter(), inline: new InlineRouter(),
      color: new ModelProviderRouter(), fullSemantic: new FullSemanticRouter(), rangeSemantic: new RangeSemanticRouter(),
    };
    namespaces.set(languages, shared);
  }
  const routers = shared;
  return {
    ...languages,
    registerColorProvider: languages.registerColorProvider ? (selector, provider) => provider.__te2ProviderKey
      ? routers.color.acquire(selector, provider, context, invoke => languages.registerColorProvider?.(selector, {
        __te2WorkbenchColorProvider: true,
        provideDocumentColors: (model, token) => invoke(model, source => source.provideDocumentColors(model, token)),
        provideColorPresentations: (model, info, token) => invoke(model, source => source.provideColorPresentations(model, info, token)),
      }), JSON.stringify([selectorKey(selector), provider.__te2ProviderKey]))
      : languages.registerColorProvider?.(selector, provider) : undefined,
    registerDocumentSemanticTokensProvider: languages.registerDocumentSemanticTokensProvider ? (selector, provider) =>
      routers.fullSemantic.acquire(languages, selector, provider, context) : undefined,
    registerDocumentRangeSemanticTokensProvider: languages.registerDocumentRangeSemanticTokensProvider ? (selector, provider) =>
      routers.rangeSemantic.acquire(languages, selector, provider, context) : undefined,
    registerInlayHintsProvider: languages.registerInlayHintsProvider ? (selector, provider) =>
      provider.__te2ProviderKey ? routers.inlay.acquire(languages, selector, provider, context)
        : languages.registerInlayHintsProvider?.(selector, provider) : undefined,
    registerInlineCompletionsProvider: languages.registerInlineCompletionsProvider ? (selector, provider) =>
      provider.__te2ProviderKey ? routers.inline.acquire(languages, selector, provider, context)
        : languages.registerInlineCompletionsProvider?.(selector, provider) : undefined,
    registerCompletionItemProvider: languages.registerCompletionItemProvider ? (selector, provider) =>
      provider.__te2ProviderKey
        ? routers.completion.acquire(languages, selector, provider, context)
        : languages.registerCompletionItemProvider?.(selector, provider) : undefined,
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
