/** Shift text delivered by mobile IMEs without modifier events. */
export function shiftTerminalText(text: string): string {
  if (Array.from(text).length !== 1 || text.charCodeAt(0) < 32) return text;
  const plain = "`1234567890-=[]\\;',./";
  const shifted = '~!@#$%^&*()_+{}|:"<>?';
  const index = plain.indexOf(text);
  return index >= 0 ? shifted[index]! : text.toUpperCase();
}
