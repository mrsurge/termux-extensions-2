export function symbolRangeToLineBounds(r) {
  var startLine;
  var endLine;
  if (typeof r.startLineNumber === 'number') {
    startLine = r.startLineNumber;
    endLine = r.endLineNumber || 999999;
  } else if (r.start && typeof r.start.line === 'number') {
    startLine = r.start.line + 1;
    endLine = (r.end && typeof r.end.line === 'number') ? r.end.line + 1 : 999999;
  } else if (typeof r.startLine === 'number') {
    startLine = r.startLine;
    endLine = r.endLine || 999999;
  } else if (Array.isArray(r) && r.length >= 3) {
    startLine = r[0] + 1;
    endLine = r[2] + 1;
  } else {
    return null;
  }
  return { startLine: startLine, endLine: endLine };
}
