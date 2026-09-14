/** Small browser adapters for the copied SCM graph, not workbench services. */
export type ColorIdentifier = string;
export type HistoryIcon = string | { light: string; dark: string } | { id: string };
export interface HistoryMarkdown { readonly value: string; }
type ColorDefaults = string | { light: string; dark: string; hcDark: string; hcLight: string };
const colors = new Map<string, ColorDefaults>();
export const badgeBackground = '#4d4d4d';
export const chartsBlue = 'var(--vscode-charts-blue, #3794ff)';
export const chartsPurple = 'var(--vscode-charts-purple, #B180D7)';
export const foreground = '#cccccc';
export const PANEL_BACKGROUND = '#181818';
export function registerColor(id: string, defaults: ColorDefaults, _description: string): ColorIdentifier {
  colors.set(id, defaults);
  return id;
}
export function asCssVariable(id: string): string {
  return `var(--vscode-${id.replaceAll('.', '-')})`;
}
// Apply only to the graph host, never document root. TE2 theme values can override these defaults.
export function applyGraphColors(host: HTMLElement, theme: 'light' | 'dark' | 'hcDark' | 'hcLight' = 'dark'): void {
  for (const [id, defaults] of colors) {
    host.style.setProperty(`--vscode-${id.replaceAll('.', '-')}`, typeof defaults === 'string' ? defaults : defaults[theme]);
  }
}
export function localize(_key: string, message: string): string { return message; }
export function deepClone<T>(value: T): T { return structuredClone(value); }
export function rot(index: number, modulo: number): number { return (modulo + (index % modulo)) % modulo; }
export function findLastIdx<T>(items: readonly T[], predicate: (value: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return i;
  return -1;
}
export function svgElem(tag: 'svg', options: { style: { height: string; width: string } }): { root: SVGSVGElement } {
  const root = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.assign(root.style, options.style);
  return { root };
}
