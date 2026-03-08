export function installConsoleErrorHooks(win, emitLogFn) {
  win.addEventListener('error', function(e) {
    emitLogFn('error', [e.message, e.filename, e.lineno, e.colno, e.error || null]);
  });
  win.addEventListener('unhandledrejection', function(e) {
    emitLogFn('error', ['UnhandledRejection', e.reason]);
  });
}
