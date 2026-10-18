interface QueryInputBox {
  insertAtCursor(text: string): void;
}

/** Use the existing input-box value/change/layout owner, not a second editor. */
export function insertContentQueryNewline(event: KeyboardEvent, inputBox: QueryInputBox): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.key !== 'Enter' || !event.shiftKey
    || event.ctrlKey || event.altKey || event.metaKey) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  inputBox.insertAtCursor('\n');
  return true;
}
