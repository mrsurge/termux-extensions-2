import { dispatchSyntheticEditorKey, type SyntheticEditorKey, type SyntheticKeyModifiers } from '../src/mobile-input/terminal-special-key-bridge.ts';

export interface QuickInputEditor {
  getDomNode?(): HTMLElement | null;
  getAction?(id: string): { run?(): unknown } | null;
  trigger?(source: string, command: string, payload: unknown): void;
}
const owners = new WeakMap<Document, QuickInputEditor>();

export function focusedQuickInput(doc: Document): HTMLInputElement | null {
  const active = doc.activeElement;
  return active?.tagName === 'INPUT' && active.closest('.quick-input-widget')
    ? active as HTMLInputElement : null;
}

export function quickInputAction(editor: QuickInputEditor, key: string): boolean {
  const id = key.toLowerCase() === 'p' ? 'editor.action.quickCommand'
    : key.toLowerCase() === 'o' ? 'editor.action.quickOutline' : null;
  if (!id) return false;
  const action = editor.getAction?.(id);
  if (!action?.run) return false;
  const doc = editor.getDomNode?.()?.ownerDocument;
  if (doc) owners.set(doc, editor);
  void Promise.resolve(action.run()).catch(error => console.warn('[quick_input] action failed', error));
  return true;
}

// Synthetic keys reach Monaco's quick-pick handlers, but do not cause native
// caret movement. Supply that default only for the text-navigation keys below.
export function dispatchQuickInputKey(input: HTMLInputElement, key: SyntheticEditorKey, modifiers: SyntheticKeyModifiers): void {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key.key) && !modifiers.ctrl && !modifiers.alt) {
    const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
    const backward = input.selectionDirection === 'backward';
    const focus = backward ? start : end, anchor = backward ? end : start;
    const next = key.key === 'Home' ? 0 : key.key === 'End' ? input.value.length
      : Math.max(0, Math.min(input.value.length, focus + (key.key === 'ArrowLeft' ? -1 : 1)));
    if (modifiers.shift) input.setSelectionRange(Math.min(anchor, next), Math.max(anchor, next), next < anchor ? 'backward' : 'forward');
    else {
      const collapsed = start !== end && key.key === 'ArrowLeft' ? start : start !== end && key.key === 'ArrowRight' ? end : next;
      input.setSelectionRange(collapsed, collapsed);
    }
    return;
  }
  dispatchSyntheticEditorKey(input, key, modifiers);
}

export function shiftedCommittedText(text: string): string {
  // No guessed keyboard layout for punctuation. Unicode case conversion is
  // only applied to committed text; composition updates remain IME-owned.
  return text.toUpperCase();
}

export function bindQuickInputKeys(editor: QuickInputEditor, doc: Document,
  armed: () => boolean, consume: () => void,
  textAllowed: () => boolean = () => true,
  altArmed: () => boolean = () => false): () => void {
  const dom = editor.getDomNode?.();
  const owns = (target: EventTarget | null): boolean => {
    if (target && dom?.contains(target as Node)) { owners.set(doc, editor); return true; }
    return owners.get(doc) === editor && Boolean(focusedQuickInput(doc));
  };
  const focus = (event: Event): void => { if (dom?.contains(event.target as Node)) owners.set(doc, editor); };
  const keydown = (event: KeyboardEvent): void => {
    if (!owns(event.target) || event.isComposing || event.keyCode === 229) return;
    // Modifier keys compose with each other; only a non-modifier key consumes
    // the chord. Keep native IME/229 events outside this command path.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    const oneShot = armed();
    if (oneShot) Object.defineProperty(event, 'shiftKey', { configurable: true, value: true });
    if (altArmed()) Object.defineProperty(event, 'altKey', { configurable: true, value: true });
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.shiftKey || armed()) && /^[po]$/i.test(event.key)) {
      if (quickInputAction(editor, event.key)) { event.preventDefault(); event.stopImmediatePropagation(); consume(); }
    }
    if (oneShot && (event.ctrlKey || event.metaKey || event.altKey
      || (event.key.length > 1 && !['Dead', 'Unidentified', 'Process'].includes(event.key)))) queueMicrotask(consume);
  };
  const beforeinput = (event: InputEvent): void => {
    if (!armed() || !textAllowed() || !owns(event.target) || event.isComposing || !event.cancelable || event.inputType !== 'insertText' || !event.data) return;
    const text = shiftedCommittedText(event.data);
    const input = focusedQuickInput(doc);
    if (!input && !editor.trigger) return;
    event.preventDefault(); event.stopImmediatePropagation(); consume();
    if (input) {
      input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else editor.trigger?.('mobile-shift', 'type', { text });
  };
  doc.addEventListener('focusin', focus, true);
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('beforeinput', beforeinput, true);
  return () => {
    doc.removeEventListener('focusin', focus, true);
    doc.removeEventListener('keydown', keydown, true);
    doc.removeEventListener('beforeinput', beforeinput, true);
    if (owners.get(doc) === editor) owners.delete(doc);
  };
}
