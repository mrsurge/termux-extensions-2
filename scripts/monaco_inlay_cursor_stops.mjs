// The model position does not change while traversing injected text. Mark
// only Monaco's own hint decorations; ghost text keeps its original policy.
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Monaco inlay cursor patch no longer matches: ' + before);
  return source.replace(before, after);
}

const marker = ' te2-inlay-cursor-stop';

export function markInlayText(source) {
  return replaceOnce(source, 'inlineClassName: ref.className,',
    `inlineClassName: ref.className + ${JSON.stringify(marker)},`);
}

export function paintBlockPastInlay(source) {
  return replaceOnce(source, 'const { lineNumber, column } = this._position;', `
        let paintPosition = this._position;
        const model = this._context.viewModel;
        if ((this._cursorStyle === TextEditorCursorStyle.Block || this._cursorStyle === TextEditorCursorStyle.BlockOutline)
            && model.getInjectedTextAt(paintPosition)?.options.inlineClassName?.endsWith(${JSON.stringify(marker)})) {
            paintPosition = model.normalizePosition(paintPosition, 4 /* PositionAffinity.RightOfInjectedText */);
        }
        const { lineNumber, column } = paintPosition;`);
}
