export function ensureTe2DiffThemeApplied(win, doneFlag) {
  try {
    if (!win || !win.monaco || !win.monaco.editor || !win.monaco.editor.defineTheme) return doneFlag;
    if (doneFlag) return doneFlag;
    win.monaco.editor.defineTheme('te2-vs-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'diffEditor.insertedLineBackground': 'rgba(46, 160, 67, 0.18)',
        'diffEditor.insertedTextBackground': 'rgba(46, 160, 67, 0.28)',
        'diffEditor.removedLineBackground': 'rgba(248, 81, 73, 0.14)',
        'diffEditor.removedTextBackground': 'rgba(248, 81, 73, 0.24)',
        'diffEditor.border': 'rgba(255, 255, 255, 0.10)',
        'diffEditor.diagonalFill': 'rgba(255, 255, 255, 0.04)',
      },
    });
    return true;
  } catch (_) {
    return doneFlag;
  }
}
