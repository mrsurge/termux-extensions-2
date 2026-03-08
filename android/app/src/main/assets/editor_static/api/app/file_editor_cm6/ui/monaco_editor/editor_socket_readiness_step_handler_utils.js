export function handleReadinessStep(data, emitToHostFn, onBatonReadyFn) {
  var step = data && data.step || '';
  var ok = data && data.ok;
  console.log('[readiness] step=' + step + ' ok=' + ok + (data && data.error ? ' error=' + data.error : ''));
  emitToHostFn('editor:readiness_step', data);
  if (step === 'baton' && ok) onBatonReadyFn();
}
