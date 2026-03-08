export function shouldSkipAutosaveBaselineRefresh(diffEditor, gitHeadModel, model) {
  var skip = false;
  if (diffEditor && diffEditor.getModel) {
    var dm = diffEditor.getModel();
    if (dm && dm.original === gitHeadModel && dm.modified === model && !!dm.te2AutosaveMode) {
      skip = true;
    }
  } else {
    skip = true;
  }
  return skip;
}
