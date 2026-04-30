export function expandShortHex(color: string | null | undefined): string | null | undefined {
  if (!color || typeof color !== 'string') return color;
  const match = color.match(/^#([0-9a-fA-F]{3,4})$/);
  if (!match) return color;
  const value = match[1];
  if (value.length === 3) return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
  if (value.length === 4) return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return color;
}

export function toMonacoColorHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  let value = String(hex).trim();
  if (!value) return null;
  if (value[0] === '#') value = value.slice(1);
  if (!/^[0-9a-fA-F]{3,8}$/.test(value)) return null;
  if (value.length === 3) value = `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
  if (value.length === 4) value = `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return value.toUpperCase();
}

export function parseJsonc(text: unknown): unknown {
  let value = String(text || '');
  if (value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  value = value.replace(/\/\*[\s\S]*?\*\//g, '');
  value = value.replace(/(^|[^:])\/\/.*$/gm, '$1');
  value = value.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(value);
}
