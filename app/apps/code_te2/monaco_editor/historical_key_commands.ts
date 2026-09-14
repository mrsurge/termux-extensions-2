import type { SyntheticEditorKey, SyntheticKeyModifiers } from '../src/mobile-input/terminal-special-key-bridge.ts';

/** Explicit read-only commands; never forward arbitrary editing keys. */
export function historicalKeyCommand(key: SyntheticEditorKey, modifiers: SyntheticKeyModifiers): string | null {
  if (modifiers.alt) return null;
  const shift = Boolean(key.shiftKey || modifiers.shift);
  if (modifiers.ctrl) {
    if (key.key.toLowerCase() === 'f') return 'actions.find';
    if (key.key.toLowerCase() === 'a') return 'selectAll';
    if (key.key.toLowerCase() === 'c') return 'copy';
    if (key.key === 'Home') return shift ? 'cursorTopSelect' : 'cursorTop';
    if (key.key === 'End') return shift ? 'cursorBottomSelect' : 'cursorBottom';
    return null;
  }
  const commands: Record<string, string> = {
    ArrowLeft: 'cursorLeft', ArrowRight: 'cursorRight',
    ArrowUp: 'cursorUp', ArrowDown: 'cursorDown',
    Home: 'cursorHome', End: 'cursorEnd',
    PageUp: 'cursorPageUp', PageDown: 'cursorPageDown',
  };
  const command = commands[key.key];
  return command ? `${command}${shift ? 'Select' : ''}` : null;
}
