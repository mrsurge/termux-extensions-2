export function syncReadOnlyInputMode(ed, monacoRef, docRef) {
  try {
    if (!ed) return;
    var dom = ed.getDomNode && ed.getDomNode();
    if (!dom) return;
    var ta = dom.querySelector('textarea.inputarea') || dom.querySelector('textarea');
    if (!ta) return;
    var ro = ed.getOption(monacoRef.editor.EditorOption.readOnly);
    ta.setAttribute('inputmode', ro ? 'none' : 'text');
    if (ro && ta === docRef.activeElement) ta.blur();
  } catch (_) {}
}
