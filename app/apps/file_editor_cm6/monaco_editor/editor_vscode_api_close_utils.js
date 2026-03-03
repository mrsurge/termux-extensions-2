export function rejectAndClearVscodeApiPending(pendingMap, reason) {
  try {
    pendingMap.forEach(function (p) { try { p.reject(new Error(reason || 'vscode_api ws closed')); } catch (_) {} });
    pendingMap.clear();
  } catch (_) {}
}
