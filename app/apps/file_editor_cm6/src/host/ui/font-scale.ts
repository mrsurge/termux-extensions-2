// @ts-check

/**
 * @param {{
 *   presets: Record<string, number>,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   scheduleToolbarTitleClamp: (opts?: any) => void,
 *   toast: (msg: string, kind?: string) => void
 * }} deps
 */
export function createFontScaleController(deps) {
  function updateFontScaleMenuChecks(currentScale) {
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

  function applyFontScale(scale) {
    document.documentElement.style.setProperty('--chrome-font-scale', scale);
    updateFontScaleMenuChecks(scale);
    console.log(`[FontScale] Applied scale: ${scale}`);
  }

  async function setFontScale(preset) {
    const scale = deps.presets[preset];
    if (!scale) {
      console.error(`[FontScale] Invalid preset: ${preset}`);
      return;
    }

    try {
      applyFontScale(scale);
      deps.scheduleToolbarTitleClamp({ doubleRaf: true });
      await deps.updatePreference('fontScale', scale);
      deps.scheduleToolbarTitleClamp({ doubleRaf: true });
    } catch (error) {
      console.error('[FontScale] Failed to update:', error);
      deps.toast('Failed to update font scale', 'error');
    }
  }

  return { applyFontScale, updateFontScaleMenuChecks, setFontScale };
}
