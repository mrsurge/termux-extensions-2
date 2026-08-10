import { wbCurrentGeneration, type WorkbenchFlowLike } from './editor_workbench_state_utils.js';

export function wbBumpGeneration(
  wbFlow: WorkbenchFlowLike | null | undefined,
  path: string | null | undefined,
  reason: string | null | undefined,
): number {
  if (!wbFlow) return 0;
  wbFlow.generation = wbCurrentGeneration(wbFlow) + 1;
  wbFlow.activePath = String(path || '');
  wbFlow.openAckGeneration = -1;
  wbFlow.openAckPath = '';
  wbFlow.pendingDidChange = null;
  wbFlow.pendingSymbols = null;
  try {
    console.log(
      '[workbench-flow] generation=' + wbFlow.generation
      + ' reason=' + String(reason || 'unknown')
      + ' path=' + String(wbFlow.activePath || ''),
    );
  } catch (_) {}
  return wbFlow.generation;
}
