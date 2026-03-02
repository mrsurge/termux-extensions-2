import { getBooleanPref } from './editor_pref_read_utils.js';

export function getShowInlineDiffsFlag(cachedPrefs) {
  return getBooleanPref(cachedPrefs, 'showInlineDiffs');
}

export function getShowDraftDiffsFlag(cachedPrefs, getAutoSaveFn) {
  if (typeof getAutoSaveFn === 'function' && getAutoSaveFn()) return false;
  return getBooleanPref(cachedPrefs, 'showDraftDiffs');
}

export function getUseTrueInlineViewFlag(cachedPrefs) {
  return getBooleanPref(cachedPrefs, 'useTrueInlineView');
}

export function getAutoSaveFlag(cachedPrefs) {
  return getBooleanPref(cachedPrefs, 'autoSave');
}
