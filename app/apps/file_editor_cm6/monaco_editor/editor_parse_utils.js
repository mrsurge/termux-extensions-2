export function expandShortHex(color) {
  if (!color || typeof color !== 'string') return color;
  var m = color.match(/^#([0-9a-fA-F]{3,4})$/);
  if (!m) return color;
  var s = m[1];
  if (s.length === 3) return '#' + s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (s.length === 4) return '#' + s[0]+s[0]+s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
  return color;
}

export function toMonacoColorHex(hex) {
  if (!hex) return null;
  var s = String(hex).trim();
  if (!s) return null;
  if (s[0] === '#') s = s.slice(1);
  if (!/^[0-9a-fA-F]{3,8}$/.test(s)) return null;
  if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (s.length === 4) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
  return s.toUpperCase();
}

export function parseJsonc(text) {
  var s = String(text || '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  s = s.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(s);
}
