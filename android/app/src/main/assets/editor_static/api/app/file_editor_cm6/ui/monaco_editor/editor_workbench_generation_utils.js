import { wbCurrentGeneration } from './editor_workbench_state_utils.js';

export function wbBumpGeneration(wbFlow, path, reason) {
  if (!wbFlow) return 0;
  wbFlow.generation = wbCurrentGeneration(wbFlow) + 1;
  wbFlow.activePath = String(path || '');
  wbFlow.openAckGeneration = -1;
  wbFlow.openAckPath = '';
  wbFlow.pendingDidChange = null;
  wbFlow.pendingSymbols = null;
  try {
    console.log('[workbench-flow] generation=' + wbFlow.generation + ' reason=' + String(reason || 'unknown') + ' path=' + wbFlow.activePath);
  } catch (_) {}
  return wbFlow.generation;
}
