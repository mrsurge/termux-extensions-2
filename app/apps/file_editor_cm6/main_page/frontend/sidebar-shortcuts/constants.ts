import type { ShortcutKind, ShortcutLoad } from './types.ts';

export const EXTENSION_MANIFEST_URL = '/apps/file_editor_cm6/extensions/sidebar_extension/manifest.json';

export const UI_PREF_KEY_ACTIVE = 'agentActiveShortcutId';
export const UI_PREF_KEY_TOGGLE_DISPLAY = 'agentToggleDisplay';
export const UI_PREF_KEY_HEADER_DISPLAY = 'agentHeaderDisplay';
export const UI_PREF_KEY_SHORTCUTS = 'agentShortcuts';
export const SIDEBAR_SHORTCUT_VERSION_PARAM = 'te2_sidebar_version';

export const SHORTCUT_KIND_URL: ShortcutKind = 'url';
export const SHORTCUT_KIND_FRAMEWORK_APP: ShortcutKind = 'framework_app';

export const SHORTCUT_LOAD_LAZY: ShortcutLoad = 'lazy';
export const SHORTCUT_LOAD_EAGER: ShortcutLoad = 'eager';

export const SIDEBAR_SETUP_TITLE_DEFAULT = 'Side-bar setup';
export const SIDEBAR_SETUP_HINT_DEFAULT = 'Add shortcuts to choose what loads in the side-bar.';
