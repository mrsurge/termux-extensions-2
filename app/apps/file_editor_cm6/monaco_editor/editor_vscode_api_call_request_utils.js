export function createVscodeApiCallPromise(pendingMap, id, method, timeoutMs, setTimeoutFn) {
  return new Promise(function (resolve, reject) {
    pendingMap.set(id, { resolve: resolve, reject: reject });
    setTimeoutFn(function () {
      if (!pendingMap.has(id)) return;
      pendingMap.delete(id);
      reject(new Error('vscode_api timeout: ' + method));
    }, timeoutMs);
  });
}
