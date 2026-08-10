import {
  SHORTCUT_KIND_FRAMEWORK_APP,
  UI_PREF_KEY_ACTIVE,
  UI_PREF_KEY_SHORTCUTS,
} from "./constants.ts";
import type { SidebarShortcut, UnknownRecord } from "./types.ts";
import {
  buildFrameworkAppUrl,
  normStr,
  normalizeKind,
  normalizeLoad,
} from "./utils.ts";

export interface ActiveShortcutSelection {
  active: SidebarShortcut | null;
  activeId: string;
  clientActiveShortcutId: string;
}

export function collectShortcuts(uiPrefs: UnknownRecord): SidebarShortcut[] {
  const raw = Array.isArray(uiPrefs?.[UI_PREF_KEY_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_SHORTCUTS]
    : [];
  const out: SidebarShortcut[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const sc = entry as UnknownRecord;
    const kind = normalizeKind(sc.kind);
    if (!kind) return;
    const appId = normStr(sc.app_id);
    if (kind === SHORTCUT_KIND_FRAMEWORK_APP && !appId) return;
    const label = normStr(sc.label);
    const url =
      normStr(sc.url) ||
      (kind === SHORTCUT_KIND_FRAMEWORK_APP ? buildFrameworkAppUrl(appId) : "");
    if (!url) return;
    const id = normStr(sc.id);
    const key = id || url;
    if (!key) return;
    out.push({
      key,
      id,
      kind,
      app_id: appId,
      label,
      url,
      version: normStr(sc.version),
      icon:
        sc.icon && typeof sc.icon === "object" && !Array.isArray(sc.icon)
          ? (sc.icon as SidebarShortcut["icon"])
          : null,
      load: normalizeLoad(sc.load),
      header: true,
      last_used: Number.isFinite(Number(sc.last_used))
        ? Number(sc.last_used)
        : 0,
      state:
        sc.state && typeof sc.state === "object" && !Array.isArray(sc.state)
          ? (sc.state as SidebarShortcut["state"])
          : undefined,
      state_kind: normStr(sc.state_kind || sc.stateKind),
    });
  });
  return out;
}

export function resolveActive(
  uiPrefs: UnknownRecord,
  shortcuts: SidebarShortcut[] | null = null,
  clientActiveShortcutId = "",
): SidebarShortcut | null {
  const activeId =
    normStr(clientActiveShortcutId) || normStr(uiPrefs?.[UI_PREF_KEY_ACTIVE]);
  if (!activeId) return null;
  const list = Array.isArray(shortcuts) ? shortcuts : collectShortcuts(uiPrefs);
  return (
    list.find(
      (sc) =>
        sc &&
        (sc.id === activeId || sc.url === activeId || sc.key === activeId),
    ) || null
  );
}

export function pickMruShortcut(
  shortcuts: SidebarShortcut[],
): SidebarShortcut | null {
  let best: SidebarShortcut | null = null;
  let bestTs = 0;
  shortcuts.forEach((sc) => {
    if (!sc) return;
    const ts = Number(sc.last_used) || 0;
    if (!best || ts > bestTs) {
      best = sc;
      bestTs = ts;
    }
  });
  return best;
}

export function ensureActiveSelection(
  uiPrefs: UnknownRecord,
  shortcuts: SidebarShortcut[],
  clientActiveShortcutId = "",
): ActiveShortcutSelection {
  const activeId =
    normStr(clientActiveShortcutId) || normStr(uiPrefs?.[UI_PREF_KEY_ACTIVE]);
  const list = Array.isArray(shortcuts) ? shortcuts : collectShortcuts(uiPrefs);
  if (!list.length) {
    return { active: null, activeId: "", clientActiveShortcutId };
  }
  const active = resolveActive(uiPrefs, list, clientActiveShortcutId);
  if (active) {
    return { active, activeId: activeId || active.key, clientActiveShortcutId };
  }
  const fallback = pickMruShortcut(list) || list[0] || null;
  const nextId = fallback?.id || fallback?.url || fallback?.key || "";
  return {
    active: fallback,
    activeId: nextId,
    clientActiveShortcutId: nextId || clientActiveShortcutId,
  };
}
