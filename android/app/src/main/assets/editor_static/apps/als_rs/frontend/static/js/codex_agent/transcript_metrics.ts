interface TranscriptSpacerElements {
  topSpacerEl: HTMLElement | null;
  bottomSpacerEl?: HTMLElement | null;
}

interface TranscriptMetricsContext {
  getSpacerEls(): TranscriptSpacerElements;
}

interface TranscriptMetricsBinding {
  updateSpacerHeights(): void;
}

export function bindTranscriptMetrics(ctx: TranscriptMetricsContext): TranscriptMetricsBinding {
  const {
    getSpacerEls,
  } = ctx;
  function updateSpacerHeights() {
    const { topSpacerEl, bottomSpacerEl } = getSpacerEls();
    if (!topSpacerEl) return;
    topSpacerEl.style.height = '0px';
    if (bottomSpacerEl) {
      bottomSpacerEl.style.height = '0px';
    }
  }

  return { updateSpacerHeights };
}
