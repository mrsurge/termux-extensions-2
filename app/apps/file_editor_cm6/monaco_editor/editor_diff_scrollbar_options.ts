export function buildInlineDiffScrollbarOptions(): Record<string, unknown> {
  return {
    scrollbar: {
      vertical: 'hidden',
      verticalScrollbarSize: 0,
      horizontal: 'auto',
      horizontalScrollbarSize: 10,
    },
  };
}
