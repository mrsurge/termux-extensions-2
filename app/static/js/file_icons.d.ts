export interface FileIcon {
  codicon?: string;
  svg?: string;
  color?: string;
  iconName?: string;
}
export function ensureLoaded(): Promise<unknown>;
export function getIcon(fileName: string): Promise<FileIcon>;
export function renderIcon(element: HTMLElement, icon: FileIcon | null | undefined): boolean;
