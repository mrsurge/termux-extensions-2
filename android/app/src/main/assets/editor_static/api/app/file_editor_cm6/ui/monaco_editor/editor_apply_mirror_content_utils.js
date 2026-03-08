export function applyMirrorContent(model, editor, content) {
  if (model && model.getFullModelRange) {
    var range = model.getFullModelRange();
    model.applyEdits([{ range: range, text: content }]);
  } else if (model && model.setValue) {
    model.setValue(content);
  } else {
    editor.setValue(content);
  }
}
