export function isAdapterReady(win) {
  return !!(win && win.__te2AdapterReady);
}

export function wbIsFrameworkReady(editor, model, currentPath) {
  return !!(editor && model && currentPath);
}

export function wbIsBarrierOpen(opts) {
  var o = opts || {};
  if (!isAdapterReady(o.win)) return false;
  if (!wbIsFrameworkReady(o.editor, o.model, o.currentPath)) return false;
  var wantPath = String(o.path || o.currentPath || '');
  var wantGen = Number.isFinite(Number(o.generation)) ? Number(o.generation) : Number(o.currentGeneration || 0);
  return Number((o.wbFlow && o.wbFlow.openAckGeneration) || -1) === wantGen
    && String((o.wbFlow && o.wbFlow.openAckPath) || '') === wantPath;
}
