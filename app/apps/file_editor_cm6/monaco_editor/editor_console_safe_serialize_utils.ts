export function safeSerializeConsoleArg(value: unknown): string {
  const seen = typeof WeakSet !== 'undefined' ? new WeakSet<object>() : null;
  return JSON.stringify(value, function (_key: string, next: unknown) {
    if (typeof next === 'bigint') return 'BigInt(' + next.toString() + ')';
    if (next instanceof Error) return { name: next.name, message: next.message, stack: next.stack };
    if (typeof next === 'object' && next !== null && seen) {
      if (seen.has(next)) return '[Circular]';
      seen.add(next);
    }
    return next;
  });
}
