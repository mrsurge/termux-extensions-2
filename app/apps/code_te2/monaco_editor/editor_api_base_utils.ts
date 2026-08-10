declare global {
  interface Window {
    __te2InlineMonacoApiBase?: string;
  }
}

interface LocationLike {
  pathname?: string;
}

export function deriveApiBase(locationObj: LocationLike | null | undefined): string {
  try {
    let override = '';
    try {
      override = String(
        (typeof window !== 'undefined' && window.__te2InlineMonacoApiBase)
          ? window.__te2InlineMonacoApiBase
          : ''
      ).trim();
    } catch (_) {
      override = '';
    }
    if (override) return override.replace(/\/+$/, '');

    const p = String(locationObj && locationObj.pathname ? locationObj.pathname : '');
    const idx = p.indexOf('/ui/');
    return idx >= 0 ? p.slice(0, idx) : '';
  } catch (_) {
    return '';
  }
}
