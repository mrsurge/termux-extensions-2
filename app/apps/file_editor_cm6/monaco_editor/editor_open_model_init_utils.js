export function initOpenModel(createFileModelFn, editor, content, lang, absPath, afterAttachFn) {
  var model = createFileModelFn(content || '', lang, absPath);
  editor.setModel(model);
  if (typeof afterAttachFn === 'function') afterAttachFn(model, lang, absPath);
  return model;
}
