import { safeSerializeConsoleArg } from './editor_console_safe_serialize_utils.js';

export function serializeConsoleArg(a) {
  try { return JSON.parse(safeSerializeConsoleArg(a)); }
  catch (_) { return String(a); }
}
