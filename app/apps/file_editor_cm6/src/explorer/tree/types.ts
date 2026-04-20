export type ExplorerTreeEntryKind = 'file' | 'dir';

export interface ExplorerTreeEntry {
  rel?: string;
  path?: string;
  name?: string;
  kind?: ExplorerTreeEntryKind | string;
  gitStatus?: string;
  gitFlags?: string[];
  hasDraft?: boolean;
}

export interface ExplorerTreeMenuEntry {
  rel: string;
  name: string;
  kind: ExplorerTreeEntryKind | string;
  gitStatus?: string;
}

export type ExplorerTreeMenuActionType =
  | 'enableSelectMode'
  | 'disableSelectMode'
  | 'batchCopy'
  | 'batchMove'
  | 'batchStage'
  | 'batchUnstage'
  | 'batchDelete'
  | 'createFile'
  | 'createDir'
  | 'openExternal'
  | 'copyName'
  | 'copyPath'
  | 'copyRelPath'
  | 'mentionAgent'
  | 'copyTo'
  | 'moveTo'
  | 'copyFrom'
  | 'moveFrom'
  | 'rename'
  | 'delete'
  | 'stage'
  | 'unstage'
  | 'stageDir'
  | 'unstageDir'
  | 'restore';

export interface ExplorerTreeMenuActionItem {
  label: string;
  type: ExplorerTreeMenuActionType;
  destructive?: boolean;
  disabled?: boolean;
  divider?: false;
}

export interface ExplorerTreeMenuDivider {
  divider: true;
}

export type ExplorerTreeMenuItem =
  | ExplorerTreeMenuActionItem
  | ExplorerTreeMenuDivider;
