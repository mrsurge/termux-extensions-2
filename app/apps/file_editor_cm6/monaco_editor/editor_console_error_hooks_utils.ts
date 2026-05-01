export function installConsoleErrorHooks(
  win: Window,
  emitLogFn: (level: string, args: unknown[]) => void,
): void {
  win.addEventListener('error', (event: ErrorEvent) => {
    emitLogFn('error', [event.message, event.filename, event.lineno, event.colno, event.error || null]);
  });
  win.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    emitLogFn('error', ['UnhandledRejection', event.reason]);
  });
}
