export function formatJsonSetting(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseJsonSetting(raw: unknown, label = 'JSON value'): unknown {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} must be valid JSON: ${detail}`);
  }
}
