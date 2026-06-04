import type { ShortcutKind, ShortcutLoad } from './types.ts';

export const EXTENSION_MANIFEST_URL = '/apps/file_editor_cm6/extensions/sidebar_extension/manifest.json';

export const UI_PREF_KEY_ACTIVE = 'agentActiveShortcutId';
export const UI_PREF_KEY_TOGGLE_DISPLAY = 'agentToggleDisplay';
export const UI_PREF_KEY_HEADER_DISPLAY = 'agentHeaderDisplay';
export const UI_PREF_KEY_SHORTCUTS = 'agentShortcuts';
export const SIDEBAR_SHORTCUT_VERSION_PARAM = 'te2_sidebar_version';
export const SIDEBAR_DOCK_DEBUG_NUMBERS_FLAG = 'te2_sidebar_dock_numbers';

export const SHORTCUT_KIND_URL: ShortcutKind = 'url';
export const SHORTCUT_KIND_FRAMEWORK_APP: ShortcutKind = 'framework_app';

export const SHORTCUT_LOAD_LAZY: ShortcutLoad = 'lazy';
export const SHORTCUT_LOAD_EAGER: ShortcutLoad = 'eager';

export const SIDEBAR_SETUP_TITLE_DEFAULT = 'Open a sidebar app window';
export const SIDEBAR_SETUP_HINT_DEFAULT = 'Use the launcher to open an app dock slot, or add a plain URL fallback entry.';
