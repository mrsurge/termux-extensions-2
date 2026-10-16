// Remove only the pinned provider's transient absolute-gutter override. Keep
// preview, acceptance, cancellation and decoration cleanup upstream-owned.
export function preserveRelativeGotoGutter(source) {
  const start = source.indexOf('        // Adjust line number visibility as needed\n');
  const end = source.indexOf('        return disposables;', start);
  if (start < 0 || end < 0) throw new Error('Pinned Go to Line gutter override changed; review before building');
  const block = source.slice(start, end);
  if (!block.includes("codeEditor.updateOptions({ lineNumbers: 'on' })")
    || !block.includes("codeEditor.updateOptions({ lineNumbers: 'relative' })")
    || !block.includes('RenderLineNumbersType.Relative')) {
    throw new Error('Unexpected Go to Line gutter override; refusing broad replacement');
  }
  return source.slice(0, start) + source.slice(end);
}
