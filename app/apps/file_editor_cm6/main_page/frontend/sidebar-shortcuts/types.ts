export type UnknownRecord = Record<string, unknown>;

export type ShortcutKind = 'url' | 'framework_app';
export type ShortcutLoad = 'lazy' | 'eager';
export type ShortcutIconKind = 'asset' | 'emoji' | 'image' | 'text' | '';

export interface ShortcutIcon extends UnknownRecord {
  kind?: ShortcutIconKind | string;
  name?: string;
  emoji?: string;
  src?: string;
  text?: string;
  value?: string;
  defaultIcon?: string;
}

export interface SidebarShortcut extends UnknownRecord {
  id: string;
  key: string;
  kind: ShortcutKind;
  app_id: string;
  label: string;
  url: string;
  icon: ShortcutIcon | null;
  load: ShortcutLoad;
  last_used: number;
}

export interface SidebarShortcutPreference extends UnknownRecord {
  id?: string;
  kind?: ShortcutKind | string;
  app_id?: string;
  label?: string;
  url?: string;
  icon?: ShortcutIcon | null;
  load?: ShortcutLoad | string;
  last_used?: number;
}

export interface FrameworkAppManifest extends UnknownRecord {
  id?: string;
  title?: string;
  name?: string;
  icon_src?: string;
  icon_text?: string;
  icon_emoji?: string;
  asset_base_url?: string;
  _dir?: string;
}

export interface SidebarShortcutsHost {
  toast?: (message: string) => void;
}

export interface SidebarShortcutsOptions {
  host?: SidebarShortcutsHost | null;
  homeDir?: string;
  pickFile?: (startPath?: string) => Promise<string | null>;
  openDrawer?: () => void;
  closeAllMenus?: () => void;
  emitSidebarIpc?: (eventName: string, payload?: UnknownRecord) => void;
  setMenuChecked?: (el: HTMLElement | null, checked: boolean) => void;
}

export interface SidebarShortcutsRuntime {
  init: () => Promise<void>;
  hydrate: () => Promise<void> | void;
  applyUiPrefs: (uiPrefs: UnknownRecord) => void;
  getActiveUrl: (uiPrefs: UnknownRecord) => string;
}

export interface IframeEntry {
  iframe: HTMLIFrameElement;
  url: string;
  loaded: boolean;
}

export interface JsonFetchResult<TBody = unknown> {
  resp: Response;
  body: TBody | null;
}

export interface ShellEventPayload extends UnknownRecord {
  app_id?: string;
  running?: boolean;
  catalog?: unknown[];
  running_ids?: unknown[];
  label?: string;
  spec_id?: string;
  status?: string;
}

export interface ShellEvent extends UnknownRecord {
  type?: string;
  app_id?: string;
  payload?: ShellEventPayload;
  data?: ShellEventPayload;
}
