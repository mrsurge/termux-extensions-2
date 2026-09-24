const MONACO_THEME_NAME = /^[a-z0-9-]+$/i;

// Monaco rejects punctuation in theme names; the catalog/preference ID stays unchanged.
export function monacoThemeName(publicId: string): string {
  if (MONACO_THEME_NAME.test(publicId)) return publicId;
  const bytes = new TextEncoder().encode(publicId);
  return `te2-ext-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
