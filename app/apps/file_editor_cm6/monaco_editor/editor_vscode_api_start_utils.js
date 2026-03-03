export async function startVscodeApiService(fetchFn) {
  var startResp = await fetchFn('/api/app/file_editor_cm6/vscode_api/start', { cache: 'no-store' });
  var startJson = null;
  try { startJson = await startResp.json(); } catch (_) {}
  if (!startResp.ok || (startJson && startJson.ok === false)) {
    var startMsg = (startJson && (startJson.error || startJson.detail)) ? (startJson.error || startJson.detail) : ('HTTP ' + startResp.status);
    throw new Error('vscode_api start failed: ' + startMsg);
  }
}
