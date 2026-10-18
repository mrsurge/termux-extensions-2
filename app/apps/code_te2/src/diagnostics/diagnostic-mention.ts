import type { DiagnosticMarker, ProblemsMentionPayload } from './problems-panel';

/** Same diagnostic text/range for Explorer rows and inline Problems peek. */
export function buildDiagnosticMention(path: string, marker: DiagnosticMarker): ProblemsMentionPayload {
  const severity = marker.severity === 8 ? 'error' : marker.severity === 4 ? 'warning' : 'info';
  const code = marker.code && typeof marker.code === 'object' ? marker.code.value : marker.code;
  let content = `[${severity}] `;
  if (code !== undefined && code !== '') content += `${code}: `;
  content += marker.message || '(no message)';
  if (marker.source) content += ` (${marker.source})`;
  return {
    path,
    lineNo: marker.startLineNumber || 1,
    col: marker.startColumn || 1,
    endLineNo: marker.endLineNumber || marker.startLineNumber || 1,
    endCol: marker.endColumn || marker.startColumn || 1,
    content,
  };
}
