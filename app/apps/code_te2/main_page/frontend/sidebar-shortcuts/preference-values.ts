import { isUnknownArray } from '../../../src/rpc/value-types.ts';
import type { SidebarShortcutPreference } from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !isUnknownArray(value);
}

export function isShortcutPreference(value: unknown): value is SidebarShortcutPreference {
  if (!record(value)) return false;
  for (const key of ['id', 'kind', 'app_id', 'label', 'url', 'load', 'state_kind', 'stateKind']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  if (value.version !== undefined && typeof value.version !== 'string' && typeof value.version !== 'number') return false;
  if (value.last_used !== undefined && typeof value.last_used !== 'number') return false;
  if (value.state !== undefined && !record(value.state)) return false;
  if (value.icon !== undefined && value.icon !== null) {
    if (!record(value.icon)) return false;
    for (const key of ['kind', 'name', 'emoji', 'src', 'text', 'value', 'defaultIcon']) {
      if (value.icon[key] !== undefined && typeof value.icon[key] !== 'string') return false;
    }
  }
  return true;
}

export function shortcutPreferences(value: unknown): SidebarShortcutPreference[] {
  return isUnknownArray(value) ? value.filter(isShortcutPreference) : [];
}
