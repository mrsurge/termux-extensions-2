import { getBooleanPref } from './editor_pref_read_utils.ts';

type BooleanGetter = (() => boolean) | null | undefined;
type PrefsLike = unknown;

export function getShowInlineDiffsFlag(cachedPrefs: PrefsLike): boolean {
  return getBooleanPref(cachedPrefs, 'showInlineDiffs');
}

export function getShowDraftDiffsFlag(cachedPrefs: PrefsLike, getAutoSaveFn: BooleanGetter): boolean {
  if (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) return false;
  return getBooleanPref(cachedPrefs, 'showDraftDiffs');
}

export function getUseTrueInlineViewFlag(cachedPrefs: PrefsLike): boolean {
  return getBooleanPref(cachedPrefs, 'useTrueInlineView');
}

export function getAutoSaveFlag(cachedPrefs: PrefsLike): boolean {
  return getBooleanPref(cachedPrefs, 'autoSave');
}
