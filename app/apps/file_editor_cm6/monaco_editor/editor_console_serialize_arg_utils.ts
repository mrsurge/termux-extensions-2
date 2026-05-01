import { safeSerializeConsoleArg } from './editor_console_safe_serialize_utils.ts';

export function serializeConsoleArg(value: unknown): unknown {
  try { return JSON.parse(safeSerializeConsoleArg(value)); }
  catch (_) { return String(value); }
}
