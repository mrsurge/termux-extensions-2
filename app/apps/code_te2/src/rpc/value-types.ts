/** Array.isArray's lib.d.ts predicate is any[]; preserve unknown at boundaries. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? value as Record<string, unknown> : {};
}
