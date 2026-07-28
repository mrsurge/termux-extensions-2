// @ts-check

/**
 * @param {{
 *   presets: Record<string, number>,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   toast: (msg: string, kind?: string) => void
 * }} deps
 */
export function createFontScaleController(deps: any) {
  function updateFontScaleMenuChecks(currentScale: number) {
    const items = {
      'mi-font-small': deps.presets.small,
      'mi-font-medium': deps.presets.medium,
      'mi-font-large': deps.presets.large,
    };

    for (const [id, scale] of Object.entries(items)) {
      const item = document.getElementById(id);
      if (item) {
        const isActive = Math.abs(scale - currentScale) < 0.01;
        item.classList.toggle('fe-menu-item-checked', isActive);
        item.setAttribute('aria-checked', isActive ? 'true' : 'false');
      }
    }
  }

  function applyFontScale(scale: number) {
    document.documentElement.style.setProperty('--chrome-font-scale', String(scale));
    updateFontScaleMenuChecks(scale);
    console.log(`[FontScale] Applied scale: ${scale}`);
  }

  async function setFontScale(preset: string) {
    const scale = deps.presets[preset];
    if (!scale) {
      console.error(`[FontScale] Invalid preset: ${preset}`);
      return;
    }

    try {
      applyFontScale(scale);
      await deps.updatePreference('fontScale', scale);
    } catch (error) {
      console.error('[FontScale] Failed to update:', error);
      deps.toast('Failed to update font scale', 'error');
    }
  }

  return { applyFontScale, updateFontScaleMenuChecks, setFontScale };
}
