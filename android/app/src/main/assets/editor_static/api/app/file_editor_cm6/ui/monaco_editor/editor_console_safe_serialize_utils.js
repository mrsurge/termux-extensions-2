export function safeSerializeConsoleArg(x) {
  var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  return JSON.stringify(x, function(_k, v) {
    if (typeof v === 'bigint') return 'BigInt(' + v.toString() + ')';
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'object' && v !== null && seen) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}
