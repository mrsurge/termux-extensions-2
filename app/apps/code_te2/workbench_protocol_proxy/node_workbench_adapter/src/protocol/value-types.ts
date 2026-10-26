/** Array.isArray's lib.d.ts predicate is any[]; preserve unknown at boundaries. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
