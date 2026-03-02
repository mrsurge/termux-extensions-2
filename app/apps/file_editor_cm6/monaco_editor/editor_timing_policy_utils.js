export function localMirrorDebounceMs(getAutoSaveFn) {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 1000 : 180;
}

export function mirrorHotWindowMs(getAutoSaveFn) {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 850 : 250;
}

export function gitBaselineDebounceMs(getAutoSaveFn) {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 320 : 180;
}

export function gitBaselineApplyIdleMs(getAutoSaveFn, getShowInlineDiffsFn) {
  var autoSave = typeof getAutoSaveFn === 'function' && getAutoSaveFn();
  var showInline = typeof getShowInlineDiffsFn === 'function' && getShowInlineDiffsFn();
  return (autoSave && showInline) ? 1000 : 0;
}
