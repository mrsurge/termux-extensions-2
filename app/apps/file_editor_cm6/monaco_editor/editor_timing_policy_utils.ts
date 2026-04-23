type BooleanGetter = (() => boolean) | null | undefined;

export function localMirrorDebounceMs(getAutoSaveFn: BooleanGetter): number {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 1000 : 180;
}

export function mirrorHotWindowMs(getAutoSaveFn: BooleanGetter): number {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 850 : 250;
}

export function gitBaselineDebounceMs(getAutoSaveFn: BooleanGetter): number {
  return (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) ? 320 : 180;
}

export function gitBaselineApplyIdleMs(
  getAutoSaveFn: BooleanGetter,
  getShowInlineDiffsFn: BooleanGetter,
): number {
  const autoSave = typeof getAutoSaveFn === 'function' && getAutoSaveFn();
  const showInline = typeof getShowInlineDiffsFn === 'function' && getShowInlineDiffsFn();
  return (autoSave && showInline) ? 1000 : 0;
}
