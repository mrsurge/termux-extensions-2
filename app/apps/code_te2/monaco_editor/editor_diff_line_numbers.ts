// Presentation-only policy: never change the persisted relative-number choice.
export function withDiffLineNumbers(options: Record<string, unknown>): Record<string, unknown> {
  return options.lineNumbers === 'relative' ? { ...options, lineNumbers: 'on' } : { ...options };
}
