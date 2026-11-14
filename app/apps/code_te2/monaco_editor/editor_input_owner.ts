interface InputParticipant {
  root: HTMLElement;
  textFocused(): boolean;
}
interface InputOwners {
  participants: Set<InputParticipant>;
  active: InputParticipant | null;
}
const windows = new WeakMap<Window, InputOwners>();

const eligible = (candidate: InputParticipant): boolean => candidate.root.isConnected && !candidate.root.closest('[hidden]');

/** Query the same owner used by keyboard/palette routing without another registration. */
export function isEditorInputOwner(root: HTMLElement): boolean {
  const win = root.ownerDocument.defaultView;
  const owners = win ? windows.get(win) : undefined;
  if (!owners) return false;
  const live = [...owners.participants].filter(eligible);
  const focused = live.find(candidate => root.ownerDocument.activeElement?.closest('[data-te2-working-editor-host]') === candidate.root)
    ?? live.find(candidate => candidate.textFocused());
  if (focused) owners.active = focused;
  if (!owners.active || !live.includes(owners.active)) owners.active = live[0] ?? null;
  return owners.active?.root === root;
}

/** Presentation ownership only: this never changes backend opened-document state. */
export function registerEditorInputOwner(root: HTMLElement, textFocused: () => boolean) {
  const win = root.ownerDocument.defaultView;
  if (!win) throw new Error('Working editor input requires an attached window.');
  let state = windows.get(win);
  if (!state) {
    state = { participants: new Set(), active: null };
    windows.set(win, state);
  }
  const owners = state;
  if ([...owners.participants].some(participant => participant.root === root)) {
    throw new Error('Working editor mount already has an input owner.');
  }
  const participant = { root, textFocused };
  owners.participants.add(participant);
  let disposed = false;
  function activate(): void {
    if (!disposed && eligible(participant)) owners.active = participant;
  }
  function onInteraction(event: Event): void {
    // A nested editor must not activate its enclosing mount as well.
    const nearest = event.composedPath().find(target =>
      [...owners.participants].some(candidate => candidate.root === target));
    if (nearest === root) activate();
  }
  root.addEventListener('focusin', onInteraction);
  root.addEventListener('pointerdown', onInteraction);
  return {
    activate,
    isActive(): boolean {
      if (disposed || !eligible(participant)) return false;
      return isEditorInputOwner(root);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeEventListener('focusin', onInteraction);
      root.removeEventListener('pointerdown', onInteraction);
      owners.participants.delete(participant);
      if (owners.active === participant) owners.active = null;
      if (!owners.participants.size) windows.delete(win);
    },
  };
}
