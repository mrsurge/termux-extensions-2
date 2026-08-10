type ConsoleLevel = 'debug' | 'error' | 'info' | 'log' | 'warn';

type ConsoleMethod = (...args: unknown[]) => unknown;

export function patchConsoleLevels(
  levels: ConsoleLevel[],
  emitLogFn: (level: ConsoleLevel, args: unknown[]) => void,
): Partial<Record<ConsoleLevel, ConsoleMethod>> {
  const originals: Partial<Record<ConsoleLevel, ConsoleMethod>> = {};
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const method = console[level];
    if (typeof method !== 'function') continue;
    originals[level] = method.bind(console) as ConsoleMethod;
    console[level] = ((...args: unknown[]) => {
      try { emitLogFn(level, args); } catch (_) {}
      const original = originals[level];
      return typeof original === 'function' ? original(...args) : undefined;
    }) as ConsoleMethod;
  }
  return originals;
}
