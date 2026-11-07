interface Disposable { dispose(): void }

export interface ModelMirrorParticipant {
  isCurrent(): boolean;
  isConnected(): boolean;
  isApplyingRemote(): boolean;
  changed(): void;
  publish(): void;
  requestDraftDiff(): void;
  debounceMs(): number;
}

interface ModelPublisher {
  participants: Set<ModelMirrorParticipant>;
  subscription: Disposable;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One physical content listener and pending publication per model, not view. */
const publishers = new WeakMap<object, ModelPublisher>();

function selected(state: ModelPublisher): ModelMirrorParticipant | undefined {
  return [...state.participants].find(p => p.isCurrent() && p.isConnected());
}

function cancel(state: ModelPublisher): boolean {
  if (state.timer === null) return false;
  clearTimeout(state.timer);
  state.timer = null;
  return true;
}

export function attachModelMirror(
  model: object,
  participant: ModelMirrorParticipant,
  listen: (changed: () => void) => Disposable,
): Disposable & { flush(): void } {
  let state = publishers.get(model);
  if (!state) {
    const created: ModelPublisher = {
      participants: new Set(), timer: null, subscription: { dispose() {} },
    };
    state = created;
    publishers.set(model, created);
    try {
      created.subscription = listen(() => {
        if ([...created.participants].some(p => p.isApplyingRemote())) {
          cancel(created);
          return;
        }
        const publisher = selected(created);
        if (!publisher) return;
        for (const p of created.participants) if (p.isCurrent()) p.changed();
        cancel(created);
        created.timer = setTimeout(() => {
          created.timer = null;
          const current = selected(created);
          current?.publish();
          current?.requestDraftDiff();
        }, Math.max(0, publisher.debounceMs()));
      });
    } catch (error) {
      publishers.delete(model);
      throw error;
    }
  }
  const owned = state;
  owned.participants.add(participant);
  let disposed = false;
  return {
    flush() {
      if (!disposed && cancel(owned) &&
        ![...owned.participants].some(p => p.isApplyingRemote())) selected(owned)?.publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      owned.participants.delete(participant);
      if (!owned.participants.size) {
        cancel(owned);
        publishers.delete(model);
        owned.subscription.dispose();
      }
    },
  };
}
